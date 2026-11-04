/* Écran Bibliothèque d'exercices.
   Liste des exercices (recherche + filtre par type de séance), création (nom + types),
   modification des types d'un exercice. Le nom n'est pas modifiable ici (pas de
   renommage ni de suppression dans cette version). */

import {
  listeBibliotheque,
  creerExercice,
  modifierTypesExercice,
  TYPES,
} from './db.js';

let filtre = 'Tous';
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

async function rendre(garderFocus = false) {
  const content = document.getElementById('bibliotheque-content');
  const liste = await listeBibliotheque();

  const wrap = document.createElement('div');
  wrap.className = 'view-inner biblio';

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
