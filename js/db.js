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

// v4 (types de séance modifiables) : ajout d'une table types { nom, cle, ordre }.
// `cle` = nom normalisé, unique. Les séances gardent le nom du type en clair.
// Tables existantes inchangées ; la table est remplie au démarrage par chargerTypes().
db.version(4).stores({
  seances: '++id, date, type, statut',
  reglages: 'cle',
  exercices: '++id, &cle',
  types: '++id, &cle, ordre',
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

/* ---------- Types de séance ---------- */

const TYPES_INITIAUX = ['Pecs', 'Dos', 'Superset Bras', 'Legs'];

/* Liste des noms de types, dans l'ordre choisi. Tableau partagé par tous les écrans :
   il est mis à jour sur place par chargerTypes() (jamais réaffecté), donc chaque module
   qui l'importe voit toujours la liste à jour. Valeurs initiales = filet de sécurité si
   le stockage est indisponible. */
export const TYPES = [...TYPES_INITIAUX];

function signalerTypes(detail = {}) {
  try {
    document.dispatchEvent(new CustomEvent('types-changes', { detail }));
    document.dispatchEvent(new CustomEvent('bibliotheque-changee')); // sauvegarde à refaire
  } catch { /* hors navigateur */ }
}

/* Lit la table types et met TYPES à jour. Au premier lancement, la remplit avec les
   4 types d'origine ; ajoute aussi tout type présent dans les séances mais absent. */
export async function chargerTypes() {
  await db.transaction('rw', db.types, db.seances, async () => {
    const existants = await db.types.toArray();
    const cles = new Set(existants.map((t) => t.cle));
    let ordre = existants.reduce((m, t) => Math.max(m, t.ordre), -1);
    const aAjouter = [];
    const candidat = (nom) => {
      const n = nomPropre(nom);
      const c = cleExercice(n);
      if (c && !cles.has(c)) { cles.add(c); aAjouter.push({ nom: n, cle: c, ordre: ++ordre }); }
    };
    if (!existants.length) TYPES_INITIAUX.forEach(candidat);
    for (const s of await db.seances.toArray()) candidat(s.type);
    if (aAjouter.length) await db.types.bulkAdd(aAjouter);
  });
  const liste = await db.types.orderBy('ordre').toArray();
  TYPES.splice(0, TYPES.length, ...liste.map((t) => t.nom));
  return TYPES;
}

/* Types avec leur nombre de séances terminées (écran Bibliothèque). */
export async function listeTypes() {
  const nb = new Map();
  for (const s of await db.seances.where('statut').equals('terminee').toArray()) nb.set(s.type, (nb.get(s.type) || 0) + 1);
  return (await db.types.orderBy('ordre').toArray()).map((t) => ({ ...t, nb: nb.get(t.nom) || 0 }));
}

async function verifierNomType(nom, idExclu) {
  const propre = nomPropre(nom);
  const cle = cleExercice(propre);
  if (!cle) throw new Error('Donne un nom au type de séance.');
  if (propre.length > 30) throw new Error('Nom trop long (30 caractères maximum).');
  if (cle === 'tous') throw new Error('« Tous » est réservé au filtre des écrans.');
  const existant = await db.types.where('cle').equals(cle).first();
  if (existant && existant.id !== idExclu) throw new Error(`Le type « ${existant.nom} » existe déjà.`);
  return { propre, cle };
}

/* Ajoute un type en fin de liste. */
export async function ajouterType(nom) {
  const { propre, cle } = await verifierNomType(nom);
  const dernier = await db.types.orderBy('ordre').last();
  await db.types.add({ nom: propre, cle, ordre: dernier ? dernier.ordre + 1 : 0 });
  await chargerTypes();
  signalerTypes({ ajoute: propre });
  return propre;
}

/* Ajoute les types absents (import), en fin de liste, dans l'ordre donné. Renvoie les ajoutés. */
export async function ajouterTypesManquants(noms) {
  const ajoutes = [];
  for (const n of noms || []) {
    const propre = nomPropre(n);
    const cle = cleExercice(propre);
    if (!cle || cle === 'tous' || (await db.types.where('cle').equals(cle).first())) continue;
    const dernier = await db.types.orderBy('ordre').last();
    await db.types.add({ nom: propre, cle, ordre: dernier ? dernier.ordre + 1 : 0 });
    ajoutes.push(propre);
  }
  if (ajoutes.length) { await chargerTypes(); signalerTypes({ ajoutes }); }
  return ajoutes;
}

/* Nom officiel d'un type à partir d'une saisie (majuscules/accents ignorés), ou null. */
export function typeConnu(nom) {
  const c = cleExercice(nom);
  return TYPES.find((t) => cleExercice(t) === c) || null;
}

/* Renomme un type partout, en une seule transaction (tout ou rien) :
   table types, séances (terminées et en cours) et types rattachés aux exercices. */
export async function renommerType(id, nouveauNom) {
  const type = await db.types.get(id);
  if (!type) throw new Error('Type introuvable.');
  const { propre, cle } = await verifierNomType(nouveauNom, id);
  const ancien = type.nom;
  if (propre === ancien) return { ancien, nouveau: propre, nb: 0 };
  let nb = 0;
  await db.transaction('rw', db.types, db.seances, db.exercices, async () => {
    await db.types.update(id, { nom: propre, cle });
    nb = await db.seances.where('type').equals(ancien).modify({ type: propre });
    await db.exercices
      .filter((e) => Array.isArray(e.types) && e.types.includes(ancien))
      .modify((e) => { e.types = e.types.map((t) => (t === ancien ? propre : t)); });
  });
  await chargerTypes();
  signalerTypes({ ancien, nouveau: propre });
  try { document.dispatchEvent(new CustomEvent('donnees-changees')); } catch { /* hors navigateur */ }
  return { ancien, nouveau: propre, nb };
}

/* Déplace un type d'un cran (sens = -1 vers le haut, +1 vers le bas). */
export async function deplacerType(id, sens) {
  await db.transaction('rw', db.types, async () => {
    const liste = await db.types.orderBy('ordre').toArray();
    const i = liste.findIndex((t) => t.id === id);
    const j = i + sens;
    if (i < 0 || j < 0 || j >= liste.length) return;
    [liste[i], liste[j]] = [liste[j], liste[i]];
    // Renumérotation complète : l'ordre reste propre (0, 1, 2…)
    await Promise.all(liste.map((t, k) => db.types.update(t.id, { ordre: k })));
  });
  await chargerTypes();
  signalerTypes({ deplace: id });
}

export function aujourdhui() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${j}`;
}
