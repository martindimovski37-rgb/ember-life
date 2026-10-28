/* Gym: exercise library, workout logging (Hevy-style set table), rest timer, routines, history, records.
   Docs: gym/active = the workout in progress (values kept as typed strings until it's finished)
         workouts/<id> = { id, name, routineId, date, start, end, exercises: [{ ex, sets: [{ t, kg, reps, rpe, pr }] }], prs }
         routines/<id> = { id, name, items: [{ ex, warm, sets, rest }] }
         exercises/<id> = custom exercise { id, n, p, s, e, desc, photo, custom: true }
         exnotes/<exId> = { note, rest }   (sticky per exercise)
   Set types: n normal, w warm-up, f failure, d drop set. Warm-ups never count for records or muscle sets. */
import { html, useState, useEffect, useRef, Ico, UI, uid, clone, plural, scrollTop, dayKey, parseKey, fmtShort, fmtMonth, weekStartKey } from './lib.js';
import { store } from './store.js';
import { BodyMap, MUSCLE_NAMES } from './bodymap.js';

/* ---------- Exercise library ---------- */
let LIB = null, libLoad = null;
const libSubs = new Set();
export function loadLib(){
  if (!libLoad) libLoad = fetch('data/exercises.json').then(r => r.json()).then(list => { LIB = list; libSubs.forEach(f => f()); })
    .catch(() => { libLoad = null; });
  return libLoad;
}
function useLib(){
  const [, set] = useState(0);
  useEffect(() => { const f = () => set(v => v + 1); libSubs.add(f); loadLib(); return () => libSubs.delete(f); }, []);
  return LIB;
}
const customs = () => store.list('exercises/');
export function exById(id){
  const c = store.get('exercises/' + id);
  if (c) return c;
  return (LIB || []).find(e => e.id === id) || { id, n: 'Exercise', p: [], s: [], e: 'other', in: [], im: 0 };
}
export const allExercises = () => customs().concat(LIB || []);
const IMG = (id, i = 0) => 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/' + encodeURIComponent(id) + '/' + i + '.jpg';
const exThumb = ex => ex.custom ? ex.photo : ex.im ? IMG(ex.id) : null;
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const muscleLine = ex => [ex.p.map(m => MUSCLE_NAMES[m] || cap(m)).join(', '), ex.s.length ? ex.s.map(m => MUSCLE_NAMES[m] || cap(m)).join(', ') : ''].filter(Boolean).join(' · ');
const EQUIP = ['barbell', 'dumbbell', 'machine', 'cable', 'body only', 'kettlebells', 'bands', 'e-z curl bar', 'medicine ball', 'exercise ball', 'foam roll', 'other'];
const MUSCLES = Object.keys(MUSCLE_NAMES);

/* ---------- Numbers ---------- */
const num = s => { const v = parseFloat(String(s == null ? '' : s).replace(',', '.')); return isFinite(v) && v >= 0 ? v : null; };
const r1 = n => String(Math.round(n * 10) / 10);
const e1rm = (kg, reps) => !kg || !reps ? 0 : reps === 1 ? kg : kg * (1 + reps / 30);
const fmtDur = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0'); };
const clock = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmtT = kg => kg >= 1000 ? r1(kg / 1000) + ' t' : Math.round(kg) + ' kg';
const working = s => s.t !== 'w';

/* ---------- History ---------- */
export const workoutsList = () => store.list('workouts/').sort((a, b) => b.start - a.start);
export const workedOutOn = date => store.list('workouts/').some(w => w.date === date);
const volumeOf = w => w.exercises.reduce((a, e) => a + e.sets.filter(working).reduce((b, s) => b + (s.kg || 0) * (s.reps || 0), 0), 0);
const setsOf = w => w.exercises.reduce((a, e) => a + e.sets.filter(working).length, 0);
function lastFor(exId, beforeStart){
  const w = workoutsList().find(x => x.start < beforeStart && x.exercises.some(e => e.ex === exId));
  return w ? w.exercises.find(e => e.ex === exId).sets : [];
}
function bestsBefore(exId, beforeStart){
  const b = { kg: 0, orm: 0, vol: 0 };
  store.list('workouts/').forEach(w => { if (w.start >= beforeStart) return; w.exercises.forEach(e => { if (e.ex !== exId) return;
    e.sets.filter(working).forEach(s => { b.kg = Math.max(b.kg, s.kg || 0); b.orm = Math.max(b.orm, e1rm(s.kg, s.reps)); b.vol = Math.max(b.vol, (s.kg || 0) * (s.reps || 0)); }); }); });
  return b;
}
/* Sets per muscle in a date range: main muscle counts 1, helper muscles ½ */
function muscleSets(from, to){
  const out = {};
  store.list('workouts/').forEach(w => { if (w.date < from || w.date > to) return; w.exercises.forEach(e => {
    const ex = exById(e.ex), n = e.sets.filter(working).length;
    ex.p.forEach(m => { out[m] = (out[m] || 0) + n; }); ex.s.forEach(m => { out[m] = (out[m] || 0) + n / 2; }); }); });
  return out;
}
const shiftDay = (d, n) => { const x = parseKey(d); x.setDate(x.getDate() + n); return dayKey(x); };

/* ---------- Gym tab ---------- */
export function GymTab({ app, ui, setUi }){
  const lib = useLib();
  const v = ui.gview;
  const go = x => { setUi({ gview: x }); scrollTop(); };
  const env = { app, go, home: () => go(null) };
  const active = store.get('gym/active');
  if (!lib) return html`<div class="stack"><header class="head"><h1>Gym</h1></header><section class="card"><p class="hint">Loading exercises…</p></section></div>`;
  if (v && v.type === 'workout' && active) return html`<${WorkoutView} env=${env} w=${active}/>`;
  if (v && v.type === 'done') return html`<${WorkoutDetail} env=${env} id=${v.id} justDone=${true}/>`;
  if (v && v.type === 'detail') return html`<${WorkoutDetail} env=${env} id=${v.id}/>`;
  if (v && v.type === 'ex') return html`<${ExerciseDetail} key=${v.id} env=${env} id=${v.id} back=${v.back}/>`;
  if (v && v.type === 'routine') return html`<${RoutineEditor} key=${v.id || 'new'} env=${env} id=${v.id} seed=${v.seed}/>`;
  if (v && v.type === 'library') return html`<${LibraryView} env=${env}/>`;
  if (v && v.type === 'custom') return html`<${CustomExercise} key=${v.id || 'new'} env=${env} id=${v.id}/>`;
  const sub = ui.gsub || 'workout';
  return html`<div class="stack">
    <header class="head"><h1 class="grow">Gym</h1></header>
    <div class="seg" role="group" aria-label="Gym section">
      ${GSUBS.map(([k, l]) => html`<button key=${k} aria-pressed=${String(sub === k)} onClick=${() => { setUi({ gsub: k, gview: null }); scrollTop(); }}>${l}</button>`)}
    </div>
    ${sub === 'history' ? html`<${HistoryView} env=${env} ui=${ui} setUi=${setUi}/>` : sub === 'exercises' ? html`<${LibraryList} env=${env}/>` : html`<${GymHome} env=${env} active=${active}/>`}
  </div>`;
}
const GSUBS = [['workout', 'Workout'], ['history', 'History'], ['exercises', 'Exercises']];

/* Routine items: { ex, rest, sets: [{ t, kg, reps }] } with kg/reps as the target (may be empty).
   Older routines stored counts ({ warm, sets: 3 }); they're converted when read. */
export function normRoutine(r){
  return Object.assign({}, r, { items: (r.items || []).map(it => Array.isArray(it.sets) ? it : { ex: it.ex, rest: it.rest,
    sets: Array.from({ length: it.warm || 0 }, () => ({ t: 'w', kg: '', reps: '' })).concat(Array.from({ length: it.sets || 1 }, () => ({ t: 'n', kg: '', reps: '' }))) }) });
}
export function startWorkout(app, routine){
  const now = Date.now();
  const exercises = routine ? normRoutine(routine).items.map(it => {
    const note = store.get('exnotes/' + it.ex) || {};
    const sets = it.sets.map(t => Object.assign(newSet(t.t), { tk: t.kg != null ? String(t.kg) : '', tr: t.reps != null ? String(t.reps) : '' }));
    return { id: uid(), ex: it.ex, rest: it.rest != null ? it.rest : note.rest != null ? note.rest : 90, sets };
  }) : [];
  store.set('gym/active', { id: uid(), name: routine ? routine.name : defaultName(now), routineId: routine ? routine.id : null, start: now, exercises, restEnd: 0 });
}
const defaultName = t => { const h = new Date(t).getHours(); return h < 11 ? 'Morning workout' : h < 17 ? 'Afternoon workout' : 'Evening workout'; };
const newSet = t => ({ id: uid(), t: t || 'n', kg: '', reps: '', rpe: '', done: false });

/* ---------- Home ---------- */
function GymHome({ env, active }){
  const { app } = env;
  const today = app.today;
  const ws = weekStartKey(today);
  const all = workoutsList();
  const week = all.filter(w => w.date >= ws && w.date <= today);
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(ws, i));
  /* streak: weeks in a row with at least one workout (this week counts once it has one) */
  let streak = 0;
  for (let k = week.length ? 0 : 1; k < 520; k++){
    const a = shiftDay(ws, -7 * k), b = shiftDay(a, 6);
    if (all.some(w => w.date >= a && w.date <= b)) streak++; else break;
  }
  const sets = muscleSets(ws, today);
  const routines = store.list('routines/').map(normRoutine).sort((a, b) => a.name.localeCompare(b.name));
  const start = r => {
    if (store.get('gym/active')){ env.app.showToast('Finish or discard the workout in progress first.'); env.go({ type: 'workout' }); return; }
    startWorkout(app, r); env.go({ type: 'workout' });
  };
  return html`
    ${active
      ? html`<button class="bigbtn live" onClick=${() => env.go({ type: 'workout' })}><span class="wdot"></span><span class="grow">Resume ${active.name}</span><${Ico} d=${UI.fwd} size=${20}/></button>`
      : html`<button class="bigbtn" onClick=${() => start(null)}><${Ico} d=${UI.plus} size=${24}/><span class="grow">Start empty workout</span></button>`}
    <section class="card bm-card">
      <h2 class="label center">Sets this week</h2>
      <${BodyMap} sets=${sets} height=${260}/>
      <div class="bm-key" aria-label="Colour key"><span><i class="bm0"></i>0</span><span><i class="bm1"></i>1–5</span><span><i class="bm2"></i>6–11</span><span><i class="bm3"></i>12+ sets</span></div>
    </section>
    <section class="card week-card">
      <div class="row-between"><h2 class="label">${plural(week.length, 'workout', 'workouts')} this week</h2>${streak > 1 && html`<span class="label streak">${streak}-week streak</span>`}</div>
      <div class="weekdots sm">${days.map(d => { const n = all.filter(w => w.date === d).length; return html`<span key=${d} class=${d === today ? 'today' : ''}><i class=${n ? 'on' : ''}></i>${parseKey(d).toLocaleDateString(undefined, { weekday: 'narrow' })}</span>`; })}</div>
    </section>
    <${RoutinesSection} env=${env} routines=${routines} start=${start}/>`;
}

/* ---------- History: month calendar + every workout ---------- */
function WorkoutCard({ env, w, today }){
  return html`<button class="wcard" onClick=${() => env.go({ type: 'detail', id: w.id })}>
    <span class="row-between"><span class="row-title">${w.name}</span><span class="cat-sub">${relDay(w.date, today)} · ${fmtDur(w.end - w.start)}</span></span>
    <span class="row-between"><span class="row-sub">${fmtT(volumeOf(w))} · ${plural(setsOf(w), 'set', 'sets')}</span>${w.prs > 0 && html`<span class="prs">★ ${plural(w.prs, 'record', 'records')}</span>`}</span>
    <span class="row-sub wrap">${w.exercises.slice(0, 4).map(e => exById(e.ex).n + ' ' + e.sets.filter(working).length + '×').join(' · ')}${w.exercises.length > 4 ? ' …' : ''}</span>
  </button>`;
}
function HistoryView({ env, ui, setUi }){
  const today = env.app.today;
  const month = ui.gmonth || today.slice(0, 7);
  const [day, setDay] = useState(null);
  const all = workoutsList();
  const inMonth = all.filter(w => w.date.slice(0, 7) === month);
  const shiftMonth = n => { const d = parseKey(month + '-01'); d.setMonth(d.getMonth() + n); setUi({ gmonth: dayKey(d).slice(0, 7) }); setDay(null); };
  const first = parseKey(month + '-01'), lead = (first.getDay() + 6) % 7, daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: lead }, () => null).concat(Array.from({ length: daysIn }, (_, i) => month + '-' + String(i + 1).padStart(2, '0')));
  const shown = day ? inMonth.filter(w => w.date === day) : inMonth;
  const mins = inMonth.reduce((a, w) => a + (w.end - w.start), 0);
  return html`
    <section class="card">
      <div class="daynav cal-nav">
        <button class="icon-btn" aria-label="Previous month" onClick=${() => shiftMonth(-1)}><${Ico} d=${UI.back}/></button>
        <span class="daynav-label">${fmtMonth(month)}</span>
        <button class="icon-btn" aria-label="Next month" disabled=${month >= today.slice(0, 7)} onClick=${() => shiftMonth(1)}><${Ico} d=${UI.fwd}/></button>
      </div>
      <div class="cal">
        ${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => html`<span key=${'h' + i} class="cal-h">${d}</span>`)}
        ${cells.map((d, i) => { if (!d) return html`<span key=${'e' + i}></span>`; const n = inMonth.filter(w => w.date === d).length;
          return html`<button key=${d} class=${'cal-d' + (n ? ' on' : '') + (d === today ? ' today' : '') + (d === day ? ' sel' : '')} disabled=${!n} aria-label=${fmtShort(d) + (n ? ', ' + plural(n, 'workout', 'workouts') : '')}
            onClick=${() => setDay(day === d ? null : d)}>${Number(d.slice(8))}</button>`; })}
      </div>
      <p class="hint">${inMonth.length ? plural(inMonth.length, 'workout', 'workouts') + ' · ' + fmtDur(mins) + ' in total · ' + fmtT(inMonth.reduce((a, w) => a + volumeOf(w), 0)) + ' lifted' : 'No workouts this month.'}</p>
    </section>
    ${day && html`<div class="row-between"><h2 class="label">${fmtShort(day)}</h2><button class="link" onClick=${() => setDay(null)}>Show whole month</button></div>`}
    <div class="list">${shown.map(w => html`<${WorkoutCard} key=${w.id} env=${env} w=${w} today=${today}/>`)}</div>
    ${all.length === 0 && html`<section class="card"><p class="hint">Finished workouts show up here, with a calendar of the days you trained.</p></section>`}`;
}

/* ---------- Routines on the Gym home: Hevy-style cards in collapsible folders ----------
   gym/folders = { list: [{ id, name }], closed: { folderId|'mine': true } }; a routine's folder is routine.folder (none = My Routines) */
const foldersDoc = () => Object.assign({ list: [], closed: {} }, store.get('gym/folders') || {});
function RoutinesSection({ env, routines, start }){
  const { app } = env;
  const [sheet, setSheet] = useState(null);
  const [name, setName] = useState('');
  const fd = foldersDoc();
  const saveFd = patch => store.set('gym/folders', Object.assign({}, fd, patch));
  const toggle = fid => saveFd({ closed: Object.assign({}, fd.closed, { [fid]: !fd.closed[fid] }) });
  const known = new Set(fd.list.map(f => f.id));
  const groups = [{ id: 'mine', name: 'My Routines', items: routines.filter(r => !r.folder || !known.has(r.folder)) }]
    .concat(fd.list.map(f => ({ id: f.id, name: f.name, items: routines.filter(r => r.folder === f.id) })));
  const nameSheet = (title, initial, ok) => { setName(initial); setSheet({ kind: 'name', title, ok }); };
  const newFolder = () => nameSheet('New folder', '', n => saveFd({ list: fd.list.concat([{ id: uid(), name: n }]) }));
  const routineMenu = r => setSheet({ kind: 'routine', r });
  const folderMenu = g => setSheet({ kind: 'folder', g });
  const moveTo = (r, fid) => { const doc = store.get('routines/' + r.id); store.set('routines/' + r.id, Object.assign({}, doc, { folder: fid === 'mine' ? null : fid })); setSheet(null); };
  const duplicate = r => { const doc = store.get('routines/' + r.id), id = uid(); store.set('routines/' + id, Object.assign(clone(doc), { id, name: doc.name + ' (copy)' })); setSheet(null); app.showToast('Routine duplicated.'); };
  const del = r => { setSheet(null); app.setSheet({ kind: 'confirm', title: 'Delete ' + r.name + '?', ok: 'Delete', danger: true, text: 'Past workouts stay in your history.',
    run: () => { const doc = store.get('routines/' + r.id); store.del('routines/' + r.id); app.showToast('Routine deleted.', { label: 'Undo', run: () => store.set('routines/' + r.id, doc) }); } }); };
  return html`<section class="stack-sm">
    <div class="row-between"><h2 class="section-t">Routines</h2>
      <span class="row-actions">
        <button class="btn btn-ghost sm card-bg" onClick=${() => env.go({ type: 'routine', id: null })}><${Ico} d=${UI.plus} size=${18} sw=${2.6}/>New routine</button>
        <button class="icon-btn sq" aria-label="New folder" onClick=${newFolder}><${Ico} d=${UI.folderPlus} size=${22}/></button>
      </span></div>
    ${groups.map(g => html`<div key=${g.id} class="folder">
      ${g.id !== 'mine' && html`<div class="folder-head">
        <button class="folder-t" aria-expanded=${String(!fd.closed[g.id])} onClick=${() => toggle(g.id)}><span class=${'tri' + (fd.closed[g.id] ? ' shut' : '')}>▾</span>${g.name} (${g.items.length})</button>
        <button class="icon-btn" aria-label=${'Options for folder ' + g.name} onClick=${() => folderMenu(g)}><${Ico} d=${UI.dots} size=${20}/></button>
      </div>`}
      ${(g.id === 'mine' || !fd.closed[g.id]) && html`<div class="list">
        ${g.items.map(r => html`<div key=${r.id} class="rcard">
          <div class="row-between"><button class="rcard-t" onClick=${() => env.go({ type: 'routine', id: r.id })}>${r.name}</button>
            <button class="icon-btn" aria-label=${'Options for ' + r.name} onClick=${() => routineMenu(r)}><${Ico} d=${UI.dots} size=${22}/></button></div>
          <p class="rcard-ex">${r.items.map(it => exById(it.ex).n).join(', ') || 'No exercises yet'}</p>
          <button class="btn btn-pop" onClick=${() => start(r)}>Start routine</button>
        </div>`)}
        ${g.items.length === 0 && (g.id !== 'mine' || routines.length === 0) && html`<p class="hint">${g.id === 'mine' ? 'Tap the clipboard to save the workouts you repeat, like “Push day”, and start them with one tap.' : 'Empty. Move routines here with their ⋯ menu.'}</p>`}
      </div>`}
    </div>`)}
    ${sheet && sheet.kind === 'name' && html`<${Sheet} title=${sheet.title} close=${() => setSheet(null)}>
      <input class="input inset" aria-label="Name" placeholder="Like “Upper / Lower”" value=${name} onInput=${e => setName(e.target.value)}/>
      <button class="btn btn-pop" disabled=${!name.trim()} onClick=${() => { sheet.ok(name.trim()); setSheet(null); }}>Save</button>
    <//>`}
    ${sheet && sheet.kind === 'routine' && html`<${Sheet} title=${sheet.r.name} close=${() => setSheet(null)}>
      <button class="row-btn" onClick=${() => { setSheet(null); env.go({ type: 'routine', id: sheet.r.id }); }}>Edit routine</button>
      <button class="row-btn" onClick=${() => duplicate(sheet.r)}>Duplicate</button>
      <span class="label">Move to folder</span>
      <div class="list">${[{ id: 'mine', name: 'My Routines' }].concat(fd.list).map(f => html`<button key=${f.id} class="act-pick" aria-pressed=${String((sheet.r.folder && known.has(sheet.r.folder) ? sheet.r.folder : 'mine') === f.id)} onClick=${() => moveTo(sheet.r, f.id)}>
        <span class="grow row-title">${f.name}</span><span class=${'radio' + ((sheet.r.folder && known.has(sheet.r.folder) ? sheet.r.folder : 'mine') === f.id ? ' on' : '')}></span></button>`)}</div>
      <button class="row-btn" onClick=${() => { setSheet(null); newFolder(); }}>+ New folder</button>
      <button class="btn btn-danger" onClick=${() => del(sheet.r)}>Delete routine</button>
    <//>`}
    ${sheet && sheet.kind === 'folder' && html`<${Sheet} title=${sheet.g.name} close=${() => setSheet(null)}>
      <button class="row-btn" onClick=${() => nameSheet('Rename folder', sheet.g.name, n => saveFd({ list: fd.list.map(f => f.id === sheet.g.id ? Object.assign({}, f, { name: n }) : f) }))}>Rename</button>
      <button class="btn btn-danger" onClick=${() => { saveFd({ list: fd.list.filter(f => f.id !== sheet.g.id) }); setSheet(null); app.showToast('Folder deleted. Its routines moved to My Routines.'); }}>Delete folder</button>
    <//>`}
  </section>`;
}
const relDay = (d, today) => d === today ? 'Today' : d === shiftDay(today, -1) ? 'Yesterday' : fmtShort(d);

function Sheet({ title, close, children, tall }){
  return html`<div class="scrim" onClick=${e => { if (e.target === e.currentTarget) close(); }}>
    <div class=${'sheet' + (tall ? ' tall' : '')} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="row-between"><h2>${title}</h2><button class="icon-btn" aria-label="Close" onClick=${close}><${Ico} d=${UI.x}/></button></div>
      ${children}
    </div>
  </div>`;
}

/* ---------- Workout in progress ---------- */
const RESTS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
const TYPES = [['w', 'Warm-up', 'W'], ['n', 'Normal', ''], ['f', 'Failure', 'F'], ['d', 'Drop set', 'D']];
const RPES = ['', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10'];

/* Rest timer sounds, made on the fly so nothing needs downloading. They play through headphones when connected,
   otherwise the iPhone speaker. 'transient' tells iOS it's a short alert that briefly lowers music, not silenced by the mute switch. */
export const SOUNDS = [['chime', 'Chime'], ['beep', 'Beep'], ['bell', 'Bell'], ['whistle', 'Whistle'], ['ding', 'Triple ding'], ['boxing', 'Boxing bell'], ['off', 'Off']];
function audio(){
  const A = window.AudioContext || window.webkitAudioContext; if (!A) return null;
  try { if (navigator.audioSession) navigator.audioSession.type = 'transient'; } catch (e){}
  const ctx = audio.ctx || (audio.ctx = new A());
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function tone(ctx, at, freq, len, { type = 'sine', vol = 0.3, to } = {}){
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + len * 0.8);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + len + 0.05);
}
export function playSound(kind){
  if (kind === 'off') return;
  const ctx = audio(); if (!ctx) return;
  try {
    if (kind === 'beep') [0, 0.3, 0.6].forEach(t => tone(ctx, t, 880, 0.18, { type: 'square', vol: 0.12 }));
    else if (kind === 'bell') [0, 0.9].forEach(t => { tone(ctx, t, 660, 1.4, { vol: 0.35 }); tone(ctx, t, 1650, 0.9, { vol: 0.12 }); tone(ctx, t, 2640, 0.5, { vol: 0.06 }); });
    else if (kind === 'whistle') [0, 0.55].forEach(t => tone(ctx, t, 1400, 0.4, { vol: 0.25, to: 2600 }));
    else if (kind === 'ding') [0, 0.32, 0.64].forEach(t => tone(ctx, t, 1568, 0.3, { type: 'triangle', vol: 0.35 }));
    else if (kind === 'boxing') [0, 0.22, 0.44, 0.66].forEach(t => { tone(ctx, t, 520, 0.5, { vol: 0.3 }); tone(ctx, t, 1310, 0.35, { vol: 0.1 }); });
    else [[0, 1047], [0.16, 1319], [0.32, 1568], [0.6, 2093]].forEach(([t, f]) => tone(ctx, t, f, 0.7, { vol: 0.28 }));
  } catch (e){}
}
const restSound = () => (store.get('settings/app') || {}).restSound || 'chime';
function beep(){
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e){}
  playSound(restSound());
}
/* iPhone only plays sound after a tap, so wake the audio on the first set tick */
const unlockAudio = () => { audio(); };

function useTick(ms = 1000){
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set(v => v + 1), ms); return () => clearInterval(t); }, []);
}

function WorkoutView({ env, w }){
  const { app } = env;
  useTick();
  const [sheet, setSheet] = useState(null);
  const save = next => store.set('gym/active', next);
  const upd = fn => { const cur = clone(store.get('gym/active')); if (!cur) return; fn(cur); save(cur); };
  const updEx = (eid, fn) => upd(cur => { const e = cur.exercises.find(x => x.id === eid); if (e) fn(e, cur); });
  const restLeft = w.restEnd ? (w.restEnd - Date.now()) / 1000 : 0;
  useEffect(() => { if (w.restEnd && restLeft <= 0 && restLeft > -2){ beep(); upd(c => { c.restEnd = 0; }); } });
  const doneSets = w.exercises.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
  const vol = w.exercises.reduce((a, e) => a + e.sets.filter(s => s.done && s.t !== 'w').reduce((b, s) => b + (num(s.kg) || 0) * (num(s.reps) || 0), 0), 0);

  const tick = (e, s, prev) => {
    unlockAudio();
    updEx(e.id, (ex, cur) => {
      const st = ex.sets.find(x => x.id === s.id);
      if (st.done){ st.done = false; return; }
      if (st.kg === '') st.kg = st.tk || (prev && prev.kg ? r1(prev.kg) : '');
      if (st.reps === '') st.reps = st.tr || (prev && prev.reps ? String(prev.reps) : '');
      if (num(st.reps) == null || num(st.reps) === 0){ app.showToast('Enter the reps first.'); return; }
      st.done = true;
      if (ex.rest > 0) cur.restEnd = Date.now() + ex.rest * 1000;
    });
  };
  const finish = () => {
    const cur = store.get('gym/active');
    const result = finishWorkout(cur);
    if (!result){ app.setSheet({ kind: 'confirm', title: 'No sets ticked off', ok: 'Discard workout', danger: true, text: 'Nothing was logged, so there’s nothing to save. Discard this workout?', run: () => { store.del('gym/active'); env.home(); } }); return; }
    env.go({ type: 'done', id: result.id });
  };
  const open = w.exercises.reduce((a, e) => a + e.sets.filter(s => !s.done).length, 0);
  return html`<div class="stack workout">
    <div class="wtop">
      <button class="icon-btn" aria-label="Back to Gym" onClick=${env.home}><${Ico} d=${UI.down}/></button>
      <div class="grow col"><input class="wname" aria-label="Workout name" value=${w.name} onInput=${e => upd(c => { c.name = e.target.value; })}/>
        <span class="cat-sub">${clock((Date.now() - w.start) / 1000)} · ${fmtT(vol)} · ${plural(doneSets, 'set', 'sets')}</span></div>
      <button class="btn btn-pop sm" onClick=${() => app.setSheet({ kind: 'confirm', title: 'Finish workout?', ok: 'Finish', run: finish,
        text: open ? plural(open, 'set isn’t', 'sets aren’t') + ' ticked off and won’t be saved.' : 'Saves it to your history and checks for new records.' })}>Finish</button>
    </div>
    ${sheet && sheet.kind === 'reorder' && html`<${ReorderList} names=${w.exercises.map(e => exById(e.ex).n)} start=${sheet.start} onDone=${order => { upd(c => { c.exercises = order.map(i => c.exercises[i]); }); setSheet(null); }}/>`}
    <div class="blocks" hidden=${!!(sheet && sheet.kind === 'reorder')}>${w.exercises.map((e, i) => html`<${ExerciseBlock} key=${e.id} env=${env} start=${w.start} e=${e} idx=${i} updEx=${updEx} tick=${tick} setSheet=${setSheet}/>`)}</div>
    ${w.exercises.length === 0 && html`<section class="card"><p class="hint">Add your first exercise. Your numbers from last time show up next to each set.</p></section>`}
    <button class="btn btn-solid" onClick=${() => setSheet({ kind: 'pick' })}>+ Add exercises</button>
    <button class="btn btn-danger" onClick=${() => app.setSheet({ kind: 'confirm', title: 'Discard workout?', ok: 'Discard', danger: true, text: 'Everything logged in this workout is thrown away.', run: () => { store.del('gym/active'); env.home(); } })}>Discard workout</button>
    ${restLeft > 0 && html`<div class="restbar" role="timer" aria-label="Rest timer">
      <span class="rest-l">Rest</span><span class="rest-t">${clock(restLeft)}</span>
      <button onClick=${() => upd(c => { c.restEnd = Math.max(Date.now(), c.restEnd - 15000); })}>−15</button>
      <button onClick=${() => upd(c => { c.restEnd += 15000; })}>+15</button>
      <button onClick=${() => upd(c => { c.restEnd = 0; })}>Skip</button>
    </div>`}
    ${sheet && sheet.kind === 'pick' && html`<${PickerSheet} env=${env} close=${() => setSheet(null)} onPick=${ids => {
      setSheet(null);
      upd(c => { ids.forEach(id => { const note = store.get('exnotes/' + id) || {}; const last = lastFor(id, Infinity);
        const n = Math.max(1, last.filter(working).length || 3), wn = last.filter(s => s.t === 'w').length;
        c.exercises.push({ id: uid(), ex: id, rest: note.rest != null ? note.rest : 90, sets: Array.from({ length: wn }, () => newSet('w')).concat(Array.from({ length: n }, () => newSet('n'))) }); }); });
    }}/>`}
    <${BlockSheets} env=${env} sheet=${sheet} setSheet=${setSheet} updEx=${updEx} remove=${eid => upd(c => { c.exercises = c.exercises.filter(x => x.id !== eid); })} back=${{ type: 'workout' }}/>
  </div>`;
}

/* One exercise as a set table. In a workout: SET · PREVIOUS · KG · REPS · RPE · ✓. In a routine: SET · PREVIOUS · KG · REPS,
   where kg and reps are the targets that show up greyed out when the routine is started. */
function ExerciseBlock({ env, start, e, idx, updEx, tick, setSheet, routine }){
  const ex = exById(e.ex);
  const prev = lastFor(e.ex, routine ? Infinity : start);
  const noteDoc = store.get('exnotes/' + e.ex) || {};
  const [note, setNote] = useState(noteDoc.note || '');
  let n = 0;
  const saveNote = () => { if ((noteDoc.note || '') !== note) store.set('exnotes/' + e.ex, Object.assign({}, noteDoc, { note })); };
  return html`<section class="card exblock">
    <div class="exhead">
      <button class="grip" aria-label="Drag to reorder" onPointerDown=${ev => { ev.preventDefault(); setSheet({ kind: 'reorder', start: { pos: idx, y: ev.clientY } }); }}><${Ico} d=${UI.grip} size=${22}/></button>
      ${routine ? html`<span class="exname static grow">${ex.n}</span>` : html`<button class="exname grow" onClick=${() => env.go({ type: 'ex', id: e.ex, back: { type: 'workout' } })}>${ex.n}</button>`}
      <button class="icon-btn" aria-label=${'Options for ' + ex.n} onClick=${() => setSheet({ kind: 'exmenu', e, idx })}><${Ico} d=${UI.dots} size=${20}/></button>
    </div>
    <textarea class="exnote" rows="1" placeholder="Add a note for this exercise" value=${note} onInput=${ev => { setNote(ev.target.value); ev.target.style.height = 'auto'; ev.target.style.height = ev.target.scrollHeight + 'px'; }} onBlur=${saveNote}></textarea>
    <label class="restsel"><${Ico} d=${UI.timer} size=${15}/>Rest
      <select value=${e.rest} onChange=${ev => { const r = Number(ev.target.value); updEx(e.id, x => { x.rest = r; }); store.set('exnotes/' + e.ex, Object.assign({}, store.get('exnotes/' + e.ex) || {}, { rest: r })); }}>
        ${RESTS.map(r => html`<option key=${r} value=${r}>${r ? clock(r) : 'Off'}</option>`)}
      </select></label>
    <div class=${'settable' + (routine ? ' routine' : '')} role="table">
      <div class="srow shead" role="row"><span>Set</span><span>Previous</span><span>kg</span><span>Reps</span>${!routine && html`<span>RPE</span><span aria-label="Done"><${Ico} d=${UI.check} size=${14} sw=${3}/></span>`}</div>
      ${e.sets.map((s, i) => {
        const label = s.t === 'w' ? 'W' : s.t === 'f' ? 'F' : s.t === 'd' ? 'D' : String(++n);
        const p = prev[i];
        const set = (k, v) => updEx(e.id, x => { x.sets.find(y => y.id === s.id)[k] = v; });
        const phK = s.tk || (p ? r1(p.kg || 0) : '0'), phR = s.tr || (p ? String(p.reps) : '0');
        return html`<div key=${s.id} class=${'srow' + (s.done ? ' done' : '')} role="row">
          <button class=${'stype t-' + s.t} aria-label=${'Set ' + label + ', change type'} onClick=${() => setSheet({ kind: 'type', eid: e.id, set: s, label })}>${label}</button>
          <button class="sprev" aria-label="Use previous" onClick=${() => p && updEx(e.id, x => { const y = x.sets.find(z => z.id === s.id); y.kg = r1(p.kg || 0); y.reps = String(p.reps || ''); })}>${p ? r1(p.kg || 0) + ' × ' + p.reps : '–'}</button>
          <input class="sin" inputmode="decimal" aria-label="kg" placeholder=${phK} value=${s.kg} onInput=${ev => set('kg', ev.target.value)} onFocus=${ev => ev.target.select()}/>
          <input class="sin" inputmode="numeric" aria-label="Reps" placeholder=${phR} value=${s.reps} onInput=${ev => set('reps', ev.target.value)} onFocus=${ev => ev.target.select()}/>
          ${!routine && html`<select class="sin rpe" aria-label="RPE" value=${s.rpe} onChange=${ev => set('rpe', ev.target.value)}>${RPES.map(r => html`<option key=${r} value=${r}>${r || '–'}</option>`)}</select>
          <button class=${'sdone' + (s.done ? ' on' : '')} aria-pressed=${String(s.done)} aria-label=${s.done ? 'Undo set' : 'Complete set'} onClick=${() => tick(e, s, p)}><${Ico} d=${UI.check} size=${16} sw=${3.2}/></button>`}
        </div>`;
      })}
    </div>
    <button class="add-set" onClick=${() => updEx(e.id, x => { const last = x.sets[x.sets.length - 1]; const ns = newSet(last && last.t !== 'w' ? last.t : 'n'); if (last){ ns.kg = last.kg; ns.tk = last.tk || ''; ns.tr = last.tr || ''; } x.sets.push(ns); })}>+ Add set</button>
  </section>`;
}

/* Set type and exercise menus, shared by workouts and routines */
function BlockSheets({ env, sheet, setSheet, updEx, remove, back }){
  if (!sheet) return null;
  if (sheet.kind === 'type') return html`<${Sheet} title=${'Set ' + sheet.label} close=${() => setSheet(null)}>
    <div class="list">${TYPES.map(([t, name, l]) => html`<button key=${t} class="act-pick" aria-pressed=${String(sheet.set.t === t)} onClick=${() => { updEx(sheet.eid, ex => { ex.sets.find(x => x.id === sheet.set.id).t = t; }); setSheet(null); }}>
      <span class=${'stype t-' + t}>${l || '1'}</span><span class="grow row-title">${name}</span></button>`)}</div>
    <button class="btn btn-danger" onClick=${() => { updEx(sheet.eid, ex => { ex.sets = ex.sets.filter(x => x.id !== sheet.set.id); }); setSheet(null); }}>Remove set</button>
  <//>`;
  if (sheet.kind === 'exmenu') return html`<${Sheet} title=${exById(sheet.e.ex).n} close=${() => setSheet(null)}>
    <button class="row-btn" onClick=${() => setSheet({ kind: 'reorder' })}><span class="grow">Reorder exercises</span><${Ico} d=${UI.grip} size=${18}/></button>
    ${back && html`<button class="row-btn" onClick=${() => { setSheet(null); env.go({ type: 'ex', id: sheet.e.ex, back }); }}>Records, history and how-to</button>`}
    <button class="btn btn-danger" onClick=${() => { remove(sheet.e.id); setSheet(null); }}>Remove exercise</button>
  <//>`;
  return null;
}

/* Drag to reorder. Started from a card's handle (start = { pos, y }) the list appears with that exercise under the finger
   and the new order is saved on release; opened from the menu, any row can be dragged and Done closes it.
   onDone gets the new order as indexes into the original list. */
const ROW = 60;
function ReorderList({ names, onDone, start }){
  const [order, setOrder] = useState(() => names.map((_, i) => i));
  const [drag, setDrag] = useState(null);
  const listRef = useRef(null), dragRef = useRef(null), orderRef = useRef(order);
  const n = order.length;
  const targetOf = d => Math.max(0, Math.min(n - 1, d.pos + Math.round(d.dy / ROW)));
  const begin = (pos, y) => { const d = { pos, y0: y, dy: 0 }; dragRef.current = d; setDrag(d); };
  useEffect(() => {
    const move = e => { const d = dragRef.current; if (!d) return; e.preventDefault(); const nd = Object.assign({}, d, { dy: e.clientY - d.y0 }); dragRef.current = nd; setDrag(nd); };
    const up = () => {
      const d = dragRef.current; if (!d) return;
      const o = orderRef.current.slice(), [x] = o.splice(d.pos, 1); o.splice(targetOf(d), 0, x);
      orderRef.current = o; dragRef.current = null; setOrder(o); setDrag(null);
      if (start) onDone(o);
    };
    const stopScroll = e => { if (dragRef.current) e.preventDefault(); };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    window.addEventListener('touchmove', stopScroll, { passive: false });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); window.removeEventListener('touchmove', stopScroll); };
  }, []);
  /* coming from a card: put the picked exercise right under the finger */
  useEffect(() => {
    if (!start || !listRef.current) return;
    const top = listRef.current.getBoundingClientRect().top;
    const dy = start.y - (top + start.pos * ROW + 26);
    const d = { pos: start.pos, y0: start.y - dy, dy };
    dragRef.current = d; setDrag(d);
  }, []);
  const target = drag ? targetOf(drag) : -1;
  return html`<section class="card reorder">
    <div class="row-between"><h2 class="card-title">Reorder exercises</h2>${!start && html`<button class="btn btn-pop sm" onClick=${() => onDone(orderRef.current)}>Done</button>`}</div>
    ${!start && html`<p class="hint">Press and drag an exercise up or down.</p>`}
    <div class="rlist" ref=${listRef} style=${'height:' + n * ROW + 'px'}>
      ${order.map((orig, pos) => {
        let y = pos * ROW;
        if (drag){ if (pos === drag.pos) y += drag.dy; else if (drag.pos < pos && pos <= target) y -= ROW; else if (target <= pos && pos < drag.pos) y += ROW; }
        return html`<div key=${orig} class=${'rrow' + (drag && pos === drag.pos ? ' lifted' : '')} style=${'transform:translateY(' + y + 'px)'}
          onPointerDown=${e => { e.preventDefault(); begin(pos, e.clientY); }}>
          <span class="grow row-title">${names[orig]}</span>
          <span class="rhandle" aria-hidden="true"><${Ico} d=${UI.grip} size=${22}/></span>
        </div>`;
      })}
    </div>
  </section>`;
}

/* Save the workout: keep ticked sets, find records, mark the day as a training day */
function finishWorkout(cur){
  const end = Date.now();
  const exercises = cur.exercises.map(e => ({ ex: e.ex, sets: e.sets.filter(s => s.done).map(s => ({ t: s.t, kg: num(s.kg) || 0, reps: num(s.reps) || 0, rpe: num(s.rpe) || null })) })).filter(e => e.sets.length);
  if (!exercises.length) return null;
  let prs = 0;
  exercises.forEach(e => {
    const b = bestsBefore(e.ex, cur.start);
    const had = store.list('workouts/').some(w => w.exercises.some(x => x.ex === e.ex));
    e.sets.forEach(s => {
      if (s.t === 'w') return;
      const kinds = [];
      if (had && s.kg > b.kg){ kinds.push('kg'); b.kg = s.kg; }
      if (had && e1rm(s.kg, s.reps) > b.orm + 0.01){ kinds.push('1rm'); b.orm = e1rm(s.kg, s.reps); }
      if (had && s.kg * s.reps > b.vol){ kinds.push('vol'); b.vol = s.kg * s.reps; }
      if (kinds.length){ s.pr = kinds; prs++; }
    });
  });
  const date = dayKey(new Date(cur.start));
  const w = { id: cur.id, name: (cur.name || '').trim() || defaultName(cur.start), routineId: cur.routineId || null, date, start: cur.start, end, exercises, prs };
  store.set('workouts/' + w.id, w);
  store.del('gym/active');
  const log = store.get('log/' + date) || { date, entries: [] };
  if (!log.training) store.set('log/' + date, Object.assign({}, log, { date, training: true }));
  return w;
}

/* ---------- Exercise picker ---------- */
/* Search ranking: a common gym name (alias) first, then names that start with or contain the words */
export const rank = (x, ql) => { const n = x.n.toLowerCase(), al = (x.a || '').split(',').map(t => t.trim());
  return (al.includes(ql) ? 8 : al.some(t => t.startsWith(ql)) ? 5 : 0) + (n.startsWith(ql) ? 3 : n.includes(ql) ? 2 : 0) + (x.custom ? 1 : 0); };
function PickerSheet({ env, close, onPick }){
  const [q, setQ] = useState('');
  const [mus, setMus] = useState('');
  const [eq, setEq] = useState('');
  const [sel, setSel] = useState([]);
  const [limit, setLimit] = useState(60);
  const ql = q.trim().toLowerCase();
  const words = ql.split(/\s+/).filter(Boolean);
  const recent = {}; workoutsList().slice(0, 30).forEach((w, i) => w.exercises.forEach(e => { if (!(e.ex in recent)) recent[e.ex] = i; }));
  let list = allExercises().filter(x => (!mus || x.p.includes(mus)) && (!eq || x.e === eq) && words.every(wd => (x.n + ' ' + (x.a || '')).toLowerCase().includes(wd)));
  if (!ql) list = list.slice().sort((a, b) => (a.id in recent ? recent[a.id] : 999) - (b.id in recent ? recent[b.id] : 999) || (b.custom ? 1 : 0) - (a.custom ? 1 : 0));
  else list = list.slice().sort((a, b) => rank(b, ql) - rank(a, ql) || a.n.length - b.n.length);
  const toggle = id => setSel(sel.includes(id) ? sel.filter(x => x !== id) : sel.concat([id]));
  const [peek, setPeek] = useState(null);
  const go = sel.length > 0 && html`<button class="btn btn-pop picker-go" onClick=${() => onPick(sel)}>Add ${plural(sel.length, 'exercise', 'exercises')}</button>`;
  if (peek){
    const x = exById(peek), on = sel.includes(peek);
    return html`<${Sheet} title=${x.n} close=${close} tall=${true}>
      <button class="link sm-link" onClick=${() => setPeek(null)}><${Ico} d=${UI.back} size=${16} sw=${2.6}/>All exercises</button>
      <${ExerciseInfo} ex=${x}/>
      <button class=${'btn ' + (on ? 'btn-ghost' : 'btn-solid')} onClick=${() => { toggle(peek); if (!on) setPeek(null); }}>${on ? 'Selected ✓ · tap to unselect' : 'Select this exercise'}</button>
      ${go}
    <//>`;
  }
  return html`<${Sheet} title="Add exercises" close=${close} tall=${true}>
    <div class="search"><${Ico} d=${UI.search} size=${18}/><input type="search" aria-label="Search exercises" placeholder="Search exercises" value=${q} onInput=${e => { setQ(e.target.value); setLimit(60); }}/></div>
    <div class="filters">
      <select aria-label="Muscle" value=${mus} onChange=${e => setMus(e.target.value)}><option value="">All muscles</option>${MUSCLES.map(m => html`<option key=${m} value=${m}>${MUSCLE_NAMES[m]}</option>`)}</select>
      <select aria-label="Equipment" value=${eq} onChange=${e => setEq(e.target.value)}><option value="">All equipment</option>${EQUIP.map(m => html`<option key=${m} value=${m}>${cap(m)}</option>`)}</select>
    </div>
    <div class="list">
      ${list.slice(0, limit).map(x => { const on = sel.includes(x.id); const th = exThumb(x); return html`<div key=${x.id} class=${'exrow pick' + (on ? ' on' : '')}>
        <button class="exrow-main" onClick=${() => setPeek(x.id)}>
          <span class="thumb">${th ? html`<img src=${th} alt="" loading="lazy"/>` : html`<${Ico} d=${UI.gym} size=${18}/>`}</span>
          <span class="col grow"><span class="row-title">${x.n}${x.custom ? html` <span class="pill">custom</span>` : ''}</span><span class="row-sub">${muscleLine(x)}</span></span>
        </button>
        <button class=${'selbtn' + (on ? ' on' : '')} aria-pressed=${String(on)} aria-label=${(on ? 'Unselect ' : 'Select ') + x.n} onClick=${() => toggle(x.id)}><${Ico} d=${on ? UI.check : UI.plus} size=${16} sw=${3}/></button>
      </div>`; })}
      ${list.length > limit && html`<button class="btn btn-ghost sm" onClick=${() => setLimit(limit + 100)}>Show more (${list.length - limit})</button>`}
      ${list.length === 0 && html`<p class="hint">Nothing matches. Try another word, or create it as a custom exercise.</p>`}
    </div>
    <button class="row-btn" onClick=${() => { close(); env.go({ type: 'custom', id: null, back: { type: 'workout' } }); }}><span class="grow">Can’t find it? Create a custom exercise</span><${Ico} d=${UI.plus} size=${16}/></button>
    ${go}
  <//>`;
}

/* ---------- Finished workout ---------- */
function WorkoutDetail({ env, id, justDone }){
  const { app } = env;
  const w = store.get('workouts/' + id);
  if (!w) return html`<div class="stack"><${Bar} title="Workout" back=${env.home}/><p class="hint">This workout was deleted.</p></div>`;
  const del = () => app.setSheet({ kind: 'confirm', title: 'Delete workout?', ok: 'Delete', danger: true, text: 'Removes it from your history and records.',
    run: () => { store.del('workouts/' + id); env.home(); app.showToast('Workout deleted.', { label: 'Undo', run: () => store.set('workouts/' + id, w) }); } });
  const asRoutine = () => { env.go({ type: 'routine', id: null, seed: { name: w.name, items: w.exercises.map(e => ({ ex: e.ex, rest: (store.get('exnotes/' + e.ex) || {}).rest || 90, sets: e.sets.map(x => ({ t: x.t, kg: x.kg, reps: x.reps })) })) } }); };
  return html`<div class="stack">
    <${Bar} title=${justDone ? 'Workout saved' : fmtShort(w.date)} back=${env.home}/>
    <section class="card">
      <h2 class="card-title">${w.name}</h2>
      <div class="wstats"><span><b>${fmtDur(w.end - w.start)}</b>time</span><span><b>${fmtT(volumeOf(w))}</b>volume</span><span><b>${setsOf(w)}</b>sets</span><span><b class="gold">${w.prs || 0}</b>records</span></div>
      ${justDone && w.prs > 0 && html`<p class="prs big">★ ${plural(w.prs, 'new record', 'new records')}. Nice work.</p>`}
    </section>
    ${w.exercises.map((e, i) => { let n = 0; const ex = exById(e.ex); return html`<section key=${i} class="card">
      <button class="exname" onClick=${() => env.go({ type: 'ex', id: e.ex, back: { type: 'detail', id } })}>${ex.n}</button>
      <div class="list tight">${e.sets.map((s, j) => html`<div key=${j} class="hset">
        <span class=${'stype t-' + s.t}>${s.t === 'w' ? 'W' : s.t === 'f' ? 'F' : s.t === 'd' ? 'D' : ++n}</span>
        <span class="grow">${r1(s.kg)} kg × ${s.reps}${s.rpe ? html` <span class="cat-sub">@ ${s.rpe}</span>` : ''}</span>
        ${s.pr && html`<span class="prs">★ ${s.pr.map(k => k === 'kg' ? 'heaviest' : k === '1rm' ? 'best 1RM' : 'best set').join(', ')}</span>`}
      </div>`)}</div>
    </section>`; })}
    <button class="btn btn-ghost" onClick=${asRoutine}>Save as routine</button>
    <button class="btn btn-danger" onClick=${del}>Delete workout</button>
  </div>`;
}
function Bar({ title, back, right }){
  return html`<div class="topbar"><button class="link" onClick=${back}><${Ico} d=${UI.back} size=${18} sw=${2.6}/>Back</button><h1>${title}</h1>${right || html`<span></span>`}</div>`;
}

/* ---------- Exercise detail: records, chart, history, how-to ---------- */
function ExerciseDetail({ env, id, back }){
  const ex = exById(id);
  const goBack = () => back ? env.go(back) : env.home();
  const sessions = workoutsList().filter(w => w.exercises.some(e => e.ex === id)).map(w => ({ w, sets: w.exercises.filter(e => e.ex === id).flatMap(e => e.sets).filter(working) }));
  const all = sessions.flatMap(s => s.sets);
  const best = all.reduce((b, s) => ({ kg: Math.max(b.kg, s.kg), orm: Math.max(b.orm, e1rm(s.kg, s.reps)), vol: Math.max(b.vol, s.kg * s.reps), reps: Math.max(b.reps, s.reps) }), { kg: 0, orm: 0, vol: 0, reps: 0 });
  const points = sessions.slice(0, 16).reverse().map(s => ({ d: s.w.date, v: Math.max(...s.sets.map(x => e1rm(x.kg, x.reps))) }));
  const noteDoc = store.get('exnotes/' + id) || {};
  const [note, setNote] = useState(noteDoc.note || '');
  return html`<div class="stack">
    <${Bar} title="Exercise" back=${goBack} right=${ex.custom ? html`<button class="link" onClick=${() => env.go({ type: 'custom', id })}>Edit</button>` : null}/>
    <section class="card">
      <h2 class="card-title gold">${ex.n}</h2>
      <${ExerciseInfo} ex=${ex}/>
    </section>
    <section class="card">
      <h2 class="card-title">Records</h2>
      ${all.length ? html`<div class="recs">
          <span><b>${r1(best.kg)} kg</b>heaviest</span><span><b>${r1(best.orm)} kg</b>best 1RM (est.)</span>
          <span><b>${Math.round(best.vol)} kg</b>best set</span><span><b>${best.reps}</b>most reps</span>
        </div>
        <${Chart} points=${points}/>
        <p class="hint">Estimated 1-rep max per workout, worked out from your best set (Epley formula).</p>`
        : html`<p class="hint">Log this exercise once and your records and chart show up here.</p>`}
    </section>
    <section class="card">
      <h2 class="card-title">Note</h2>
      <textarea class="exnote" rows="2" placeholder="Seat height, grip, cues…" value=${note} onInput=${e => setNote(e.target.value)} onBlur=${() => store.set('exnotes/' + id, Object.assign({}, store.get('exnotes/' + id) || {}, { note }))}></textarea>
    </section>
    ${sessions.length > 0 && html`<section class="card">
      <h2 class="card-title">History</h2>
      ${sessions.slice(0, 20).map(s => html`<div key=${s.w.id} class="hist">
        <span class="row-between"><b>${fmtShort(s.w.date)}</b><span class="cat-sub">${s.w.name}</span></span>
        <span class="row-sub wrap">${s.sets.map(x => r1(x.kg) + '×' + x.reps).join(' · ')}</span>
      </div>`)}
    </section>`}
  </div>`;
}

/* Photo demo, muscles, video link and how-to steps */
function ExerciseInfo({ ex }){
  const [howto, setHowto] = useState(false);
  const last = lastFor(ex.id, Infinity).filter(working);
  return html`<div class="stack-sm">
    <p class="hint">${muscleLine(ex)}${ex.e ? ' · ' + cap(ex.e) : ''}</p>
    ${ex.custom ? (ex.photo && html`<img class="exphoto" src=${ex.photo} alt=${ex.n}/>`) : ex.im > 0 && html`<${Demo} ex=${ex}/>`}
    ${ex.custom && ex.desc && html`<p class="exdesc">${ex.desc}</p>`}
    ${last.length > 0 && html`<p class="hint">Last time: ${last.map(x => r1(x.kg) + ' × ' + x.reps).join(', ')}</p>`}
    <a class="btn btn-ghost sm video-btn" href=${'https://www.youtube.com/results?search_query=' + encodeURIComponent(ex.n.replace(/\s*\(.*?\)|\s+-\s+/g, ' ') + ' exercise proper form')} target="_blank" rel="noopener"><${Ico} d=${UI.play} size=${16}/>Watch a video</a>
    ${!ex.custom && ex.in && ex.in.length > 0 && (howto
      ? html`<ol class="steps">${ex.in.map((t, i) => html`<li key=${i}>${t}</li>`)}</ol>`
      : html`<button class="link sm-link" onClick=${() => setHowto(true)}>How to do it</button>`)}
  </div>`;
}

/* Start and end photos shown in turn, so the movement plays like a short loop. Tap to pause. */
function Demo({ ex }){
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const two = ex.im > 1;
  useEffect(() => { if (!two || paused) return; const t = setInterval(() => setI(v => 1 - v), 1000); return () => clearInterval(t); }, [paused]);
  return html`<button class="demo" aria-label=${paused ? 'Play demo' : 'Pause demo'} onClick=${() => setPaused(!paused)}>
    <img src=${IMG(ex.id, 0)} alt=${ex.n + ', start position'} class=${i === 0 ? 'on' : ''}/>
    ${two && html`<img src=${IMG(ex.id, 1)} alt=${ex.n + ', end position'} class=${i === 1 ? 'on' : ''}/>`}
    ${two && html`<span class="demo-tag">${paused ? (i ? 'End' : 'Start') + ' · tap to play' : i ? 'End' : 'Start'}</span>`}
  </button>`;
}

function Chart({ points }){
  if (points.length < 2) return null;
  const W = 300, H = 110, P = 10;
  const vs = points.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = Math.max(hi - lo, 1);
  const xy = points.map((p, i) => [P + i / (points.length - 1) * (W - 2 * P), P + (hi - p.v) / span * (H - 2 * P - 14) + 6]);
  return html`<svg class="wchart" viewBox=${'0 0 ' + W + ' ' + H} role="img" aria-label=${'Estimated 1RM from ' + r1(vs[0]) + ' to ' + r1(vs[vs.length - 1]) + ' kg'}>
    <polyline points=${xy.map(p => p.join(',')).join(' ')} fill="none" stroke="var(--gold)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${xy.map((p, i) => html`<circle key=${i} cx=${p[0]} cy=${p[1]} r="3.5" fill="var(--gold)"/>`)}
    <text x=${P} y=${H - 2} class="ctext">${fmtShort(points[0].d)}</text>
    <text x=${W - P} y=${H - 2} class="ctext" text-anchor="end">${r1(vs[vs.length - 1])} kg</text>
  </svg>`;
}

/* ---------- Library ---------- */
function LibraryView({ env }){
  return html`<div class="stack"><${Bar} title="Exercises" back=${env.home} right=${html`<button class="link" onClick=${() => env.go({ type: 'custom', id: null })}>+ Custom</button>`}/><${LibraryList} env=${env}/></div>`;
}
function LibraryList({ env }){
  const [q, setQ] = useState('');
  const [mus, setMus] = useState('');
  const [limit, setLimit] = useState(80);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const done = new Set(); store.list('workouts/').forEach(w => w.exercises.forEach(e => done.add(e.ex)));
  const list = allExercises().filter(x => (!mus || x.p.includes(mus)) && words.every(wd => (x.n + ' ' + (x.a || '')).toLowerCase().includes(wd)))
    .sort((a, b) => (done.has(b.id) ? 1 : 0) - (done.has(a.id) ? 1 : 0) || (words.length ? rank(b, words.join(' ')) - rank(a, words.join(' ')) || a.n.length - b.n.length : 0));
  return html`<div class="stack">
    <div class="search"><${Ico} d=${UI.search} size=${18}/><input type="search" aria-label="Search exercises" placeholder=${'Search ' + allExercises().length + ' exercises'} value=${q} onInput=${e => setQ(e.target.value)}/></div>
    <div class="filters"><select aria-label="Muscle" value=${mus} onChange=${e => setMus(e.target.value)}><option value="">All muscles</option>${MUSCLES.map(m => html`<option key=${m} value=${m}>${MUSCLE_NAMES[m]}</option>`)}</select></div>
    <div class="list">
      ${list.slice(0, limit).map(x => { const th = exThumb(x); return html`<button key=${x.id} class="exrow" onClick=${() => env.go({ type: 'ex', id: x.id })}>
        <span class="thumb">${th ? html`<img src=${th} alt="" loading="lazy"/>` : html`<${Ico} d=${UI.gym} size=${18}/>`}</span>
        <span class="col grow"><span class="row-title">${x.n}${x.custom ? html` <span class="pill">custom</span>` : ''}</span><span class="row-sub">${muscleLine(x)}</span></span>
        ${done.has(x.id) && html`<span class="pill">logged</span>`}
      </button>`; })}
      ${list.length > limit && html`<button class="btn btn-ghost sm" onClick=${() => setLimit(limit + 150)}>Show more (${list.length - limit})</button>`}
    </div>
    <button class="row-btn" onClick=${() => env.go({ type: 'custom', id: null })}><span class="grow">Can’t find it? Create a custom exercise</span><${Ico} d=${UI.plus} size=${16}/></button>
  </div>`;
}

/* ---------- Custom exercise ---------- */
function shrinkPhoto(file){
  return new Promise((ok, fail) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(1, 480 / Math.max(img.width, img.height)); const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.72)); };
    img.onerror = () => { URL.revokeObjectURL(url); fail(); };
    img.src = url;
  });
}
function CustomExercise({ env, id }){
  const { app } = env;
  const old = id ? store.get('exercises/' + id) : null;
  const [x, setX] = useState(() => old ? clone(old) : { n: '', desc: '', p: [], s: [], e: 'machine', photo: '' });
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const set = patch => { setX(prev => Object.assign({}, prev, patch)); setErr(''); };
  const tog = (k, m) => set({ [k]: x[k].includes(m) ? x[k].filter(y => y !== m) : x[k].concat([m]) });
  const save = () => {
    if (!x.n.trim()){ setErr('Give the exercise a name.'); return; }
    if (!x.p.length){ setErr('Pick at least one main muscle.'); return; }
    const nid = id || 'c_' + uid();
    store.set('exercises/' + nid, Object.assign({}, x, { id: nid, n: x.n.trim(), s: x.s.filter(m => !x.p.includes(m)), custom: true, in: [], im: 0 }));
    app.showToast('Exercise saved.'); env.go({ type: 'ex', id: nid });
  };
  const used = id && store.list('workouts/').some(w => w.exercises.some(e => e.ex === id));
  return html`<div class="stack">
    <${Bar} title=${id ? 'Edit exercise' : 'Custom exercise'} back=${() => id ? env.go({ type: 'ex', id }) : env.home()}/>
    <section class="card">
      <div class="field"><label class="label" for="cx-name">Name</label><input id="cx-name" class="input inset" value=${x.n} onInput=${e => set({ n: e.target.value })}/></div>
      <div class="field"><label class="label" for="cx-desc">How to do it</label><textarea id="cx-desc" class="input inset area" rows="3" value=${x.desc} onInput=${e => set({ desc: e.target.value })}></textarea></div>
      <div class="field"><span class="label">Photo</span>
        ${x.photo ? html`<img class="exphoto" src=${x.photo} alt="Exercise photo"/>` : ''}
        <div class="btn-row"><button class="btn btn-ghost sm" onClick=${() => fileRef.current && fileRef.current.click()}>${x.photo ? 'Change photo' : 'Add photo'}</button>
          ${x.photo && html`<button class="btn btn-ghost sm" onClick=${() => set({ photo: '' })}>Remove</button>`}</div>
        <input ref=${fileRef} type="file" accept="image/*" hidden onChange=${async e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return; try { set({ photo: await shrinkPhoto(f) }); } catch (er){ setErr('That photo couldn’t be read.'); } }}/>
      </div>
      <div class="field"><label class="label" for="cx-eq">Equipment</label><select id="cx-eq" class="input inset" value=${x.e} onChange=${e => set({ e: e.target.value })}>${EQUIP.map(m => html`<option key=${m} value=${m}>${cap(m)}</option>`)}</select></div>
    </section>
    <section class="card">
      <span class="label">Main muscles</span>
      <div class="mchips">${MUSCLES.map(m => html`<button key=${m} class="chip-toggle" aria-pressed=${String(x.p.includes(m))} onClick=${() => tog('p', m)}>${MUSCLE_NAMES[m]}</button>`)}</div>
      <span class="label">Helper muscles</span>
      <div class="mchips">${MUSCLES.filter(m => !x.p.includes(m)).map(m => html`<button key=${m} class="chip-toggle" aria-pressed=${String(x.s.includes(m))} onClick=${() => tog('s', m)}>${MUSCLE_NAMES[m]}</button>`)}</div>
    </section>
    ${err && html`<p class="status bad">${err}</p>`}
    <button class="btn btn-pop" onClick=${save}>Save exercise</button>
    ${id && html`<button class="btn btn-danger" onClick=${() => app.setSheet({ kind: 'confirm', title: 'Delete ' + old.n + '?', ok: 'Delete', danger: true,
      text: used ? 'It stays in past workouts by name, but you can’t add it again.' : 'It’s not used in any workout.',
      run: () => { store.del('exercises/' + id); env.home(); } })}>Delete exercise</button>`}
  </div>`;
}

/* ---------- Routines ---------- */
const toBlock = it => ({ id: uid(), ex: it.ex, rest: it.rest != null ? it.rest : 90, sets: it.sets.map(x => Object.assign(newSet(x.t), { kg: x.kg != null ? String(x.kg) : '', reps: x.reps != null ? String(x.reps) : '' })) });
function RoutineEditor({ env, id, seed }){
  const { app } = env;
  const old = id ? store.get('routines/' + id) : null;
  const [r, setR] = useState(() => { const src = normRoutine(old ? clone(old) : Object.assign({ name: '', items: [] }, clone(seed || {}))); return { name: src.name || '', items: src.items.map(toBlock) }; });
  const [sheet, setSheet] = useState(null);
  const [err, setErr] = useState('');
  const set = patch => { setR(prev => Object.assign({}, prev, typeof patch === 'function' ? patch(prev) : patch)); setErr(''); };
  const updEx = (eid, fn) => set(prev => ({ items: prev.items.map(it => { if (it.id !== eid) return it; const c = clone(it); fn(c); return c; }) }));
  const save = () => {
    if (!r.name.trim()){ setErr('Give the routine a name.'); scrollTop(); return; }
    if (!r.items.length){ setErr('Add at least one exercise.'); return; }
    if (r.items.some(it => !it.sets.length)){ setErr('Every exercise needs at least one set.'); return; }
    const rid = id || uid();
    store.set('routines/' + rid, { id: rid, name: r.name.trim(), items: r.items.map(it => ({ ex: it.ex, rest: it.rest, sets: it.sets.map(x => ({ t: x.t, kg: num(x.kg) != null ? num(x.kg) : '', reps: num(x.reps) != null ? num(x.reps) : '' })) })) });
    app.showToast('Routine saved.'); env.home();
  };
  return html`<div class="stack">
    <div class="topbar"><button class="link" onClick=${env.home}><${Ico} d=${UI.back} size=${18} sw=${2.6}/>Cancel</button><h1>${id ? 'Edit routine' : 'New routine'}</h1><button class="link" onClick=${save}>Save</button></div>
    <input class="input meal-name" aria-label="Routine name" placeholder="Routine name, like “Push day”" value=${r.name} onInput=${e => set({ name: e.target.value })}/>
    ${err && html`<p class="status bad">${err}</p>`}
    ${sheet && sheet.kind === 'reorder' && html`<${ReorderList} names=${r.items.map(it => exById(it.ex).n)} start=${sheet.start} onDone=${order => { set(prev => ({ items: order.map(i => prev.items[i]) })); setSheet(null); }}/>`}
    <div class="blocks" hidden=${!!(sheet && sheet.kind === 'reorder')}>${r.items.map((e, i) => html`<${ExerciseBlock} key=${e.id} env=${env} e=${e} idx=${i} updEx=${updEx} setSheet=${setSheet} routine=${true}/>`)}</div>
    ${r.items.length === 0 && html`<section class="card"><p class="hint">Add the exercises for this routine. Set the number of sets, and optionally the kg and reps to aim for. When you start it, your numbers from last time show up next to each set.</p></section>`}
    <button class="btn btn-solid" onClick=${() => setSheet({ kind: 'pick' })}>+ Add exercises</button>
    <button class="btn btn-pop" onClick=${save}>Save routine</button>
    ${id && html`<button class="btn btn-danger" onClick=${() => app.setSheet({ kind: 'confirm', title: 'Delete ' + old.name + '?', ok: 'Delete', danger: true, text: 'Past workouts stay in your history.', run: () => { store.del('routines/' + id); env.home(); } })}>Delete routine</button>`}
    ${sheet && sheet.kind === 'pick' && html`<${PickerSheet} env=${env} close=${() => setSheet(null)} onPick=${ids => { setSheet(null);
      set(prev => ({ items: prev.items.concat(ids.map(x => { const last = lastFor(x, Infinity);
        const sets = last.length ? last.map(z => ({ t: z.t, kg: '', reps: '' })) : [1, 2, 3].map(() => ({ t: 'n', kg: '', reps: '' }));
        return toBlock({ ex: x, rest: (store.get('exnotes/' + x) || {}).rest, sets }); })) })); }}/>`}
    <${BlockSheets} env=${env} sheet=${sheet} setSheet=${setSheet} updEx=${updEx} remove=${eid => set(prev => ({ items: prev.items.filter(it => it.id !== eid) }))}/>
  </div>`;
}

/* Bar shown on other tabs while a workout is running */
export function WorkoutBar({ onOpen }){
  useTick();
  const w = store.get('gym/active');
  if (!w) return null;
  const rest = w.restEnd ? (w.restEnd - Date.now()) / 1000 : 0;
  if (w.restEnd && rest <= 0 && rest > -2){ beep(); store.set('gym/active', Object.assign({}, w, { restEnd: 0 })); }
  return html`<button class="wbar" onClick=${onOpen}><span class="wdot"></span><span class="grow">${w.name}</span><span>${rest > 0 ? 'Rest ' + clock(rest) : clock((Date.now() - w.start) / 1000)}</span></button>`;
}
