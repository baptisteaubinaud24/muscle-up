/* Couche base de données — Dexie (IndexedDB) */

import './vendor/dexie.min.js';

const db = new Dexie('suivi-muscu');

// v1 du schéma : table séances
db.version(1).stores({
  seances: '++id, date, type, statut',
});

/* ---------- Métriques ---------- */

export function tonnage(seance) {
  return (seance.exercices || []).reduce((total, ex) => {
    return total + (ex.sets || []).reduce((t, s) => t + (s.reps || 0) * (s.charge || 0), 0);
  }, 0);
}

export function totalReps(seance) {
  return (seance.exercices || []).reduce((total, ex) => {
    return total + (ex.sets || []).reduce((t, s) => t + (s.reps || 0), 0);
  }, 0);
}

export function kgParRep(seance) {
  const reps = totalReps(seance);
  return reps > 0 ? tonnage(seance) / reps : 0;
}

/* ---------- Requêtes ---------- */

export async function getSeanceEnCours() {
  return db.seances.where('statut').equals('en_cours').first();
}

export async function derniereSeanceTerminee(type) {
  const seances = await db.seances
    .where('type').equals(type)
    .and((s) => s.statut === 'terminee')
    .toArray();
  seances.sort((a, b) => (a.date < b.date ? 1 : -1));
  return seances[0] || null;
}

export async function listeSeancesTerminees() {
  const seances = await db.seances.where('statut').equals('terminee').toArray();
  seances.sort((a, b) => (a.date < b.date ? 1 : -1));
  return seances;
}

export async function getSeance(id) {
  return db.seances.get(id);
}

export async function sauverSeance(seance) {
  if (seance.id === undefined) {
    return db.seances.add(seance);
  }
  return db.seances.put(seance);
}

export async function ajouterSeances(liste) {
  return db.seances.bulkAdd(liste);
}

export async function toutesLesSeances() {
  return db.seances.toArray();
}

export async function supprimerSeance(id) {
  return db.seances.delete(id);
}

/* Bibliothèque implicite : noms d'exercices déjà utilisés,
   triés par fréquence d'utilisation. */
export async function bibliothequeExercices() {
  const seances = await db.seances.toArray();
  const counts = new Map();
  for (const s of seances) {
    for (const ex of s.exercices || []) {
      counts.set(ex.nom, (counts.get(ex.nom) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([nom]) => nom);
}

export async function nbSeances() {
  return db.seances.count();
}

export const TYPES = ['Pecs', 'Dos', 'Superset Bras', 'Legs'];

export function aujourdhui() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${j}`;
}
