/* Import de séances depuis un fichier JSON — jalon 5.
   Sert à importer l'historique converti depuis Sport.xlsx (historique_sport_xlsx.json).
   Le jalon 6 ajoutera l'export de sauvegarde (même format, donc réimportable ici).

   Règles :
   - format attendu : { format: 'suivi-muscu', version: 1, seances: [...] } ;
   - chaque séance est validée (date AAAA-MM-JJ, type connu, exercices + sets numériques) ;
   - un set sans reps est ignoré, un exercice sans set aussi, une séance sans rep aussi ;
   - doublons : une séance dont la date ET le type existent déjà est ignorée (jamais écrasée). */

import { TYPES, ajouterSeances, toutesLesSeances } from './db.js';
import { demanderConfirmation } from './editeur.js';

const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

function choisirFichier() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // Pas de filtre "accept" strict : iOS grise parfois les .json dans le sélecteur.
    input.accept = '.json,application/json,text/plain';
    input.style.display = 'none';
    input.onchange = () => { resolve(input.files && input.files[0] ? input.files[0] : null); input.remove(); };
    document.body.appendChild(input);
    input.click();
  });
}

function nombre(v) {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/* Valide et normalise une séance ; renvoie null si inutilisable. */
function normaliser(s) {
  if (!s || typeof s !== 'object') return null;
  if (typeof s.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) return null;
  if (!TYPES.includes(s.type)) return null;
  if (!Array.isArray(s.exercices)) return null;
  const exercices = [];
  for (const e of s.exercices) {
    const nom = typeof e?.nom === 'string' ? e.nom.trim().replace(/\s+/g, ' ') : '';
    if (!nom || !Array.isArray(e.sets)) continue;
    const sets = [];
    for (const x of e.sets) {
      const reps = nombre(x?.reps);
      const charge = x?.charge === null || x?.charge === undefined || x?.charge === '' ? 0 : nombre(x.charge);
      if (!(reps > 0) || !(charge >= 0)) continue;
      sets.push({ reps, charge, confirme: true });
    }
    if (sets.length) exercices.push({ nom, sets });
  }
  if (!exercices.length) return null;
  return { date: s.date, type: s.type, statut: 'terminee', exercices };
}

/* Analyse le contenu d'un fichier. Exporté pour les tests. */
export async function analyserImport(texte) {
  let json;
  try { json = JSON.parse(texte); } catch { throw new Error('Ce fichier n\'est pas un JSON valide.'); }
  const brutes = Array.isArray(json) ? json : json?.seances;
  if (!Array.isArray(brutes)) throw new Error('Aucune séance trouvée dans ce fichier.');

  const existantes = new Set((await toutesLesSeances()).map((s) => `${s.date}|${s.type}`));
  const vues = new Set();
  const nouvelles = [];
  let doublons = 0;
  let invalides = 0;
  for (const b of brutes) {
    const s = normaliser(b);
    if (!s) { invalides += 1; continue; }
    const cle = `${s.date}|${s.type}`;
    if (existantes.has(cle) || vues.has(cle)) { doublons += 1; continue; }
    vues.add(cle);
    nouvelles.push(s);
  }
  nouvelles.sort((a, b) => a.date.localeCompare(b.date));
  return { nouvelles, doublons, invalides };
}

/* Parcours complet : sélection du fichier, aperçu, confirmation, écriture.
   Renvoie le nombre de séances importées (0 si annulé), ou lève une Error lisible. */
export async function importerDepuisFichier() {
  const fichier = await choisirFichier();
  if (!fichier) return 0;
  const { nouvelles, doublons, invalides } = await analyserImport(await fichier.text());

  const ignorees = [];
  if (doublons) ignorees.push(`${doublons} déjà présente${doublons > 1 ? 's' : ''}`);
  if (invalides) ignorees.push(`${invalides} vide${invalides > 1 ? 's' : ''} ou invalide${invalides > 1 ? 's' : ''}`);
  const suffixe = ignorees.length ? ` Ignorées : ${ignorees.join(', ')}.` : '';

  if (!nouvelles.length) throw new Error(`Rien à importer.${suffixe}`);

  const parType = TYPES.map((t) => [t, nouvelles.filter((s) => s.type === t).length])
    .filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(', ');
  const ok = await demanderConfirmation(
    `Importer ${nouvelles.length} séance${nouvelles.length > 1 ? 's' : ''}`,
    `Du ${fmtDate(nouvelles[0].date)} au ${fmtDate(nouvelles[nouvelles.length - 1].date)} — ${parType}.${suffixe}`,
    'Importer',
  );
  if (!ok) return 0;
  await ajouterSeances(nouvelles);
  return nouvelles.length;
}
