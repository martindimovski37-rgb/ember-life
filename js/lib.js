/* Shared building blocks: Preact + htm, icons, colors, dates. */
import { afterSplash } from './fx.js';
export const { html, render, useState, useEffect, useRef, useMemo, useCallback } = window.htmPreact;

/* ---------- Category palette & icons (kept from Day Planner so saved plans keep their look) ---------- */
/* Category colours: one warm "fire" family (Ember Theme). Values are CSS variables so dark mode can brighten them. */
export const COLORS = [
  ['wine','Wine','var(--c-wine)'], ['scarlet','Scarlet','var(--c-scarlet)'], ['flame','Flame','var(--c-flame)'], ['rust','Rust','var(--c-rust)'],
  ['tangerine','Tangerine','var(--c-tangerine)'], ['amber','Amber','var(--c-amber)'], ['ochre','Ochre','var(--c-ochre)'], ['graphite','Graphite','var(--c-graphite)']
];
export const COLOR = Object.fromEntries(COLORS.map(c => [c[0], c[2]]));
/* older palette names map onto the fire family */
export const LEGACY_COLOR = { olive: 'wine', cocoa: 'flame', orange: 'tangerine', green: 'amber', red: 'rust', grape: 'scarlet', purple: 'scarlet', indigo: 'wine', navy: 'wine',
  blue: 'scarlet', sky: 'flame', cyan: 'rust', teal: 'tangerine', emerald: 'amber', gold: 'ochre', rose: 'scarlet', pink: 'flame', magenta: 'scarlet', plum: 'wine', slate: 'graphite' };
export const tint = k => COLOR[k] || COLOR[LEGACY_COLOR[k]] || COLOR.flame;

export const ICONS = [
  ['screen','Screen','M3 6h18v12H3z M10 9.5v5l4-2.5z'],
  ['check','Checklist','M9 11l3 3 8-8 M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11'],
  ['pulse','Pulse','M3 12h4l2-5 4 10 2-5h6'],
  ['leaf','Leaf','M5 19c0-8 6-14 14-14 0 8-6 14-14 14z M5 19l7-7'],
  ['book','Book','M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z M4 21V5 M8 7h7'],
  ['dumbbell','Dumbbell','M6 7v10 M18 7v10 M3 10v4 M21 10v4 M6 12h12'],
  ['music','Music','M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0 M20 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0'],
  ['people','People','M9 11a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M2 21v-1a6 6 0 0 1 12 0v1 M16 3.5a4 4 0 0 1 0 7.5 M22 21v-1a6 6 0 0 0-4-5.6'],
  ['code','Code','M8 8l-5 4 5 4 M16 8l5 4-5 4 M14 4l-4 16'],
  ['coffee','Coffee','M4 8h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z M17 10h2a2 2 0 0 1 0 4h-2 M8 2v3 M12 2v3'],
  ['sun','Sun','M12 16a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M12 2v2 M12 20v2 M4 12H2 M22 12h-2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5'],
  ['heart','Heart','M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'],
  ['star','Star','M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z'],
  ['game','Games','M6 8h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L15 13H9l-1.6 1.8A3 3 0 0 1 2 13v-1a4 4 0 0 1 4-4z M7 10v3 M5.5 11.5h3 M16 11h.01 M18 12.5h.01'],
  ['moon','Moon','M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
  ['home','Home','M3 11l9-7 9 7 M5 10v10h14V10 M10 20v-6h4v6'],
  ['pen','Writing','M4 20h4L19 9l-4-4L4 16z M13 7l4 4'],
  ['palette','Art','M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-.5-.2-.8-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.5-9-7.5z M7.5 11h.01 M10 7.5h.01 M14.5 7.5h.01'],
  ['bike','Bike','M2 17.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0 M15 17.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0 M5.5 17.5L9 9h6l3.5 8.5 M12 17.5L9 9 M8 6h3'],
  ['tree','Outdoors','M12 3l6 9h-4l4 6H6l4-6H6z M12 18v3'],
  ['chat','Chat','M4 5h16v11H9l-5 4z'],
  ['plane','Travel','M22 2L11 13 M22 2l-7 20-4-9-9-4z'],
  ['drop','Water','M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z'],
  ['bed','Rest','M3 18V6 M3 14h18 M21 18v-5a3 3 0 0 0-3-3h-8v4 M6.5 11.5h.01']
];
export const ICON = Object.fromEntries(ICONS.map(i => [i[0], i[2]]));
export const iconPath = k => ICON[k] || ICON.star;

export const UI = {
  shuffle: 'M16 3h5v5 M4 20L21 3 M21 16v5h-5 M15 15l6 6 M4 4l5 5',
  plus: 'M12 5v14 M5 12h14', pen: 'M4 20h4L19 9l-4-4L4 16z M13 7l4 4',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', back: 'M15 5l-7 7 7 7', fwd: 'M9 5l7 7-7 7', check: 'M5 12l5 5L20 7', x: 'M6 6l12 12 M18 6L6 18',
  sun: ICON.sun, grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  diet: 'M4 11h16a8 8 0 0 1-16 0z M12 3c-1.5 2-1.5 4 0 6 M8 5c-1 1.3-1 2.7 0 4 M16 5c-1 1.3-1 2.7 0 4',
  gym: ICON.dumbbell,
  gear: 'M12 15a3 3 0 1 0 0-6a3 3 0 1 0 0 6 M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  sync: 'M20 11a8 8 0 0 0-14.3-4.9L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14.3 4.9L20 16 M20 20v-4h-4',
  history: 'M12 7v5l3 2 M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5',
  play: 'M7 4v16l13-8z',
  search: 'M11 18a7 7 0 1 0 0-14a7 7 0 1 0 0 14 M20 20l-4-4',
  barcode: 'M4 7V5a1 1 0 0 1 1-1h2 M17 4h2a1 1 0 0 1 1 1v2 M20 17v2a1 1 0 0 1-1 1h-2 M7 20H5a1 1 0 0 1-1-1v-2 M8 8v8 M11 8v8 M14 8v8 M17 8v8',
  dots: 'M5 12h.01 M12 12h.01 M19 12h.01',
  timer: 'M12 21a8 8 0 1 0 0-16a8 8 0 1 0 0 16 M12 9v4l2 2 M10 2h4',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M12 10v6 M9 13h6',
  clipboard: 'M9 4h6v3H9z M9 5H6v15h12V5h-3 M9 11h6 M9 15h4',
  grip: 'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',
  spark: 'M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z M19 3v4 M17 5h4',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4z M12 17a4 4 0 1 0 0-8a4 4 0 1 0 0 8',
  alert: 'M12 9v4 M12 17h.01 M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'
};

export function Ico({ d, size = 20, sw = 2.2 }){
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d=${d}></path></svg>`;
}

/* ---------- Helpers ---------- */
export const pad = n => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const parseKey = k => { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2] || 1); };
export const fmtLong = k => parseKey(k).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
export const fmtShort = k => parseKey(k).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtMonth = k => parseKey(k + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
export const weekStartKey = k => { const d = parseKey(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayKey(d); };
export const lastMonthKey = k => { const d = parseKey(k); const m = new Date(d.getFullYear(), d.getMonth() - 1, d.getDate()); return m.getDate() === d.getDate() ? dayKey(m) : null; };
export const uid = () => Math.random().toString(36).slice(2, 10);
export const clone = x => JSON.parse(JSON.stringify(x));
export const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
export const joinNames = list => list.length < 2 ? (list[0] || '') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
export const scrollTop = () => { try { window.scrollTo(0, 0); } catch (e){} };

/* Progress ring used on Today */
export function Ring({ value, max, color, size = 68, stroke = 8, children }){
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const p = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return html`<svg class="ring-svg" width=${size} height=${size} viewBox=${'0 0 ' + size + ' ' + size} aria-hidden="true">
    <circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke="var(--track)" stroke-width=${stroke}/>
    ${p > 0 && html`<circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke=${color} stroke-width=${stroke} stroke-linecap="round"
      class="ring-v" style=${'--c:' + c.toFixed(1)} stroke-dasharray=${(c * p).toFixed(1) + ' ' + c.toFixed(1)} transform=${'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')'}/>`}
    ${children}
  </svg>`;
}

/* A number that counts up from 0 when it first appears (after the opening screen), then just follows its value */
export function Count({ n }){
  const [shown, setShown] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches ? n : 0);
  const first = useRef(true);
  useEffect(() => {
    if (!first.current){ setShown(n); return; }
    first.current = false;
    if (shown === n) return;
    let raf, alive = true;
    afterSplash(() => {
      if (!alive) return;
      const t0 = performance.now();
      const step = t => { const k = Math.min(1, Math.max(0, (t - t0 - 150) / 1300)); setShown(Math.round(n * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(step); };
      raf = requestAnimationFrame(step);
    });
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [n]);
  return html`<span class="num-heat">${shown}</span>`;
}
