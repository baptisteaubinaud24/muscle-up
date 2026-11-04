/* Écran Évolution — jalon 3.
   Un filtre par type de séance, un sélecteur de métrique, un seul grand graphique
   (plus lisible sur iPhone que 3 graphiques empilés), et un résumé chiffré.
   Les métriques ne sont pas stockées : elles sont recalculées à partir des sets. */

import './vendor/chart.umd.min.js';
import { listeSeancesTerminees, tonnage, totalReps, kgParRep, TYPES } from './db.js';

const METRIQUES = [
  { id: 'tonnage', label: 'Tonnage', unite: 'kg', calc: tonnage, decimales: 0 },
  { id: 'reps', label: 'Répétitions', unite: 'reps', calc: totalReps, decimales: 0 },
  { id: 'kgr', label: 'Kg/r', unite: 'kg/r', calc: kgParRep, decimales: 1 },
];

let chart = null;
let seancesCache = [];
/* Type et métrique choisis : gardés en mémoire tant que l'app est ouverte.
   À l'ouverture, le type affiché est celui de la dernière séance enregistrée. */
let etat = { type: null, metrique: 'tonnage' };

/* ---------- Formatage ---------- */

function fmtNombre(v, decimales) {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(v);
}

function fmtDateCourte(iso) {
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a.slice(2)}`;
}

function fmtDateLongue(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

/* ---------- Données ---------- */

/* Points d'un type : séances terminées, triées par date croissante.
   Les séances sans aucune répétition sont exclues (décision du 04/11/2026 :
   une séance sans reps n'a pas été faite). */
function points(type) {
  return seancesCache
    .filter((s) => s.type === type && totalReps(s) > 0)
    .sort((a, b) => (a.date === b.date ? (a.id || 0) - (b.id || 0) : a.date < b.date ? -1 : 1));
}

function metriqueCourante() {
  return METRIQUES.find((m) => m.id === etat.metrique);
}

/* ---------- Rendu ---------- */

export async function initEvolution() {
  seancesCache = await listeSeancesTerminees();
  const content = document.getElementById('evolution-content');
  const empty = document.getElementById('evolution-empty');

  if (seancesCache.length === 0) {
    detruireGraphique();
    empty.hidden = false;
    content.replaceChildren();
    return;
  }
  empty.hidden = true;

  // Type par défaut : celui de la dernière séance enregistrée
  if (!etat.type) etat.type = seancesCache[0].type;

  rendre();
}

function rendre() {
  const content = document.getElementById('evolution-content');
  const wrap = document.createElement('div');
  wrap.className = 'view-inner evo';

  wrap.append(filtreTypes(), filtreMetriques());

  const pts = points(etat.type);
  if (pts.length === 0) {
    detruireGraphique();
    const vide = document.createElement('div');
    vide.className = 'evo-vide';
    vide.textContent = `Aucune séance ${etat.type} enregistrée pour l'instant.`;
    wrap.append(vide);
    content.replaceChildren(wrap);
    return;
  }

  wrap.append(resume(pts), carteGraphique(pts), listeRecente(pts));
  content.replaceChildren(wrap);
  dessinerGraphique(pts);
}

function segmente(options, actif, onChoix, label, classe) {
  const g = document.createElement('div');
  g.className = `segmente ${classe}`;
  g.setAttribute('role', 'tablist');
  g.setAttribute('aria-label', label);
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(o.id === actif));
    b.dataset.valeur = o.id;
    b.textContent = o.label;
    b.addEventListener('click', () => onChoix(o.id));
    g.append(b);
  }
  return g;
}

function filtreTypes() {
  return segmente(
    TYPES.map((t) => ({ id: t, label: t })),
    etat.type,
    (t) => { etat.type = t; rendre(); },
    'Type de séance',
    'segmente-types',
  );
}

function filtreMetriques() {
  return segmente(
    METRIQUES,
    etat.metrique,
    (m) => { etat.metrique = m; rendre(); },
    'Métrique',
    'segmente-metriques',
  );
}

function resume(pts) {
  const m = metriqueCourante();
  const valeurs = pts.map((s) => m.calc(s));
  const derniere = valeurs[valeurs.length - 1];
  const precedente = valeurs.length > 1 ? valeurs[valeurs.length - 2] : null;
  const record = Math.max(...valeurs);

  const grid = document.createElement('div');
  grid.className = 'evo-resume';

  const carte = (titre, valeur, detail, classeDetail = '') => {
    const c = document.createElement('div');
    c.className = 'evo-stat';
    c.innerHTML = `<span class="evo-stat-titre"></span><span class="evo-stat-valeur"></span><span class="evo-stat-detail ${classeDetail}"></span>`;
    c.children[0].textContent = titre;
    c.children[1].textContent = valeur;
    c.children[2].textContent = detail;
    return c;
  };

  // Dernière séance + écart avec la précédente
  let detail = '1re séance';
  let classe = '';
  if (precedente !== null) {
    const diff = derniere - precedente;
    const pct = precedente > 0 ? (diff / precedente) * 100 : 0;
    const signe = diff > 0 ? '+' : diff < 0 ? '−' : '±';
    detail = `${signe}${fmtNombre(Math.abs(diff), m.decimales)} (${signe}${fmtNombre(Math.abs(pct), 0)} %)`;
    classe = diff > 0 ? 'hausse' : diff < 0 ? 'baisse' : '';
  }
  grid.append(
    carte('Dernière', `${fmtNombre(derniere, m.decimales)} ${m.unite}`, detail, classe),
    carte('Record', `${fmtNombre(record, m.decimales)} ${m.unite}`, fmtDateCourte(pts[valeurs.indexOf(record)].date)),
    carte('Séances', String(pts.length), `depuis ${pts[0].date.slice(8, 10)}/${pts[0].date.slice(5, 7)}`),
  );
  return grid;
}

function carteGraphique() {
  const c = document.createElement('div');
  c.className = 'evo-graphique';
  const canvas = document.createElement('canvas');
  canvas.id = 'evo-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Évolution ${metriqueCourante().label} — ${etat.type}`);
  c.append(canvas);
  return c;
}

function listeRecente(pts) {
  const m = metriqueCourante();
  const wrap = document.createElement('div');
  wrap.className = 'evo-liste';
  const h = document.createElement('h3');
  h.textContent = 'Dernières séances';
  wrap.append(h);

  const recentes = pts.slice(-5).reverse();
  for (const s of recentes) {
    const l = document.createElement('div');
    l.className = 'evo-ligne';
    const d = document.createElement('span');
    d.className = 'evo-ligne-date';
    d.textContent = fmtDateLongue(s.date);
    const v = document.createElement('span');
    v.className = 'evo-ligne-valeur';
    v.textContent = `${fmtNombre(tonnage(s), 0)} kg · ${totalReps(s)} reps · ${fmtNombre(kgParRep(s), 1)} kg/r`;
    v.dataset.metrique = m.id;
    l.append(d, v);
    wrap.append(l);
  }
  return wrap;
}

/* ---------- Graphique Chart.js ---------- */

function couleur(nom) {
  return getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
}

/* #rrggbb → rgba(), pour le dégradé sous la courbe */
function rgba(hex, alpha) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function detruireGraphique() {
  if (chart) {
    chart.destroy();
    chart = null;
  }
}

function dessinerGraphique(pts) {
  detruireGraphique();
  const canvas = document.getElementById('evo-canvas');
  if (!canvas || !window.Chart) return;

  const m = metriqueCourante();
  const accent = couleur('--color-accent');
  const texte = couleur('--color-text-muted');
  const grille = couleur('--color-divider');
  const surface = couleur('--color-surface-2');
  const bordure = couleur('--color-border');
  const texteFort = couleur('--color-text');

  const ctx = canvas.getContext('2d');
  const fond = ctx.createLinearGradient(0, 0, 0, 260);
  fond.addColorStop(0, rgba(accent, 0.28));
  fond.addColorStop(1, rgba(accent, 0));

  chart = new window.Chart(canvas, {
    type: 'line',
    data: {
      labels: pts.map((s) => fmtDateCourte(s.date)),
      datasets: [{
        data: pts.map((s) => Number(m.calc(s).toFixed(m.decimales === 0 ? 0 : 2))),
        borderColor: accent,
        backgroundColor: fond,
        fill: true,
        tension: 0.3,
        borderWidth: 2.5,
        pointRadius: pts.length > 30 ? 2 : 4,
        pointHoverRadius: 7,
        pointBackgroundColor: accent,
        pointBorderColor: surface,
        pointBorderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 8, right: 4 } },
      scales: {
        x: {
          grid: { display: false },
          border: { color: grille },
          ticks: { color: texte, font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 5 },
        },
        y: {
          beginAtZero: false,
          grace: '10%',
          grid: { color: grille },
          border: { display: false },
          ticks: {
            color: texte,
            font: { size: 11 },
            maxTicksLimit: 5,
            callback: (v) => fmtNombre(v, m.decimales),
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: surface,
          borderColor: bordure,
          borderWidth: 1,
          titleColor: texteFort,
          bodyColor: texteFort,
          footerColor: texte,
          titleFont: { weight: '600' },
          footerFont: { size: 11, weight: '400' },
          padding: 10,
          displayColors: false,
          callbacks: {
            title: (items) => fmtDateLongue(pts[items[0].dataIndex].date),
            label: (item) => `${m.label} : ${fmtNombre(item.raw, m.decimales)} ${m.unite}`,
            footer: (items) => {
              const s = pts[items[0].dataIndex];
              const noms = (s.exercices || []).filter((e) => (e.sets || []).length).map((e) => e.nom);
              if (noms.length <= 4) return noms;
              return [...noms.slice(0, 4), `+ ${noms.length - 4} autre(s)`];
            },
          },
        },
      },
    },
  });
}

/* Le thème change les couleurs : on redessine le graphique */
new MutationObserver(() => {
  if (chart) dessinerGraphique(points(etat.type));
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
