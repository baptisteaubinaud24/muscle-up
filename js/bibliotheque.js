/* Écran Bibliothèque — deux sections, choisies par un sélecteur en haut d'écran :
   - Exercices : liste (recherche + filtre par type de séance), création (nom + types),
     modification des types d'un exercice (pas de renommage ni de suppression d'exercice) ;
   - Types de séance : liste ordonnée, ajout, renommage, réordonnancement par flèches
     (pas de suppression dans cette version, décision du 04/11/2026). */

import {
  listeBibliotheque,
  creerExercice,
  modifierTypesExercice,
  TYPES,
  listeTypes,
  ajouterType,
  renommerType,
  deplacerType,
} from './db.js';
import { ajusterSegmente } from './editeur.js';

let section = 'exercices'; // 'exercices' | 'types'
let filtre = 'Tous';

/* Un type renommé : le filtre suit le nouveau nom */
document.addEventListener('types-changes', (ev) => {
  const d = ev.detail || {};
  if (d.ancien && filtre === d.ancien) filtre = d.nouveau;
  if (filtre !== 'Tous' && !TYPES.includes(filtre)) filtre = 'Tous';
});
let recherche = '';

const cle = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function toast(message) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

export async function initBibliotheque() {
  await rendre();
}

/* Sélecteur de section en haut de l'écran */
function selecteurSection() {
  const g = document.createElement('div');
  g.className = 'segmente segmente-sections';
  g.setAttribute('role', 'tablist');
  g.setAttribute('aria-label', 'Section de la bibliothèque');
  for (const [id, label] of [['exercices', 'Exercices'], ['types', 'Types de séance']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(section === id));
    b.dataset.section = id;
    b.textContent = label;
    b.onclick = () => { if (section !== id) { section = id; rendre(); } };
    g.appendChild(b);
  }
  return g;
}

async function rendre(garderFocus = false) {
  if (section === 'types') { await rendreTypes(); return; }
  const content = document.getElementById('bibliotheque-content');
  const liste = await listeBibliotheque();

  const wrap = document.createElement('div');
  wrap.className = 'view-inner biblio';
  wrap.appendChild(selecteurSection());

  const creer = document.createElement('button');
  creer.type = 'button';
  creer.className = 'btn-primary';
  creer.textContent = 'Créer un exercice';
  creer.onclick = () => feuilleExercice(null);
  wrap.appendChild(creer);

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'recherche-input';
  input.placeholder = 'Rechercher un exercice…';
  input.setAttribute('aria-label', 'Rechercher un exercice');
  input.value = recherche;
  input.addEventListener('input', () => { recherche = input.value; majListe(); });
  wrap.appendChild(input);

  const seg = document.createElement('div');
  seg.className = 'segmente segmente-histo';
  seg.setAttribute('role', 'tablist');
  seg.setAttribute('aria-label', 'Filtrer par type');
  for (const t of ['Tous', ...TYPES]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(t === filtre));
    b.textContent = t;
    b.onclick = () => {
      filtre = t;
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      majListe();
    };
    seg.appendChild(b);
  }
  ajusterSegmente(seg);
  wrap.appendChild(seg);

  const compte = document.createElement('p');
  compte.className = 'histo-compte';
  wrap.appendChild(compte);

  const zone = document.createElement('div');
  wrap.appendChild(zone);

  function majListe() {
    const q = cle(recherche);
    const visibles = liste.filter((e) => (filtre === 'Tous' || e.types.includes(filtre)) && (!q || e.cle.includes(q)));
    compte.textContent = `${visibles.length} exercice${visibles.length > 1 ? 's' : ''}`;
    zone.replaceChildren();
    if (!visibles.length) {
      const vide = document.createElement('div');
      vide.className = 'evo-vide';
      vide.textContent = liste.length
        ? 'Aucun exercice ne correspond.'
        : 'Bibliothèque vide. Crée un exercice ou termine une séance pour la remplir.';
      zone.appendChild(vide);
      return;
    }
    const groupe = document.createElement('div');
    groupe.className = 'histo-groupe';
    for (const e of visibles) groupe.appendChild(ligne(e));
    zone.appendChild(groupe);
  }

  majListe();
  content.replaceChildren(wrap);
  if (garderFocus) input.focus();
}

function ligne(e) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'histo-ligne biblio-ligne';
  b.setAttribute('aria-label', `${e.nom}, modifier les types`);

  const texte = document.createElement('span');
  texte.className = 'histo-ligne-texte';
  const nom = document.createElement('span');
  nom.className = 'biblio-nom';
  nom.textContent = e.nom;
  const meta = document.createElement('span');
  meta.className = 'histo-metriques';
  const usage = e.nb
    ? `${e.nb} séance${e.nb > 1 ? 's' : ''} · dernière le ${fmtDate(e.derniere)}`
    : 'jamais utilisé';
  meta.textContent = usage;
  const types = document.createElement('span');
  types.className = 'biblio-types';
  if (e.types.length) {
    for (const t of e.types) {
      const c = document.createElement('span');
      c.className = 'biblio-type';
      c.textContent = t;
      types.appendChild(c);
    }
  } else {
    const c = document.createElement('span');
    c.className = 'biblio-type biblio-type-vide';
    c.textContent = 'Sans type';
    types.appendChild(c);
  }
  texte.append(nom, types, meta);

  const chevron = document.createElement('span');
  chevron.className = 'histo-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

  b.append(texte, chevron);
  b.onclick = () => feuilleExercice(e);
  return b;
}

/* Feuille de création (exo = null) ou de modification des types. */
function feuilleExercice(exo) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', exo ? exo.nom : 'Créer un exercice');

  const h = document.createElement('h2');
  h.textContent = exo ? exo.nom : 'Créer un exercice';
  sheet.appendChild(h);

  let input = null;
  if (!exo) {
    input = document.createElement('input');
    input.type = 'text';
    input.className = 'recherche-input';
    input.placeholder = "Nom de l'exercice";
    input.setAttribute('aria-label', "Nom de l'exercice");
    input.value = recherche.trim();
    sheet.appendChild(input);
  }

  const lbl = document.createElement('p');
  lbl.className = 'sheet-soustexte';
  lbl.textContent = exo
    ? 'Types de séance où cet exercice est proposé en premier :'
    : 'Types de séance (facultatif, plusieurs possibles) :';
  sheet.appendChild(lbl);

  const choix = new Set(exo ? exo.types : (filtre !== 'Tous' ? [filtre] : []));
  const grille = document.createElement('div');
  grille.className = 'biblio-choix-types';
  for (const t of TYPES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'biblio-choix';
    b.setAttribute('aria-pressed', String(choix.has(t)));
    b.textContent = t;
    b.onclick = () => {
      if (choix.has(t)) choix.delete(t); else choix.add(t);
      b.setAttribute('aria-pressed', String(choix.has(t)));
    };
    grille.appendChild(b);
  }
  sheet.appendChild(grille);

  const erreur = document.createElement('p');
  erreur.className = 'biblio-erreur';
  erreur.setAttribute('role', 'alert');
  sheet.appendChild(erreur);

  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'btn-primary';
  ok.textContent = exo ? 'Enregistrer' : 'Créer';
  ok.onclick = async () => {
    try {
      if (exo) {
        await modifierTypesExercice(exo.id, [...choix]);
        toast('Types mis à jour');
      } else {
        const cree = await creerExercice(input.value, [...choix]);
        recherche = '';
        toast(`« ${cree.nom} » ajouté à la bibliothèque`);
      }
      overlay.remove();
      await rendre();
    } catch (e) {
      erreur.textContent = e.message || 'Enregistrement impossible';
    }
  };
  sheet.appendChild(ok);

  const annuler = document.createElement('button');
  annuler.type = 'button';
  annuler.className = 'btn-ghost';
  annuler.textContent = 'Annuler';
  annuler.onclick = () => overlay.remove();
  sheet.appendChild(annuler);

  overlay.appendChild(sheet);
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  if (input) {
    input.focus();
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ok.click(); });
  }
}

/* ==================== Section Types de séance ==================== */

const svgFleche = (haut) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${haut ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'}"/></svg>`;

async function rendreTypes() {
  const content = document.getElementById('bibliotheque-content');
  const types = await listeTypes();

  const wrap = document.createElement('div');
  wrap.className = 'view-inner biblio';
  wrap.appendChild(selecteurSection());

  const ajouter = document.createElement('button');
  ajouter.type = 'button';
  ajouter.className = 'btn-primary';
  ajouter.textContent = 'Ajouter un type';
  ajouter.onclick = () => feuilleType(null);
  wrap.appendChild(ajouter);

  const note = document.createElement('p');
  note.className = 'histo-compte';
  note.textContent = `${types.length} type${types.length > 1 ? 's' : ''} · l'ordre choisi ici est repris partout (choix du type, filtres)`;
  wrap.appendChild(note);

  const groupe = document.createElement('div');
  groupe.className = 'histo-groupe';
  types.forEach((t, i) => groupe.appendChild(ligneType(t, i, types.length)));
  wrap.appendChild(groupe);

  content.replaceChildren(wrap);
}

function ligneType(t, i, n) {
  const row = document.createElement('div');
  row.className = 'histo-ligne type-ligne';

  const corps = document.createElement('button');
  corps.type = 'button';
  corps.className = 'type-ligne-corps';
  corps.setAttribute('aria-label', `${t.nom}, renommer`);
  const texte = document.createElement('span');
  texte.className = 'histo-ligne-texte';
  const nom = document.createElement('span');
  nom.className = 'biblio-nom';
  nom.textContent = t.nom;
  const meta = document.createElement('span');
  meta.className = 'histo-metriques';
  meta.textContent = t.nb ? `${t.nb} séance${t.nb > 1 ? 's' : ''}` : 'aucune séance';
  texte.append(nom, meta);
  corps.appendChild(texte);
  corps.onclick = () => feuilleType(t);

  const fleches = document.createElement('span');
  fleches.className = 'type-fleches';
  for (const [sens, haut, lbl] of [[-1, true, 'Monter'], [1, false, 'Descendre']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-icone type-fleche';
    b.innerHTML = svgFleche(haut);
    b.setAttribute('aria-label', `${lbl} ${t.nom}`);
    b.disabled = haut ? i === 0 : i === n - 1;
    b.onclick = async () => {
      try { await deplacerType(t.id, sens); await rendreTypes(); } catch (e) { toast(e.message || 'Déplacement impossible'); }
    };
    fleches.appendChild(b);
  }

  row.append(corps, fleches);
  return row;
}

/* Feuille d'ajout (type = null) ou de renommage. */
function feuilleType(type) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', type ? `Renommer ${type.nom}` : 'Ajouter un type de séance');

  const h = document.createElement('h2');
  h.textContent = type ? 'Renommer le type' : 'Ajouter un type de séance';
  sheet.appendChild(h);

  if (type) {
    const p = document.createElement('p');
    p.className = 'sheet-soustexte';
    p.textContent = type.nb
      ? `Le nouveau nom s'applique aussi aux ${type.nb} séance${type.nb > 1 ? 's' : ''} « ${type.nom} » déjà enregistrée${type.nb > 1 ? 's' : ''} et aux exercices rattachés.`
      : 'Le nouveau nom s\'applique aussi aux exercices rattachés à ce type.';
    sheet.appendChild(p);
  } else {
    const p = document.createElement('p');
    p.className = 'sheet-soustexte';
    p.textContent = 'Le type est ajouté en fin de liste. Sa première séance démarrera vide.';
    sheet.appendChild(p);
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'recherche-input';
  input.placeholder = 'Nom du type (ex. Épaules)';
  input.setAttribute('aria-label', 'Nom du type de séance');
  input.maxLength = 30;
  input.value = type ? type.nom : '';
  sheet.appendChild(input);

  const erreur = document.createElement('p');
  erreur.className = 'biblio-erreur';
  erreur.setAttribute('role', 'alert');
  sheet.appendChild(erreur);

  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'btn-primary';
  ok.textContent = type ? 'Renommer' : 'Ajouter';
  ok.onclick = async () => {
    try {
      if (type) {
        const r = await renommerType(type.id, input.value);
        toast(r.ancien === r.nouveau ? 'Nom inchangé' : `« ${r.ancien} » renommé en « ${r.nouveau} »`);
      } else {
        const nom = await ajouterType(input.value);
        toast(`Type « ${nom} » ajouté`);
      }
      overlay.remove();
      await rendreTypes();
    } catch (e) {
      erreur.textContent = e.message || 'Enregistrement impossible';
    }
  };
  sheet.appendChild(ok);

  const annuler = document.createElement('button');
  annuler.type = 'button';
  annuler.className = 'btn-ghost';
  annuler.textContent = 'Annuler';
  annuler.onclick = () => overlay.remove();
  sheet.appendChild(annuler);

  overlay.appendChild(sheet);
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  input.focus();
  if (type) input.select();
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ok.click(); });
}
