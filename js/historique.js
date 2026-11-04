/* Écran Historique — jalon 4.
   Liste chronologique des séances terminées, groupée par mois, filtrable par type.
   Un tap ouvre la séance en édition complète (mêmes contrôles que la saisie).
   Les corrections ne sont écrites qu'au tap sur « Enregistrer » : on peut abandonner. */

import {
  listeSeancesTerminees,
  getSeance,
  sauverSeance,
  supprimerSeance,
  tonnage,
  totalReps,
  kgParRep,
  TYPES,
} from './db.js';
import { monterEditeur, demanderConfirmation } from './editeur.js';

let filtre = 'Tous';
/* Édition en cours : { copie, modifie }. Conservée si on change d'onglet. */
let edition = null;

function notifierDonneesChangees() {
  document.dispatchEvent(new CustomEvent('donnees-changees'));
}

/* ---------- Formatage ---------- */

const fmtMois = (iso) => {
  const d = new Date(`${iso.slice(0, 7)}-15T12:00:00`);
  const t = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const fmtJour = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  const t = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const fmtMetriques = (s) => {
  const r = totalReps(s);
  const kg = r > 0 ? kgParRep(s).toFixed(1).replace('.', ',') : '0';
  return `${Math.round(tonnage(s)).toLocaleString('fr-FR')} kg · ${r} reps · ${kg} kg/r`;
};

/* ---------- Entrée ---------- */

export async function initHistorique() {
  if (edition) {
    rendreEdition();
    return;
  }
  await rendreListe();
}

/* ---------- Liste ---------- */

async function rendreListe() {
  const content = document.getElementById('historique-content');
  const empty = document.getElementById('historique-empty');
  const seances = await listeSeancesTerminees();

  if (seances.length === 0) {
    empty.hidden = false;
    content.replaceChildren();
    return;
  }
  empty.hidden = true;

  const wrap = document.createElement('div');
  wrap.className = 'view-inner histo';

  wrap.appendChild(filtres(seances));

  const visibles = filtre === 'Tous' ? seances : seances.filter((s) => s.type === filtre);

  const compte = document.createElement('p');
  compte.className = 'histo-compte';
  compte.textContent = `${visibles.length} séance${visibles.length > 1 ? 's' : ''}`;
  wrap.appendChild(compte);

  if (visibles.length === 0) {
    const vide = document.createElement('div');
    vide.className = 'evo-vide';
    vide.textContent = `Aucune séance ${filtre} enregistrée.`;
    wrap.appendChild(vide);
  }

  // Groupement par mois (séances déjà triées de la plus récente à la plus ancienne)
  let moisCourant = null;
  let groupe = null;
  for (const s of visibles) {
    const mois = s.date.slice(0, 7);
    if (mois !== moisCourant) {
      moisCourant = mois;
      const h = document.createElement('h3');
      h.className = 'histo-mois';
      h.textContent = fmtMois(s.date);
      groupe = document.createElement('div');
      groupe.className = 'histo-groupe';
      wrap.append(h, groupe);
    }
    groupe.appendChild(ligneSeance(s));
  }

  content.replaceChildren(wrap);
}

function filtres(seances) {
  const g = document.createElement('div');
  g.className = 'segmente segmente-histo';
  g.setAttribute('role', 'tablist');
  g.setAttribute('aria-label', 'Filtrer par type');
  for (const t of ['Tous', ...TYPES]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(t === filtre));
    b.dataset.valeur = t;
    b.textContent = t;
    b.onclick = () => { filtre = t; rendreListe(); };
    g.appendChild(b);
  }
  return g;
}

function ligneSeance(s) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'histo-ligne';
  b.setAttribute('aria-label', `Modifier la séance ${s.type} du ${fmtJour(s.date)}`);

  const gauche = document.createElement('div');
  gauche.className = 'histo-ligne-texte';

  const haut = document.createElement('div');
  haut.className = 'histo-ligne-haut';
  const type = document.createElement('span');
  type.className = 'histo-type';
  type.textContent = s.type;
  const date = document.createElement('span');
  date.className = 'histo-date';
  date.textContent = fmtJour(s.date);
  haut.append(type, date);

  const bas = document.createElement('span');
  bas.className = 'histo-metriques';
  const nbExos = (s.exercices || []).length;
  bas.textContent = `${fmtMetriques(s)} · ${nbExos} exo${nbExos > 1 ? 's' : ''}`;

  gauche.append(haut, bas);

  const chevron = document.createElement('span');
  chevron.className = 'histo-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

  b.append(gauche, chevron);
  b.onclick = () => ouvrirEdition(s.id);
  return b;
}

/* ---------- Édition ---------- */

async function ouvrirEdition(id) {
  const s = await getSeance(id);
  if (!s) return rendreListe();
  // Copie de travail : la base n'est modifiée qu'à l'enregistrement
  edition = { copie: structuredClone(s), modifie: false };
  rendreEdition();
  window.scrollTo(0, 0);
}

function rendreEdition() {
  const content = document.getElementById('historique-content');
  document.getElementById('historique-empty').hidden = true;

  const wrap = document.createElement('div');
  wrap.className = 'view-inner';

  const barre = document.createElement('div');
  barre.className = 'histo-barre';
  const retour = document.createElement('button');
  retour.type = 'button';
  retour.className = 'histo-retour';
  retour.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg><span>Historique</span>';
  retour.onclick = quitterEdition;
  const etat = document.createElement('span');
  etat.className = 'histo-etat';
  etat.dataset.role = 'etat';
  barre.append(retour, etat);

  const zone = document.createElement('div');
  zone.className = 'view-inner';

  wrap.append(barre, zone);
  content.replaceChildren(wrap);

  const majEtat = () => {
    etat.textContent = edition.modifie ? 'Modifications non enregistrées' : '';
    const btn = zone.querySelector('[data-action="enregistrer"]');
    if (btn) btn.disabled = !edition.modifie;
  };

  monterEditeur(zone, edition.copie, {
    modeEdition: true,
    onChange: () => { edition.modifie = true; majEtat(); },
    pied: (frag) => {
      const enregistrer = document.createElement('button');
      enregistrer.className = 'btn-primary btn-terminer';
      enregistrer.dataset.action = 'enregistrer';
      enregistrer.textContent = 'Enregistrer les modifications';
      enregistrer.disabled = !edition.modifie;
      enregistrer.onclick = enregistrerEdition;

      const supprimer = document.createElement('button');
      supprimer.className = 'btn-ghost btn-ghost-danger';
      supprimer.textContent = 'Supprimer cette séance';
      supprimer.onclick = supprimerEdition;

      frag.append(enregistrer, supprimer);
    },
  });
  majEtat();
}

async function enregistrerEdition() {
  if (!edition) return;
  await sauverSeance(edition.copie);
  edition = null;
  notifierDonneesChangees();
  await rendreListe();
  toast('Séance mise à jour');
}

async function quitterEdition() {
  if (edition && edition.modifie) {
    const ok = await demanderConfirmation(
      'Abandonner les modifications ?',
      'Les changements faits sur cette séance ne seront pas enregistrés.',
      'Abandonner',
      { danger: true },
    );
    if (!ok) return;
  }
  edition = null;
  await rendreListe();
}

async function supprimerEdition() {
  if (!edition) return;
  const s = edition.copie;
  const ok = await demanderConfirmation(
    'Supprimer cette séance ?',
    `${s.type} du ${fmtJour(s.date)} — ${fmtMetriques(s)}. Cette action est définitive.`,
    'Supprimer',
    { danger: true },
  );
  if (!ok) return;
  await supprimerSeance(s.id);
  edition = null;
  notifierDonneesChangees();
  await rendreListe();
  toast('Séance supprimée');
}

function toast(message) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}
