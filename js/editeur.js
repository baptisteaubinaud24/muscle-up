/* Éditeur de séance réutilisable (jalon 4).
   Les mêmes contrôles servent à la séance en cours (écran Séance)
   et à la correction d'une séance enregistrée (écran Historique).

   monterEditeur(container, seance, options) affiche l'éditeur dans container.
   options :
     - modeEdition (bool)   : true = correction d'une séance enregistrée
     - onChange()           : appelé à chaque modification (sauvegarde auto ou état « modifié »)
     - pied(frag)           : ajoute les boutons de bas d'écran (Terminer, Enregistrer…)
   Retourne { rendre } pour forcer un re-rendu. */

import {
  listeBibliotheque, creerExercice, rattacherType, cleExercice, nomPropre,
  tonnage, totalReps, kgParRep, aujourdhui,
} from './db.js';

export function monterEditeur(container, seance, options = {}) {
  const { modeEdition = false, onChange = () => {}, pied = () => {} } = options;

  function changer() {
    onChange();
  }

  function rendre() {
    const frag = document.createDocumentFragment();
    frag.appendChild(enteteSeance());
    frag.appendChild(listeExercices());

    const ajouter = document.createElement('button');
    ajouter.className = 'btn-secondary';
    ajouter.textContent = '+ Ajouter un exercice';
    ajouter.onclick = ouvrirChoixExercice;
    frag.appendChild(ajouter);

    pied(frag);
    container.replaceChildren(frag);
    majEntete();
  }

  /* ---------- En-tête ---------- */

  function enteteSeance() {
    const div = document.createElement('div');
    div.className = 'seance-entete';

    const haut = document.createElement('div');
    haut.className = 'seance-entete-haut';

    const type = document.createElement('span');
    type.className = 'seance-type';
    type.textContent = seance.type;
    haut.appendChild(type);

    const inputDate = document.createElement('input');
    inputDate.type = 'date';
    inputDate.className = 'seance-date';
    inputDate.value = seance.date;
    inputDate.setAttribute('aria-label', 'Date de la séance');
    inputDate.onchange = () => {
      seance.date = inputDate.value || aujourdhui();
      changer();
    };
    haut.appendChild(inputDate);

    const metrics = document.createElement('div');
    metrics.className = 'seance-metrics';
    metrics.dataset.role = 'metrics';
    haut.appendChild(metrics);

    div.appendChild(haut);

    const aide = document.createElement('p');
    aide.className = 'seance-aide';
    aide.textContent = modeEdition
      ? 'Correction d\'une séance enregistrée : modifie ce qui doit l\'être, puis enregistre.'
      : 'Les valeurs en gris italique viennent de ta dernière séance : touche-les pour les confirmer ou les modifier.';
    // Pas de texte sur les valeurs reprises s'il n'y a rien à confirmer (ex. 1re séance d'un type)
    const aConfirmer = (seance.exercices || []).some((ex) => (ex.sets || []).some((x) => !x.confirme));
    if (modeEdition || aConfirmer) div.appendChild(aide);

    return div;
  }

  function majEntete() {
    const el = container.querySelector('[data-role="metrics"]');
    if (!el) return;
    const t = Math.round(tonnage(seance));
    const r = totalReps(seance);
    const kg = r > 0 ? kgParRep(seance).toFixed(1).replace('.', ',') : '0';
    el.textContent = `${t.toLocaleString('fr-FR')} kg · ${r} reps · ${kg} kg/r`;
  }

  /* ---------- Exercices ---------- */

  function listeExercices() {
    const div = document.createElement('div');
    div.className = 'exos-liste';

    if (seance.exercices.length === 0) {
      const p = document.createElement('p');
      p.className = 'info';
      p.textContent = 'Aucun exercice pour l\'instant — ajoute ton premier exercice ci-dessous.';
      div.appendChild(p);
      return div;
    }

    seance.exercices.forEach((ex, i) => div.appendChild(carteExercice(ex, i)));
    return div;
  }

  function carteExercice(ex, i) {
    const carte = document.createElement('div');
    carte.className = 'exo-card';

    const head = document.createElement('div');
    head.className = 'exo-head';

    const nom = document.createElement('span');
    nom.className = 'exo-nom';
    nom.textContent = ex.nom;
    head.appendChild(nom);

    const outils = document.createElement('div');
    outils.className = 'exo-outils';
    outils.append(
      boutonIcone('▲', `Monter ${ex.nom}`, () => deplacer(i, -1), i === 0),
      boutonIcone('▼', `Descendre ${ex.nom}`, () => deplacer(i, 1), i === seance.exercices.length - 1),
      boutonIcone('✕', `Supprimer ${ex.nom}`, () => supprimerExercice(i)),
    );
    head.appendChild(outils);
    carte.appendChild(head);

    const sets = document.createElement('div');
    sets.className = 'exo-sets';
    ex.sets.forEach((s, j) => sets.appendChild(ligneSet(s, j)));
    carte.appendChild(sets);

    const actions = document.createElement('div');
    actions.className = 'exo-actions';

    const addSet = document.createElement('button');
    addSet.className = 'btn-chip';
    addSet.textContent = '+ set';
    addSet.onclick = () => ajouterSet(ex);
    actions.appendChild(addSet);

    const delSet = document.createElement('button');
    delSet.className = 'btn-chip';
    delSet.textContent = '− set';
    delSet.setAttribute('aria-label', `Retirer le dernier set de ${ex.nom}`);
    if (ex.sets.length <= 1) delSet.disabled = true;
    delSet.onclick = () => retirerSet(ex);
    actions.appendChild(delSet);

    if (ex.sets.length >= 2) {
      const copie = document.createElement('button');
      copie.className = 'btn-chip';
      copie.textContent = 'Copier S1 → S2-S' + ex.sets.length;
      copie.onclick = () => copierS1(ex);
      actions.appendChild(copie);
    }

    carte.appendChild(actions);
    return carte;
  }

  function ligneSet(s, j) {
    const row = document.createElement('div');
    // En mode édition, toutes les valeurs sont réelles : jamais de gris italique
    row.className = 'set-row' + (s.confirme || modeEdition ? '' : ' prefill');

    const label = document.createElement('span');
    label.className = 'set-label';
    label.textContent = 'S' + (j + 1);
    row.appendChild(label);

    row.appendChild(groupeNombre(s, 'reps', 'répétitions', 1));
    row.appendChild(groupeNombre(s, 'charge', 'charge en kg', 2.5));
    return row;
  }

  /* Groupe [− input +]. La saisie clavier confirme sans re-rendu (le focus reste). */
  function groupeNombre(set, champ, libelle, pas) {
    const div = document.createElement('div');
    div.className = 'num-group' + (champ === 'charge' ? ' num-charge' : '');

    const val = () => set[champ] ?? null;
    const afficher = (v) => (v === null ? '' : String(v).replace('.', ','));

    const pasApplique = (sens) => {
      set.confirme = true;
      set[champ] = Math.max(0, Math.round(((val() ?? 0) + sens * pas) * 10) / 10);
      changer();
      rendre();
    };

    const moins = document.createElement('button');
    moins.className = 'stepper';
    moins.textContent = '−';
    moins.setAttribute('aria-label', `Diminuer ${libelle}`);
    moins.onclick = () => pasApplique(-1);

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.className = 'num-input';
    input.value = afficher(val());
    input.setAttribute('aria-label', `${libelle} du set`);
    input.setAttribute('placeholder', '–');
    input.addEventListener('input', () => {
      const brut = input.value.replace(',', '.').replace(/[^\d.]/g, '');
      if (brut === '') {
        set[champ] = null;
        set.confirme = modeEdition;
      } else {
        set[champ] = Number(brut);
        set.confirme = true;
      }
      if (!modeEdition) input.closest('.set-row')?.classList.toggle('prefill', !set.confirme);
      changer();
      majEntete();
    });

    const plus = document.createElement('button');
    plus.className = 'stepper';
    plus.textContent = '+';
    plus.setAttribute('aria-label', `Augmenter ${libelle}`);
    plus.onclick = () => pasApplique(1);

    div.append(moins, input, plus);
    return div;
  }

  function boutonIcone(texte, aria, action, desactive) {
    const b = document.createElement('button');
    b.className = 'exo-btn';
    b.textContent = texte;
    b.setAttribute('aria-label', aria);
    if (desactive) b.disabled = true;
    b.onclick = action;
    return b;
  }

  /* ---------- Actions ---------- */

  function deplacer(i, sens) {
    const j = i + sens;
    if (j < 0 || j >= seance.exercices.length) return;
    [seance.exercices[i], seance.exercices[j]] = [seance.exercices[j], seance.exercices[i]];
    changer();
    rendre();
  }

  function supprimerExercice(i) {
    seance.exercices.splice(i, 1);
    changer();
    rendre();
  }

  function ajouterSet(ex) {
    const dernier = ex.sets[ex.sets.length - 1];
    ex.sets.push({
      reps: dernier ? dernier.reps : null,
      charge: dernier ? dernier.charge : null,
      confirme: modeEdition,
    });
    changer();
    rendre();
  }

  function retirerSet(ex) {
    if (ex.sets.length <= 1) return;
    ex.sets.pop();
    changer();
    rendre();
  }

  function copierS1(ex) {
    const s1 = ex.sets[0];
    if (!s1) return;
    for (let k = 1; k < ex.sets.length; k++) {
      ex.sets[k].reps = s1.reps;
      ex.sets[k].charge = s1.charge;
      ex.sets[k].confirme = modeEdition;
    }
    changer();
    rendre();
  }

  /* ---------- Bibliothèque d'exercices ---------- */
  /* Exercices du type de la séance en premier, puis les autres.
     Si le nom saisi n'existe pas : « Créer un exercice » l'ajoute à la séance ET à la bibliothèque. */

  async function ouvrirChoixExercice() {
    const biblio = await listeBibliotheque();
    const dansSeance = new Set(seance.exercices.map((e) => cleExercice(e.nom)));
    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Ajouter un exercice');

    const titre = document.createElement('h2');
    titre.textContent = 'Ajouter un exercice';
    sheet.appendChild(titre);

    const recherche = document.createElement('input');
    recherche.type = 'text';
    recherche.className = 'recherche-input';
    recherche.placeholder = 'Rechercher dans la bibliothèque…';
    recherche.setAttribute('aria-label', 'Rechercher un exercice');
    sheet.appendChild(recherche);

    const liste = document.createElement('div');
    liste.className = 'biblio-liste';
    sheet.appendChild(liste);

    const fermer = document.createElement('button');
    fermer.className = 'btn-ghost';
    fermer.textContent = 'Fermer';
    fermer.onclick = () => overlay.remove();
    sheet.appendChild(fermer);

    overlay.appendChild(sheet);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    recherche.focus();

    const item = (exo) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'biblio-item';
      const nom = document.createElement('span');
      nom.textContent = exo.nom;
      b.appendChild(nom);
      if (dansSeance.has(exo.cle)) {
        const note = document.createElement('span');
        note.className = 'biblio-note';
        note.textContent = 'déjà dans la séance';
        b.appendChild(note);
      }
      b.onclick = async () => {
        await rattacherType(exo.nom, seance.type).catch(() => {});
        ajouterExercice(exo.nom, overlay);
      };
      return b;
    };

    const titreGroupe = (texte) => {
      const h = document.createElement('p');
      h.className = 'biblio-groupe';
      h.textContent = texte;
      return h;
    };

    function rendreListe() {
      const saisie = recherche.value.trim();
      const q = cleExercice(saisie);
      liste.replaceChildren();
      const resultats = q ? biblio.filter((e) => e.cle.includes(q)) : biblio;
      const duType = resultats.filter((e) => e.types.includes(seance.type));
      const autres = resultats.filter((e) => !e.types.includes(seance.type));

      if (duType.length) {
        liste.appendChild(titreGroupe(seance.type));
        duType.forEach((e) => liste.appendChild(item(e)));
      }
      if (autres.length) {
        liste.appendChild(titreGroupe(duType.length ? 'Autres exercices' : 'Bibliothèque'));
        autres.forEach((e) => liste.appendChild(item(e)));
      }

      if (q && !biblio.some((e) => e.cle === q)) {
        const creer = document.createElement('button');
        creer.type = 'button';
        creer.className = 'biblio-item biblio-nouveau';
        creer.textContent = `+ Créer un exercice « ${nomPropre(saisie)} »`;
        creer.onclick = async () => {
          try {
            const exo = await creerExercice(saisie, [seance.type]);
            ajouterExercice(exo.nom, overlay);
          } catch (e) {
            creer.textContent = e.message;
          }
        };
        liste.appendChild(creer);
      }

      if (!liste.childElementCount) {
        const p = document.createElement('p');
        p.className = 'info';
        p.textContent = 'Bibliothèque vide — saisis le nom d\'un exercice ci-dessus pour le créer.';
        liste.appendChild(p);
      }
    }

    recherche.addEventListener('input', rendreListe);
    rendreListe();
  }

  function ajouterExercice(nom, overlay) {
    seance.exercices.push({
      nom: nomPropre(nom),
      sets: [{ reps: null, charge: null, confirme: modeEdition }],
    });
    changer();
    overlay.remove();
    rendre();
  }

  rendre();
  return { rendre };
}

/* ---------- Confirmation (feuille modale maison) ---------- */

export function demanderConfirmation(titre, sousTexte, libelleBouton, { danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', titre);

    const h = document.createElement('h2');
    h.textContent = titre;
    sheet.appendChild(h);

    const p = document.createElement('p');
    p.className = 'sheet-soustexte';
    p.textContent = sousTexte;
    sheet.appendChild(p);

    const ok = document.createElement('button');
    ok.className = danger ? 'btn-primary btn-danger' : 'btn-primary';
    ok.textContent = libelleBouton;
    ok.onclick = () => { overlay.remove(); resolve(true); };

    const annuler = document.createElement('button');
    annuler.className = 'btn-ghost';
    annuler.textContent = 'Annuler';
    annuler.onclick = () => { overlay.remove(); resolve(false); };

    sheet.append(ok, annuler);
    overlay.appendChild(sheet);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
    document.body.appendChild(overlay);
  });
}

/* Barre de filtres segmentée : jusqu'à 5 boutons, colonnes égales ; au-delà (types de
   séance ajoutés), la barre défile horizontalement et le bouton actif reste visible. */
export function ajusterSegmente(g) {
  const n = g.children.length;
  if (n > 5) {
    g.classList.add('segmente-defile');
    g.style.gridTemplateColumns = '';
    requestAnimationFrame(() => {
      const actif = g.querySelector('[aria-selected="true"]');
      if (actif) g.scrollLeft = Math.max(0, actif.offsetLeft - (g.clientWidth - actif.offsetWidth) / 2);
    });
  } else {
    g.classList.remove('segmente-defile');
    g.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  }
  return g;
}
