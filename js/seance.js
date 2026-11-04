/* Écran Séance — création, pré-remplissage, saisie, enregistrement.
   Depuis le jalon 4, la saisie elle-même est assurée par editeur.js
   (partagé avec l'édition depuis l'Historique). */

import {
  getSeanceEnCours,
  derniereSeanceTerminee,
  sauverSeance,
  tonnage,
  totalReps,
  TYPES,
  aujourdhui,
} from './db.js';
import { monterEditeur, demanderConfirmation } from './editeur.js';

let seance = null;          // séance en cours (référence Dexie)
let modeCreation = false;    // écran de choix du type affiché
let timerSauvegarde = null;

/* ---------- Cycle de vie ---------- */

export async function initSeance() {
  seance = await getSeanceEnCours();
  modeCreation = false;
  document.querySelector('[data-action="nouvelle-seance"]').onclick = () => {
    modeCreation = true;
    rendre();
  };
  rendre();
}

function planifierSauvegarde() {
  clearTimeout(timerSauvegarde);
  timerSauvegarde = setTimeout(() => {
    if (seance) sauverSeance(seance).catch((e) => console.warn('Sauvegarde impossible :', e));
  }, 400);
}

function notifierDonneesChangees() {
  document.dispatchEvent(new CustomEvent('donnees-changees'));
}

/* ---------- Rendu principal ---------- */

function rendre() {
  const content = document.getElementById('seance-content');
  const empty = document.getElementById('seance-empty');
  const btnNew = document.querySelector('[data-action="nouvelle-seance"]');

  if (modeCreation) {
    empty.hidden = true;
    btnNew.hidden = true;
    content.replaceChildren(vueChoixType());
    return;
  }

  if (!seance) {
    empty.hidden = false;
    btnNew.hidden = false;
    content.replaceChildren();
    return;
  }

  empty.hidden = true;
  btnNew.hidden = true;
  monterEditeur(content, seance, {
    modeEdition: false,
    onChange: planifierSauvegarde,
    pied: (frag) => {
      const terminer = document.createElement('button');
      terminer.className = 'btn-primary btn-terminer';
      terminer.textContent = 'Terminer la séance';
      terminer.onclick = terminerSeance;
      frag.appendChild(terminer);
    },
  });
}

function vueChoixType() {
  const div = document.createElement('div');
  div.className = 'view-inner';

  const titre = document.createElement('h2');
  titre.textContent = 'Quel type de séance ?';
  div.appendChild(titre);

  const grid = document.createElement('div');
  grid.className = 'type-grid';
  TYPES.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'type-btn';
    b.textContent = t;
    b.onclick = () => creerSeance(t);
    grid.appendChild(b);
  });
  div.appendChild(grid);

  const annuler = document.createElement('button');
  annuler.className = 'btn-ghost';
  annuler.textContent = 'Annuler';
  annuler.onclick = () => { modeCreation = false; rendre(); };
  div.appendChild(annuler);

  return div;
}

/* ---------- Actions ---------- */

async function creerSeance(type) {
  const precedente = await derniereSeanceTerminee(type);

  seance = {
    date: aujourdhui(),
    type,
    statut: 'en_cours',
    exercices: precedente
      ? precedente.exercices.map((ex) => ({
          nom: ex.nom,
          sets: ex.sets.map((s) => ({ reps: s.reps, charge: s.charge, confirme: false })),
        }))
      : [],
  };

  await sauverSeance(seance);
  modeCreation = false;
  notifierDonneesChangees();
  rendre();

  if (precedente) notifierPreRempli(precedente);
}

function notifierPreRempli(precedente) {
  const content = document.getElementById('seance-content');
  const banniere = document.createElement('div');
  banniere.className = 'banniere-prerempli';
  banniere.textContent = `Pré-rempli depuis ta séance ${precedente.type} du ${formatDateFr(precedente.date)} — ajuste si besoin.`;
  setTimeout(() => banniere.remove(), 6000);
  content.prepend(banniere);
}

async function terminerSeance() {
  const zeroExercice = seance.exercices.length === 0;
  const confirme = await demanderConfirmation(
    'Terminer la séance ?',
    zeroExercice
      ? 'Cette séance ne contient aucun exercice.'
      : `Tonnage : ${Math.round(tonnage(seance)).toLocaleString('fr-FR')} kg · ${totalReps(seance)} reps`,
    'Terminer'
  );
  if (!confirme) return;

  clearTimeout(timerSauvegarde);
  seance.statut = 'terminee';
  await sauverSeance(seance);
  seance = null;
  notifierDonneesChangees();
  rendre();
}

/* ---------- Divers ---------- */

function formatDateFr(iso) {
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}
