/* Couche base de données — Dexie (IndexedDB) */

import './vendor/dexie.min.js';

const db = new Dexie('suivi-muscu');

// v1 du schéma : table séances
db.version(1).stores({
  seances: '++id, date, type, statut',
});

// v2 (jalon 6) : ajout d'une table de réglages clé/valeur (date de dernière sauvegarde).
// La table séances est inchangée : aucune migration de données.
db.version(2).stores({
  seances: '++id, date, type, statut',
  reglages: 'cle',
});

// v3 (bibliothèque d'exercices) : ajout d'une table exercices.
// `cle` = nom normalisé (sans accents ni majuscules), unique : empêche les doublons.
// Tables existantes inchangées.
db.version(3).stores({
  seances: '++id, date, type, statut',
  reglages: 'cle',
  exercices: '++id, &cle',
});

export async function lireReglage(cle) {
  const r = await db.reglages.get(cle);
  return r ? r.valeur : undefined;
}

export async function ecrireReglage(cle, valeur) {
  return db.reglages.put({ cle, valeur });
}

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

/* ---------- Bibliothèque d'exercices ---------- */

/* Signale toute écriture dans la bibliothèque (ex. : la sauvegarde préparée doit être refaite). */
function signalerBibliotheque() {
  try { document.dispatchEvent(new CustomEvent('bibliotheque-changee')); } catch { /* hors navigateur */ }
}

/* Clé de comparaison : « Développé militaire » = « developpe  MILITAIRE ». */
export function cleExercice(nom) {
  return String(nom || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function nomPropre(nom) {
  const n = String(nom || '').replace(/\s+/g, ' ').trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/* Statistiques d'usage par clé : nombre de séances terminées et types où l'exercice apparaît. */
async function usageExercices() {
  const usage = new Map();
  for (const s of await db.seances.toArray()) {
    if (s.statut !== 'terminee') continue;
    const vus = new Set();
    for (const ex of s.exercices || []) {
      const k = cleExercice(ex.nom);
      if (!k || vus.has(k)) continue;
      vus.add(k);
      const u = usage.get(k) || { nom: ex.nom, nb: 0, types: new Set(), derniere: '' };
      u.nb += 1;
      u.types.add(s.type);
      if (s.date > u.derniere) u.derniere = s.date;
      usage.set(k, u);
    }
  }
  return usage;
}

/* Ajoute à la bibliothèque tout nom présent dans les séances mais absent de la table
   (premier lancement, import, séance saisie). Les types initiaux sont ceux de l'historique.
   N'écrase jamais une entrée existante. Renvoie le nombre d'exercices ajoutés. */
export async function synchroniserBibliotheque() {
  const existants = new Set((await db.exercices.toArray()).map((e) => e.cle));
  const usage = await usageExercices();
  // Les séances en cours comptent aussi (exercice créé puis séance pas encore terminée)
  for (const s of await db.seances.where('statut').equals('en_cours').toArray()) {
    for (const ex of s.exercices || []) {
      const k = cleExercice(ex.nom);
      if (k && !usage.has(k)) usage.set(k, { nom: ex.nom, nb: 0, types: new Set([s.type]) });
    }
  }
  const nouveaux = [];
  for (const [cle, u] of usage) {
    if (existants.has(cle)) continue;
    nouveaux.push({ nom: nomPropre(u.nom), cle, types: TYPES.filter((t) => u.types.has(t)) });
  }
  if (nouveaux.length) { await db.exercices.bulkAdd(nouveaux); signalerBibliotheque(); }
  return nouveaux.length;
}

/* Liste de la bibliothèque, enrichie de l'usage, triée par fréquence puis par nom. */
export async function listeBibliotheque() {
  const usage = await usageExercices();
  const liste = (await db.exercices.toArray()).map((e) => {
    const u = usage.get(e.cle);
    return { ...e, nb: u ? u.nb : 0, derniere: u ? u.derniere : '' };
  });
  liste.sort((a, b) => b.nb - a.nb || a.nom.localeCompare(b.nom, 'fr'));
  return liste;
}

export async function trouverExercice(nom) {
  return db.exercices.where('cle').equals(cleExercice(nom)).first();
}

/* Crée un exercice ; lève une Error lisible si le nom est vide ou déjà pris. */
export async function creerExercice(nom, types = []) {
  const propre = nomPropre(nom);
  const cle = cleExercice(propre);
  if (!cle) throw new Error('Donne un nom à l\'exercice.');
  const existant = await trouverExercice(propre);
  if (existant) throw new Error(`« ${existant.nom} » existe déjà dans la bibliothèque.`);
  const exo = { nom: propre, cle, types: TYPES.filter((t) => types.includes(t)) };
  exo.id = await db.exercices.add(exo);
  signalerBibliotheque();
  return exo;
}

export async function modifierTypesExercice(id, types) {
  const r = await db.exercices.update(id, { types: TYPES.filter((t) => types.includes(t)) });
  signalerBibliotheque();
  return r;
}

/* Ajoute un type à un exercice existant (quand on l'utilise dans une séance de ce type). */
export async function rattacherType(nom, type) {
  const e = await trouverExercice(nom);
  if (e && !e.types.includes(type)) await modifierTypesExercice(e.id, [...e.types, type]);
}

/* Import : ajoute les exercices absents ({ nom, types }) ; ceux déjà présents sont laissés tels quels. */
export async function ajouterExercicesManquants(liste) {
  const existants = new Set((await db.exercices.toArray()).map((e) => e.cle));
  const nouveaux = [];
  for (const e of liste || []) {
    const nom = nomPropre(e && e.nom);
    const cle = cleExercice(nom);
    if (!cle || existants.has(cle)) continue;
    existants.add(cle);
    const types = Array.isArray(e.types) ? TYPES.filter((t) => e.types.includes(t)) : [];
    nouveaux.push({ nom, cle, types });
  }
  if (nouveaux.length) { await db.exercices.bulkAdd(nouveaux); signalerBibliotheque(); }
  return nouveaux.length;
}

export async function exercicesPourExport() {
  return (await db.exercices.toArray())
    .map(({ nom, types }) => ({ nom, types }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/* Compatibilité : noms connus, triés par fréquence. */
export async function bibliothequeExercices() {
  return (await listeBibliotheque()).map((e) => e.nom);
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
