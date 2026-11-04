/* Import / export de séances en JSON.
   - Jalon 5 : import de l'historique converti depuis Sport.xlsx (historique_sport_xlsx.json).
   - Jalon 6 : export de sauvegarde (même format, donc réimportable ici pour restaurer),
     rappel au-delà de 30 jours sans sauvegarde, demande de stockage persistant.

   Règles :
   - format attendu : { format: 'suivi-muscu', version: 1, seances: [...] } ;
   - chaque séance est validée (date AAAA-MM-JJ, type non vide, exercices + sets numériques) ;
   - un type inconnu de l'app (absent de la liste des types) est créé à l'import, après
     confirmation ; les sauvegardes contiennent aussi la liste ordonnée des types (champ
     `types`, facultatif : les anciens fichiers restent importables) ;
   - un set sans reps est ignoré, un exercice sans set aussi, une séance sans rep aussi ;
   - doublons : une séance dont la date ET le type existent déjà est ignorée (jamais écrasée). */

import {
  TYPES, ajouterSeances, toutesLesSeances, sauverSeance,
  listeSeancesTerminees, lireReglage, ecrireReglage, aujourdhui,
  ajouterExercicesManquants, exercicesPourExport, cleExercice, listeBibliotheque,
  typeConnu, nomPropre, ajouterTypesManquants,
} from './db.js';
import { demanderConfirmation } from './editeur.js';

/* Noms d'exercices en double dans Sport.xlsx, fusionnés (décision du 04/11/2026).
   « Reverse fly » reste un exercice distinct. */
const FUSIONS_NOMS = {
  'Curl biceps poulie (bilatéral)': 'Curl biceps poulie',
  'Overhead triceps extension (bilatéral)': 'Overhead triceps extension',
  'Pecs fly (machine)': 'Pecs fly',
  'DC semi incliné haltères (ou guidé)': 'DC semi incliné haltères',
  'Dips': 'Dips press',
  'Développe militaire machine': 'Développe militaire',
  'Oiseaux Haltère épaules': 'Oiseau haltères',
  'Triceps poulie': 'Extension triceps poulie',
};
const nomFusionne = (nom) => FUSIONS_NOMS[nom] || nom;

/* Renomme les variantes dans les séances déjà enregistrées (cas d'un import fait
   avant la fusion). Idempotent : ne touche que les séances concernées.
   Renvoie le nombre de séances modifiées. */
export async function appliquerFusionsNoms() {
  let n = 0;
  for (const s of await toutesLesSeances()) {
    let modifie = false;
    for (const e of s.exercices || []) {
      const cible = nomFusionne(e.nom);
      if (cible !== e.nom) { e.nom = cible; modifie = true; }
    }
    if (modifie) { await sauverSeance(s); n += 1; }
  }
  return n;
}

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
  if (typeof s.type !== 'string' || !cleExercice(s.type) || cleExercice(s.type) === 'tous') return null;
  // Type existant (majuscules/accents ignorés) ou nouveau type à créer
  const type = typeConnu(s.type) || nomPropre(s.type);
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
    if (sets.length) exercices.push({ nom: nomFusionne(nom), sets });
  }
  if (!exercices.length) return null;
  return { date: s.date, type, statut: 'terminee', exercices };
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
  // Bibliothèque (fichiers de sauvegarde) : exercices absents de la table actuelle
  const connus = new Set((await listeBibliotheque()).map((e) => e.cle));
  const exercices = (Array.isArray(json?.exercices) ? json.exercices : [])
    .filter((e) => e && typeof e.nom === 'string')
    .map((e) => ({ nom: nomFusionne(e.nom.trim().replace(/\s+/g, ' ')), types: e.types }))
    .filter((e) => { const k = cleExercice(e.nom); if (!k || connus.has(k)) return false; connus.add(k); return true; });
  // Types à créer : d'abord ceux de la liste du fichier (dans son ordre), puis ceux des séances
  const typesNouveaux = [];
  const vusTypes = new Set();
  const listeFichier = Array.isArray(json?.types) ? json.types.filter((t) => typeof t === 'string') : [];
  for (const t of [...listeFichier, ...nouvelles.map((x) => x.type)]) {
    const k = cleExercice(t);
    if (!k || k === 'tous' || typeConnu(t) || vusTypes.has(k)) continue;
    vusTypes.add(k);
    typesNouveaux.push(nomPropre(t));
  }
  return { nouvelles, doublons, invalides, exercices, typesNouveaux };
}

/* Parcours complet : sélection du fichier, aperçu, confirmation, écriture.
   Renvoie le nombre de séances importées (0 si annulé), ou lève une Error lisible. */
export async function importerDepuisFichier() {
  const fichier = await choisirFichier();
  if (!fichier) return 0;
  const { nouvelles, doublons, invalides, exercices, typesNouveaux } = await analyserImport(await fichier.text());

  const ignorees = [];
  if (doublons) ignorees.push(`${doublons} déjà présente${doublons > 1 ? 's' : ''}`);
  if (invalides) ignorees.push(`${invalides} vide${invalides > 1 ? 's' : ''} ou invalide${invalides > 1 ? 's' : ''}`);
  const suffixe = ignorees.length ? ` Ignorées : ${ignorees.join(', ')}.` : '';

  const txtExos = exercices.length ? ` + ${exercices.length} exercice${exercices.length > 1 ? 's' : ''} de bibliothèque.` : '';
  const nT = typesNouveaux.length;
  const txtTypes = nT ? ` Nouveau${nT > 1 ? 'x' : ''} type${nT > 1 ? 's' : ''} de séance créé${nT > 1 ? 's' : ''} : ${typesNouveaux.join(', ')}.` : '';
  if (!nouvelles.length && !exercices.length && !nT) throw new Error(`Rien à importer.${suffixe}`);
  if (!nouvelles.length) {
    const titre = exercices.length
      ? `Importer ${exercices.length} exercice${exercices.length > 1 ? 's' : ''}`
      : `Importer ${nT} type${nT > 1 ? 's' : ''} de séance`;
    const okExos = await demanderConfirmation(
      titre,
      `Aucune nouvelle séance.${suffixe}${exercices.length ? ` Exercices ajoutés à la bibliothèque : ${exercices.map((e) => e.nom).join(', ')}.` : ''}${txtTypes}`,
      'Importer',
    );
    if (!okExos) return 0;
    await ajouterTypesManquants(typesNouveaux);
    await ajouterExercicesManquants(exercices);
    document.dispatchEvent(new CustomEvent('donnees-changees'));
    return 0;
  }

  const parType = [...TYPES, ...typesNouveaux].map((t) => [t, nouvelles.filter((s) => s.type === t).length])
    .filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(', ');
  const ok = await demanderConfirmation(
    `Importer ${nouvelles.length} séance${nouvelles.length > 1 ? 's' : ''}`,
    `Du ${fmtDate(nouvelles[0].date)} au ${fmtDate(nouvelles[nouvelles.length - 1].date)} — ${parType}.${suffixe}${txtExos}${txtTypes}`,
    'Importer',
  );
  if (!ok) return 0;
  await ajouterTypesManquants(typesNouveaux); // avant les séances et les exercices qui les citent
  await ajouterSeances(nouvelles);
  if (exercices.length) await ajouterExercicesManquants(exercices);
  return nouvelles.length;
}

/* ---------- Export de sauvegarde (jalon 6) ---------- */

const CLE_SAUVEGARDE = 'derniere_sauvegarde';
export const DELAI_RAPPEL_JOURS = 30;

/* Le fichier est préparé à l'avance : sur iPhone, la feuille de partage doit s'ouvrir
   immédiatement après le tap, sans attente de lecture en base entre les deux. */
let fichierPrepare = null;

async function construireFichier() {
  const seances = (await listeSeancesTerminees())
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type))
    .map(({ date, type, statut, exercices }) => ({ date, type, statut, exercices }));
  const contenu = {
    format: 'suivi-muscu',
    version: 1,
    source: 'sauvegarde',
    genere_le: aujourdhui(),
    seances,
    types: [...TYPES], // types de séance, dans l'ordre choisi
    exercices: await exercicesPourExport(), // bibliothèque (noms + types)
  };
  const nom = `sauvegarde-suivi-muscu-${aujourdhui()}.json`;
  return { fichier: new File([JSON.stringify(contenu, null, 1)], nom, { type: 'application/json' }), nb: seances.length };
}

export async function preparerSauvegarde() {
  fichierPrepare = await construireFichier();
  return fichierPrepare.nb;
}

const repreparer = () => { fichierPrepare = null; preparerSauvegarde().catch(() => {}); };
document.addEventListener('donnees-changees', repreparer);
document.addEventListener('bibliotheque-changee', repreparer);

function telecharger(fichier) {
  const url = URL.createObjectURL(fichier);
  const a = document.createElement('a');
  a.href = url;
  a.download = fichier.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* Ouvre la feuille de partage iOS (« Enregistrer dans Fichiers », AirDrop, mail…)
   ou, à défaut, télécharge le fichier. Renvoie le nombre de séances exportées,
   0 si l'utilisateur a annulé. */
export async function exporterSauvegarde() {
  const { fichier, nb } = fichierPrepare || await construireFichier();
  if (nb === 0) throw new Error('Aucune séance à sauvegarder.');
  let partage = false;
  try {
    partage = Boolean(navigator.canShare && navigator.canShare({ files: [fichier] }));
  } catch { partage = false; }
  if (partage) {
    try {
      await navigator.share({ files: [fichier], title: fichier.name });
    } catch (e) {
      if (e && e.name === 'AbortError') return 0;
      telecharger(fichier); // partage refusé par le navigateur : repli sur le téléchargement
    }
  } else {
    telecharger(fichier);
  }
  await ecrireReglage(CLE_SAUVEGARDE, aujourdhui());
  document.dispatchEvent(new CustomEvent('sauvegarde-faite'));
  return nb;
}

/* ---------- Rappel 30 jours ---------- */

export async function derniereSauvegarde() {
  return lireReglage(CLE_SAUVEGARDE);
}

export function joursDepuis(iso) {
  const a = new Date(`${iso}T12:00:00`);
  const b = new Date(`${aujourdhui()}T12:00:00`);
  return Math.round((b - a) / 86400000);
}

/* null si pas de rappel, sinon le texte du rappel. */
export async function etatRappel() {
  const nb = (await listeSeancesTerminees()).length;
  if (nb === 0) return null;
  const derniere = await derniereSauvegarde();
  if (!derniere) return `Aucune sauvegarde de tes ${nb} séance${nb > 1 ? 's' : ''} pour l'instant.`;
  const j = joursDepuis(derniere);
  if (j <= DELAI_RAPPEL_JOURS) return null;
  return `Dernière sauvegarde il y a ${j} jours.`;
}

/* ---------- Stockage persistant ---------- */

/* Demande à iOS de ne pas purger les données de l'app. Sans effet visible ;
   l'app installée sur l'écran d'accueil est en général déjà protégée. */
export async function demanderPersistance() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* environnement sans accès au stockage */ }
  return false;
}
