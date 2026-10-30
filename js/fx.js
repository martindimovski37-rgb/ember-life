/* Fire effects: one full-screen canvas for sparks, embers and flames, plus the opening screen,
   the Ignite button presses and tick flames. All of it is skipped with Reduce Motion. */

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };

/* ---------- particle layer ---------- */
// hottest first: young particles are white-yellow and cool to deep red. Light mode uses deeper colours so they read on white.
const PAL = { dark: ['#FFF4D6', '#FFD27A', '#FF9A4D', '#FF5A36', '#E2381A', '#B91C1C'], light: ['#FFB020', '#FF8A2A', '#FF5A26', '#E8401C', '#C9230F', '#9E140E'] };
const sprites = {};
const sprite = (col, dk) => {
  const k = col + dk; if (sprites[k]) return sprites[k];
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, dk ? '#FFFFFF' : col); r.addColorStop(.2, col); r.addColorStop(.5, col + '55'); r.addColorStop(1, col + '00');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); return (sprites[k] = c);
};
const R = Math.random;
const KINDS = {
  spark: (x, y, o) => { const a = o.ang != null ? o.ang + (R() - .5) * (o.spread ?? 1) : R() * Math.PI * 2, s = (o.spd ?? 1) * (1.5 + R() * 4.5); return { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: .14, drag: .955, life: 0, max: 24 + R() * 26, size: (o.size ?? 1) * (5 + R() * 6), heat: R() * .35, streak: true }; },
  ember: (x, y, o) => ({ x: x + (R() - .5) * (o.w ?? 10), y: y + (R() - .5) * (o.h ?? 0), vx: (R() - .5) * .9, vy: -(o.spd ?? 1) * (.5 + R() * 1.6), g: -.012, drag: .99, life: 0, max: 45 + R() * 55, size: (o.size ?? 1) * (4 + R() * 5), heat: .25 + R() * .45, sway: R() * 6 }),
  flame: (x, y, o) => ({ x: x + (R() - .5) * (o.w ?? 14), y: y + (R() - .5) * (o.h ?? 0), vx: (R() - .5) * .7, vy: -(o.spd ?? 1) * (1 + R() * 1.8), g: -.05, drag: .96, life: 0, max: 18 + R() * 16, size: (o.size ?? 1) * (16 + R() * 16), heat: 0, shrink: true })
};
let layer = null;
const fxLayer = () => {
  if (layer) return layer;
  const cv = document.createElement('canvas'); cv.className = 'fx-layer'; cv.setAttribute('aria-hidden', 'true'); document.body.appendChild(cv);
  return (layer = { cv, g: cv.getContext('2d'), ps: [], on: false, emitters: new Set() });
};
const loop = o => {
  if (o.on) return; o.on = true;
  const tick = () => {
    const { cv, g } = o, dpr = Math.min(2, devicePixelRatio || 1), w = innerWidth, h = innerHeight, dark = isDark();
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)){ cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, w, h);
    o.emitters.forEach(f => f());
    const pal = dark ? PAL.dark : PAL.light; g.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    o.ps = o.ps.filter(p => {
      if (++p.life > p.max) return false;
      p.vx *= p.drag; p.vy = p.vy * p.drag + p.g;
      p.x += p.vx + (p.sway ? Math.sin((p.life + p.sway * 10) / 9) * .35 : 0); p.y += p.vy;
      const t = p.life / p.max, col = pal[Math.min(pal.length - 1, Math.floor((p.heat + t * (1 - p.heat)) * pal.length))], sp = sprite(col, dark);
      const s = p.size * (p.shrink ? 1 - t * .85 : 1 - t * .5);
      g.globalAlpha = p.shrink ? Math.min(1, (1 - t) * 1.4) * (dark ? .7 : .5) : 1 - t;
      g.drawImage(sp, p.x - s / 2, p.y - s / 2, s, s);
      if (p.streak){ g.globalAlpha *= .5; g.drawImage(sp, p.x - p.vx * 1.6 - s * .35, p.y - p.vy * 1.6 - s * .35, s * .7, s * .7); }
      return true;
    });
    g.globalAlpha = 1;
    if (o.ps.length || o.emitters.size) requestAnimationFrame(tick);
    else { o.on = false; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); }
  };
  requestAnimationFrame(tick);
};
/* positions are screen (viewport) coordinates */
export const burst = (x, y, n, kind, o = {}) => { if (calm()) return; const f = fxLayer(); for (let i = 0; i < n; i++) f.ps.push(KINDS[kind](x, y, o)); loop(f); };
const emit = fn => { if (calm()) return () => {}; const f = fxLayer(); f.emitters.add(fn); loop(f); return () => f.emitters.delete(fn); };
const flash = (x, y, peak, ms) => {
  const d = document.createElement('div'); d.className = 'fx-flash'; d.style.cssText = `--fx:${x}px;--fy:${y}px`; document.body.appendChild(d);
  d.animate([{ opacity: 0 }, { opacity: peak, offset: .15 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' }).finished.then(() => d.remove());
};
const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
const mid = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

/* ---------- opening screen ---------- */
/* The splash is plain HTML in index.html so it shows before any script runs. Page animations wait behind it (html.splashing). */
export function endSplash(){
  const sp = document.getElementById('splash'), root = document.documentElement;
  const done = () => { root.classList.remove('splashing'); window.dispatchEvent(new Event('splashdone')); };
  if (!sp){ done(); return; }
  const wait = calm() ? 0 : Math.max(0, 1250 - performance.now());
  setTimeout(() => {
    sp.classList.add('gone'); root.classList.add('intro'); done();
    setTimeout(() => { sp.remove(); root.classList.remove('intro'); }, 1200);
  }, wait);
}
export const afterSplash = fn => { if (document.documentElement.classList.contains('splashing')) window.addEventListener('splashdone', fn, { once: true }); else fn(); };

/* ---------- Ignite: buttons, ticks and switches ---------- */
const MAIN = '.btn-solid,.btn-pop,.bigbtn';
const TICKS = '.plan-item,.mini-item,button.tick,.sdone';
let held = null;
function releaseMain(){
  if (!held) return;
  const { el, stop, t0 } = held; held = null; stop(); el.classList.remove('ig-hold');
  if (!el.isConnected) return;
  restart(el, 'ig-blast');
  const p = Math.min(1, (performance.now() - t0) / 900), b = el.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
  for (let i = 0; i < 6; i++) burst(b.left + b.width * (i + .5) / 6, cy, Math.round(2 + p * 3), 'flame', { w: 30, spd: 1 + p * .6, size: .6 + p * .3 });
  burst(cx, cy, Math.round(4 + p * 8), 'ember', { w: b.width, spd: 1.2 });
  flash(cx, cy, .25 + p * .3, 500);
}
let lit = null;
function releaseGhost(){
  if (!lit) return;
  const { el, stop } = lit; lit = null; stop(); el.classList.remove('ig-lit');
}
function tickFire(el){
  const t = el.matches('.plan-item,.mini-item') ? el.querySelector('.tick') || el : el;
  const [x, y] = mid(t), r = t.getBoundingClientRect();
  const ring = document.createElement('span'); ring.className = 'fx-ring'; ring.style.cssText = `left:${x}px;top:${y}px;--s:${r.width + 14}px`; document.body.appendChild(ring);
  ring.animate([{ opacity: 1, transform: 'translate(-50%,-50%) rotate(0) scale(.7)' }, { opacity: 1, offset: .7 }, { opacity: 0, transform: 'translate(-50%,-50%) rotate(420deg) scale(1.6)' }], { duration: 800, easing: 'ease-out' }).finished.then(() => ring.remove());
  t.animate([{ transform: 'scale(.5)' }, { transform: 'scale(1.35)', offset: .55 }, { transform: 'scale(1)' }], { duration: 500, delay: 100, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'backwards' });
  burst(x, y - 4, 8, 'flame', { w: 10, size: .6 }); burst(x, y, 5, 'ember', { w: 16 });
}
const isOn = el => el.classList.contains('done') || el.classList.contains('on') || el.getAttribute('aria-pressed') === 'true';

export function installIgnite(){
  document.addEventListener('pointerdown', e => {
    if (calm() || e.button > 0) return;
    const m = e.target.closest(MAIN);
    if (m && !m.disabled){
      releaseMain();
      const t0 = performance.now(); m.classList.add('ig-hold');
      held = { el: m, t0, stop: emit(() => {
        if (!m.isConnected) return;
        const b = m.getBoundingClientRect(), p = Math.min(1, (performance.now() - t0) / 900);
        for (let i = 0; i < p * 2; i++) burst(b.left + R() * b.width, b.top + b.height * (1 - p * .9), 1, R() < .5 ? 'ember' : 'flame', { w: 4, size: .5 + p * .5, spd: .6 + p });
      }) };
      return;
    }
    const gh = e.target.closest('.btn-ghost');
    if (gh && !gh.disabled){
      releaseGhost(); gh.classList.add('ig-lit');
      lit = { el: gh, stop: emit(() => {
        if (!gh.isConnected) return;
        const b = gh.getBoundingClientRect();
        if (R() < .25) burst(b.left + R() * b.width, b.top + 2, 1, 'ember', { w: 2 });
        if (R() < .1) burst(b.left + R() * b.width, b.top + 4, 1, 'flame', { w: 2, size: .45 });
      }) };
    }
  }, { passive: true });
  ['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, () => { releaseMain(); releaseGhost(); }, { passive: true }));
  // scrolling a list cancels the press
  document.addEventListener('scroll', () => { if (held){ held.stop(); held.el.classList.remove('ig-hold'); held = null; } releaseGhost(); }, { passive: true, capture: true });

  document.addEventListener('click', e => {
    if (calm()) return;
    const t = e.target.closest(TICKS), s = e.target.closest('.seg button');
    if (!t && !s) return;
    // wait for the screen to update, then check whether it was switched on
    setTimeout(() => requestAnimationFrame(() => {
      if (t && t.isConnected && isOn(t)) tickFire(t);
      if (s && s.isConnected && s.getAttribute('aria-pressed') === 'true'){ const [x, y] = mid(s); burst(x, y - 6, 4, 'flame', { w: 50, size: .5 }); burst(x, y, 4, 'ember', { w: 60 }); }
    }), 0);
  });
}

/* ---------- page change: a plain quick fade (the cards then rise in on their own) ---------- */
export function pageFade(){
  if (calm()) return;
  requestAnimationFrame(() => { const main = document.querySelector('.main'); if (main) main.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' }); });
}
