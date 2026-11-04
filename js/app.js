/* Point d'entrée — navigation, thème, service worker */

import {
  getSeanceEnCours,
  listeSeancesTerminees,
  synchroniserBibliotheque,
} from './db.js';
import { initSeance } from './seance.js';
import { initEvolution } from './evolution.js';
import { initHistorique } from './historique.js';
import { initBibliotheque } from './bibliotheque.js';
import {
  appliquerFusionsNoms,
  etatRappel,
  exporterSauvegarde,
  preparerSauvegarde,
  demanderPersistance,
} from './import-export.js';

/* ---------- Service worker ---------- */
/* Certains environnements (aperçus sandboxés) interdisent l'accès à ces API :
   on intercepte l'échec pour que l'app démarre quand même. */
try {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker non enregistré :', err);
    });
  }
} catch (e) {
  console.warn('Service worker indisponible :', e);
}

/* Demander la persistance du stockage (évite la purge par iOS) */
try {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist()
      .then((ok) => {
        if (!ok) console.warn('Persistance du stockage refusée par le navigateur');
      })
      .catch((e) => console.warn('Persistance du stockage indisponible :', e));
  }
} catch (e) {
  console.warn('Persistance du stockage indisponible :', e);
}

/* ---------- Thème ---------- */
(function initTheme() {
  const toggle = document.querySelector('[data-theme-toggle]');
  const root = document.documentElement;
  let theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  root.setAttribute('data-theme', theme);

  toggle.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', theme);
    toggle.setAttribute('aria-label', theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre');
  });
})();

/* ---------- Navigation ---------- */
const tabs = [...document.querySelectorAll('.tab')];
const views = [...document.querySelectorAll('.view')];

/* Enveloppe de sécurité : un échec d'accès au stockage ne doit jamais
   casser l'interface (ex. aperçu navigateur sans IndexedDB). */
function sur(fn) {
  return fn().catch((e) => console.warn('Échec d\'initialisation :', e));
}

function montrer(vue) {
  tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === vue)));
  views.forEach((v) => (v.hidden = v.dataset.view !== vue));
  if (vue === 'evolution') sur(initEvolution);
  if (vue === 'historique') sur(initHistorique);
  if (vue === 'seance') sur(initSeance);
  if (vue === 'bibliotheque') sur(initBibliotheque);
}

tabs.forEach((t) => t.addEventListener('click', () => montrer(t.dataset.tab)));

/* Gestion du hash (#seance, #evolution, #historique) */
function lireHash() {
  const h = location.hash.replace('#', '');
  return ['seance', 'evolution', 'historique', 'bibliotheque'].includes(h) ? h : 'seance';
}
window.addEventListener('hashchange', () => montrer(lireHash()));

/* ---------- États vides ---------- */
async function majEtatsVides() {
  try {
    // Évolution et Historique ne montrent que les séances terminées
    const total = (await listeSeancesTerminees()).length;
    const enCours = await getSeanceEnCours();
    document.getElementById('seance-empty').hidden = Boolean(enCours);
    document.getElementById('evolution-empty').hidden = total > 0;
    // L'Historique gère son propre état vide (il peut être en mode édition)
    if (total === 0) document.getElementById('historique-empty').hidden = false;
  } catch (e) {
    console.warn('Stockage indisponible :', e);
  }
}

/* ---------- Démarrage ---------- */
montrer(lireHash());
majEtatsVides();
/* Fusion des noms d'exercices en double (historique importé avant le 04/11/2026) */
/* puis remplissage de la bibliothèque avec les noms de l'historique */
appliquerFusionsNoms()
  .catch((e) => { console.warn('Fusion des noms impossible :', e); return 0; })
  .then(async (n) => {
    const ajoutes = await synchroniserBibliotheque().catch((e) => { console.warn('Bibliothèque :', e); return 0; });
    if (n > 0 || (ajoutes > 0 && lireHash() === 'bibliotheque')) montrer(lireHash());
  });
document.addEventListener('donnees-changees', () => { synchroniserBibliotheque().catch(() => {}); });

/* ---------- Rappel de sauvegarde (jalon 6) ---------- */
/* Masqué pendant une séance en cours (pour ne pas gêner la saisie) et,
   après « ✕ », jusqu'au prochain lancement de l'app. */
let rappelMasque = false;

async function majRappel() {
  const bandeau = document.getElementById('rappel-sauvegarde');
  try {
    const enCours = await getSeanceEnCours();
    const texte = rappelMasque || enCours ? null : await etatRappel();
    if (texte) document.getElementById('rappel-texte').textContent = texte;
    bandeau.hidden = !texte;
  } catch {
    bandeau.hidden = true;
  }
}

document.getElementById('rappel-fermer').addEventListener('click', () => {
  rappelMasque = true;
  majRappel();
});

document.getElementById('rappel-sauver').addEventListener('click', async () => {
  try {
    const n = await exporterSauvegarde();
    if (n) toastGlobal(`Sauvegarde de ${n} séance${n > 1 ? 's' : ''} exportée`);
  } catch (e) {
    toastGlobal(e.message || 'Export impossible');
  }
});

function toastGlobal(message) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

document.addEventListener('sauvegarde-faite', () => {
  majRappel();
  if (location.hash.replace('#', '') === 'historique') montrer('historique');
});
document.addEventListener('donnees-changees', () => majRappel());

majRappel();
preparerSauvegarde().catch(() => {});
demanderPersistance();

/* Une séance créée / terminée modifie les états vides des autres écrans */
document.addEventListener('donnees-changees', () => majEtatsVides());
