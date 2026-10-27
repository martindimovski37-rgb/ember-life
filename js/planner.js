/* Day planner: the Day Planner app, moved into Ember Life.
   Docs: planner/config (categories, combos, energy levels), planner/current (the active plan), days/<date> (history). */
import { html, useState, useEffect, useRef, Ico, UI, COLORS, COLOR, LEGACY_COLOR, ICONS, ICON, tint, iconPath,
  dayKey, fmtLong, fmtShort, fmtMonth, weekStartKey, lastMonthKey, uid, clone, plural, joinNames, scrollTop } from './lib.js';
import { store } from './store.js';

const meta = a => [a.energy ? a.energy + ' energy' : '', a.duration].filter(Boolean).join(' · ');
const catSub = c => (c.required ? 'Required' : 'Optional') + ' · ' + (c.max ? 'pick up to ' + c.max : 'pick any number');

export function normConfig(d){
  const src = d || {};
  const energy = Array.isArray(src.energy) && src.energy.length ? src.energy.map(String) : ['Low', 'Medium', 'High'];
  return {
    energy,
    categories: (Array.isArray(src.categories) ? src.categories : []).map(c => ({
      id: String(c.id), name: c.name || '', color: COLOR[c.color] ? c.color : (LEGACY_COLOR[c.color] || 'grape'), icon: ICON[c.icon] ? c.icon : 'star',
      max: Number.isFinite(c.max) ? c.max : 1, required: !!c.required,
      activities: (Array.isArray(c.activities) ? c.activities : []).map(a => ({ id: String(a.id), name: a.name || '', energy: a.energy || '', duration: a.duration || '' }))
    })),
    combos: (Array.isArray(src.combos) ? src.combos : []).map(co => ({ id: String(co.id), name: co.name || '', picks: Array.isArray(co.picks) ? co.picks.map(String) : [] }))
  };
}

/* Everything the planner screens need, rebuilt from the store on each render */
export function plannerCtx({ today, ui, setUi, showToast, setSheet }){
  const cfg = normConfig(store.get('planner/config'));
  const cats = cfg.categories, tags = cfg.energy;
  const index = {}; cats.forEach(c => c.activities.forEach(a => { index[a.id] = { a, c }; }));
  const cur = store.get('planner/current') || { date: today, picks: [], done: [], set: false };
  const picks = (cur.picks || []).filter(id => index[id]);
  const days = store.list('days/').sort((a, b) => a.date < b.date ? 1 : -1);
  const weekStart = weekStartKey(today);
  const weekCount = days.filter(d => d.date >= weekStart && d.date <= today).length;
  const energy = ui.energy || null;

  const updateConfig = fn => store.set('planner/config', fn(clone(cfg)));
  const saveCurrent = next => store.set('planner/current', next);
  const saveDay = (date, items, done) => store.set('days/' + date, { date, items, done, savedAt: Date.now() });
  const visible = a => {
    const lim = energy && tags.includes(energy) ? tags.indexOf(energy) : Infinity;
    const i = tags.indexOf(a.energy);
    return i < 0 || i <= lim;
  };
  const itemFor = (a, c) => ({ id: a.id, name: a.name || 'Untitled', energy: a.energy || '', duration: a.duration || '', catId: c.id, catName: c.name || 'Untitled', color: c.color, icon: c.icon });
  const planItems = list => { const out = []; cats.forEach(c => c.activities.forEach(a => { if (list.includes(a.id)) out.push(itemFor(a, c)); })); return out; };
  const openEdit = e => { setUi({ edit: e }); scrollTop(); };

  const ctx = {
    cfg, cats, tags, index, cur, picks, today, days, weekCount, energy, ui, visible, planItems, itemFor,
    setEnergy: v => setUi({ energy: v }),
    setSub: s => { setUi({ sub: s, edit: null }); scrollTop(); },
    togglePick(c, id){
      let p = picks.slice();
      if (p.includes(id)) p = p.filter(x => x !== id);
      else {
        const inCat = p.filter(x => index[x].c.id === c.id);
        if (c.max > 0 && inCat.length >= c.max) p = p.filter(x => x !== inCat[0]);
        p.push(id);
      }
      saveCurrent({ date: today, picks: p, done: (cur.done || []).filter(x => p.includes(x)), set: false, combo: null });
    },
    shuffle(){
      const p = [];
      cats.forEach(c => { const pool = c.activities.filter(visible); if (pool.length) p.push(pool[Math.floor(Math.random() * pool.length)].id); });
      if (!p.length) return showToast('Add a few activities first.');
      saveCurrent({ date: today, picks: p, done: [], set: false, combo: null });
    },
    applyCombo(co){
      const p = co.picks.filter(id => index[id]);
      if (!p.length) return showToast('That combo has no activities yet. Edit it in Activities.');
      saveCurrent({ date: today, picks: p, done: [], set: false, combo: co.id });
    },
    setPlan(force){
      if (!picks.length) return;
      const missing = cats.filter(c => c.required && !picks.some(id => index[id].c.id === c.id));
      if (missing.length && !force){ setSheet({ kind: 'required', missing: missing.map(c => c.name || 'Untitled') }); return; }
      const items = planItems(picks);
      const done = (cur.done || []).filter(x => picks.includes(x));
      saveCurrent({ date: today, picks, done, set: true, items, combo: cur.combo || null, setAt: Date.now() });
      saveDay(today, items, done);
      setSheet(null); scrollTop();
      showToast('Plan set. Enjoy your day.');
    },
    toggleDone(id){
      const was = cur.done || [];
      const done = was.includes(id) ? was.filter(x => x !== id) : was.concat([id]);
      saveCurrent(Object.assign({}, cur, { done }));
      if (cur.set && cur.items) saveDay(cur.date, cur.items, done);
    },
    changePlan(){ saveCurrent(Object.assign({}, cur, { picks, set: false })); },
    newPlan(){ saveCurrent({ date: today, picks: [], done: [], set: false, combo: null }); },

    /* Past days: fix what actually happened, any time later */
    saveDayEdit(date, items, done){
      if (!items.length){ ctx.deleteDay(date); return; }
      saveDay(date, items, done);
      if (cur.set && cur.date === date) saveCurrent(Object.assign({}, cur, { items, done, picks: items.map(i => i.id).filter(id => index[id]) }));
    },
    deleteDay(date){
      const old = store.get('days/' + date);
      store.del('days/' + date);
      if (cur.set && cur.date === date) saveCurrent({ date: today, picks: [], done: [], set: false, combo: null });
      ctx.closeEdit();
      if (old) showToast('Deleted ' + fmtShort(date), { label: 'Undo', run: () => store.set('days/' + date, old) });
    },

    openDay: date => openEdit({ type: 'day', id: date }),
    openCat: id => openEdit({ type: 'cat', id }),
    openCombo: id => openEdit({ type: 'combo', id }),
    closeEdit: () => { setUi({ edit: null }); scrollTop(); },
    newCategory(){
      const used = new Set(cats.map(c => c.color));
      const color = (COLORS.find(x => !used.has(x[0])) || COLORS[0])[0];
      const id = uid();
      updateConfig(c => { c.categories.push({ id, name: '', color, icon: 'star', max: 1, required: false, activities: [] }); return c; });
      openEdit({ type: 'cat', id, isNew: true });
    },
    patchCat(id, patch){ updateConfig(c => { const k = c.categories.find(x => x.id === id); if (k) Object.assign(k, patch); return c; }); },
    moveCat(id, dir){
      updateConfig(c => {
        const i = c.categories.findIndex(x => x.id === id), j = i + dir;
        if (i < 0 || j < 0 || j >= c.categories.length) return c;
        const tmp = c.categories[i]; c.categories[i] = c.categories[j]; c.categories[j] = tmp; return c;
      });
    },
    deleteCat(id){
      const i = cats.findIndex(x => x.id === id); if (i < 0) return;
      const removed = clone(cats[i]);
      updateConfig(c => { c.categories = c.categories.filter(x => x.id !== id); return c; });
      if (ui.edit && ui.edit.id === id) setUi({ edit: null });
      showToast('Deleted “' + (removed.name || 'Untitled') + '”', { label: 'Undo', run: () => store.set('planner/config', (c => { c.categories.splice(Math.min(i, c.categories.length), 0, removed); return c; })(normConfig(store.get('planner/config')))) });
    },
    addActivity(catId, open){
      const id = uid();
      const lvl = tags[Math.min(1, tags.length - 1)] || '';
      updateConfig(c => { const k = c.categories.find(x => x.id === catId); if (k) k.activities.push({ id, name: '', energy: lvl, duration: '' }); return c; });
      setUi(open ? { focusAct: id, edit: { type: 'cat', id: catId } } : { focusAct: id });
      if (open) scrollTop();
    },
    patchAct(catId, actId, patch){
      updateConfig(c => { const k = c.categories.find(x => x.id === catId); const a = k && k.activities.find(x => x.id === actId); if (a) Object.assign(a, patch); return c; });
    },
    removeAct(catId, actId){
      const k = cats.find(x => x.id === catId); if (!k) return;
      const i = k.activities.findIndex(x => x.id === actId); if (i < 0) return;
      const removed = clone(k.activities[i]);
      updateConfig(c => { const kk = c.categories.find(x => x.id === catId); if (kk) kk.activities = kk.activities.filter(x => x.id !== actId); return c; });
      showToast('Deleted “' + (removed.name || 'Untitled') + '”', { label: 'Undo', run: () => store.set('planner/config', (c => { const kk = c.categories.find(x => x.id === catId); if (kk) kk.activities.splice(Math.min(i, kk.activities.length), 0, removed); return c; })(normConfig(store.get('planner/config')))) });
    },
    newCombo(){
      const id = uid();
      updateConfig(c => { c.combos.push({ id, name: '', picks: picks.slice() }); return c; });
      openEdit({ type: 'combo', id, isNew: true });
    },
    patchCombo(id, patch){ updateConfig(c => { const k = c.combos.find(x => x.id === id); if (k) Object.assign(k, patch); return c; }); },
    toggleComboAct(id, actId){
      updateConfig(c => { const k = c.combos.find(x => x.id === id); if (k) k.picks = k.picks.includes(actId) ? k.picks.filter(x => x !== actId) : k.picks.concat([actId]); return c; });
    },
    deleteCombo(id){
      const i = cfg.combos.findIndex(x => x.id === id); if (i < 0) return;
      const removed = clone(cfg.combos[i]);
      updateConfig(c => { c.combos = c.combos.filter(x => x.id !== id); return c; });
      if (ui.edit && ui.edit.id === id) setUi({ edit: null });
      showToast('Deleted “' + (removed.name || 'Untitled combo') + '”', { label: 'Undo', run: () => store.set('planner/config', (c => { c.combos.splice(Math.min(i, c.combos.length), 0, removed); return c; })(normConfig(store.get('planner/config')))) });
    },
    renameTag(oldName, raw){
      const name = raw.trim();
      if (!name || name === oldName || tags.includes(name)) return false;
      updateConfig(c => {
        c.energy = c.energy.map(t => t === oldName ? name : t);
        c.categories.forEach(k => k.activities.forEach(a => { if (a.energy === oldName) a.energy = name; }));
        return c;
      });
      if (energy === oldName) setUi({ energy: name });
      return true;
    },
    removeTag(name){
      if (tags.length <= 1) return;
      const i = tags.indexOf(name);
      const fallback = tags[i > 0 ? i - 1 : 1];
      updateConfig(c => {
        c.energy = c.energy.filter(t => t !== name);
        c.categories.forEach(k => k.activities.forEach(a => { if (a.energy === name) a.energy = fallback; }));
        return c;
      });
      if (energy === name) setUi({ energy: null });
    },
    addTag(){
      let n = 'New level', i = 2;
      while (tags.includes(n)) n = 'New level ' + i++;
      updateConfig(c => { c.energy.push(n); return c; });
    },
    moveTag(name, dir){
      updateConfig(c => {
        const i = c.energy.indexOf(name), j = i + dir;
        if (i < 0 || j < 0 || j >= c.energy.length) return c;
        const tmp = c.energy[i]; c.energy[i] = c.energy[j]; c.energy[j] = tmp; return c;
      });
    }
  };
  return ctx;
}

/* ---------- Planner tab ---------- */
const SUBS = [['plan', 'Plan'], ['activities', 'Activities'], ['history', 'History']];

export function PlannerTab({ ctx }){
  const { ui } = ctx;
  const e = ui.edit;
  if (e && e.type === 'cat') return html`<${CategoryEditor} ctx=${ctx} id=${e.id}/>`;
  if (e && e.type === 'combo') return html`<${ComboEditor} ctx=${ctx} id=${e.id}/>`;
  if (e && e.type === 'day') return html`<${DayEditor} key=${e.id} ctx=${ctx} date=${e.id}/>`;
  const sub = ui.sub || 'plan';
  return html`<div class="stack">
    <header class="head"><h1 class="grow">Planner</h1></header>
    <div class="seg" role="group" aria-label="Planner section">
      ${SUBS.map(s => html`<button key=${s[0]} aria-pressed=${String(sub === s[0])} onClick=${() => ctx.setSub(s[0])}>${s[1]}</button>`)}
    </div>
    ${sub === 'activities' ? html`<${ActivitiesView} ctx=${ctx}/>` : sub === 'history' ? html`<${HistoryView} ctx=${ctx}/>` : html`<${PlanTab} ctx=${ctx}/>`}
  </div>`;
}

function PlanTab({ ctx }){
  const { cur, today, weekCount } = ctx;
  return html`
    <div class="row-between">
      <span class="eyebrow">${cur.set ? 'Today’s plan' : 'What’s the plan today?'}</span>
      <span class="eyebrow">${weekCount === 0 ? 'First plan this week' : plural(weekCount, 'day', 'days') + ' planned this week'}</span>
    </div>
    ${cur.set ? html`<${PlanView} ctx=${ctx}/>` : html`<${Picker} ctx=${ctx}/>`}`;
}

function Picker({ ctx }){
  const { cfg, cats, tags, energy, cur } = ctx;
  return html`
    <section class="stack-sm">
      <div class="row-between"><h2 class="label">Quick combos</h2><button class="link" onClick=${() => ctx.setSub('activities')}>Edit</button></div>
      ${cfg.combos.length
        ? html`<div class="combos">${cfg.combos.map(co => html`<button key=${co.id} class="combo" aria-pressed=${String(cur.combo === co.id)} onClick=${() => ctx.applyCombo(co)}>${co.name || 'Untitled combo'}</button>`)}</div>`
        : html`<p class="hint">Save a set of activities as a combo, like “Chill day”, and load it with one tap.</p>`}
    </section>
    <section class="stack-sm">
      <h2 class="label">How’s your energy?</h2>
      <div class="energy-row">
        <div class="seg" role="group" aria-label="Energy filter">
          <button aria-pressed=${String(!energy)} onClick=${() => ctx.setEnergy(null)}>Any</button>
          ${tags.map(t => html`<button key=${t} aria-pressed=${String(energy === t)} onClick=${() => ctx.setEnergy(t)}>${t}</button>`)}
        </div>
        <button class="shuffle" onClick=${ctx.shuffle} aria-label="Surprise me"><${Ico} d=${UI.shuffle} sw=${2.6}/><span class="txt">Surprise me</span></button>
      </div>
    </section>
    ${cats.length === 0 && html`
      <section class="card">
        <h2 class="card-title">No categories yet</h2>
        <p class="hint">Categories hold the things you might do, like Entertainment or Health. Or import your Day Planner backup in Settings.</p>
        <button class="btn btn-solid sm" onClick=${ctx.newCategory}>Add your first category</button>
      </section>`}
    ${cats.map(c => html`<${CatCard} key=${c.id} ctx=${ctx} cat=${c}/>`)}
    ${cats.length > 0 && html`<button class="add-wide" onClick=${ctx.newCategory}>+ New category</button>`}
  `;
}

function CatCard({ ctx, cat }){
  const { picks, index } = ctx;
  const n = picks.filter(id => index[id].c.id === cat.id).length;
  const shown = cat.activities.filter(ctx.visible);
  const ip = iconPath(cat.icon);
  return html`<section class="card tint" style=${'--t:' + tint(cat.color)}>
    <div class="cat-head">
      <span class="badge"><${Ico} d=${ip}/></span>
      <div class="grow"><h2 class="cat-name">${cat.name || 'Untitled'}</h2><div class="cat-sub"><span class="count-inline">${n} of ${cat.max || '∞'} picked</span> · ${cat.required ? 'Required' : 'Optional'}</div></div>
      <button class="icon-btn" aria-label=${'Edit ' + (cat.name || 'category')} onClick=${() => ctx.openCat(cat.id)}><${Ico} d=${UI.pen} size=${18}/></button>
    </div>
    <div class="tiles">
      ${shown.map(a => {
        const on = picks.includes(a.id);
        return html`<button key=${a.id} class=${'tile' + (on ? ' on' : '')} aria-pressed=${String(on)} onClick=${() => ctx.togglePick(cat, a.id)}>
          <span class="tile-top"><${Ico} d=${ip}/>${on && html`<span class="check"><${Ico} d=${UI.check} size=${14} sw=${3.6}/></span>`}</span>
          <span class="tile-text"><span class="tile-name">${a.name || 'Untitled'}</span>${meta(a) && html`<span class="tile-meta">${meta(a)}</span>`}</span>
        </button>`;
      })}
      <button class="tile-add" onClick=${() => ctx.addActivity(cat.id, true)}><${Ico} d=${UI.plus} sw=${2.4}/>Add</button>
    </div>
    ${cat.activities.length > 0 && shown.length === 0 && html`<p class="hint">Nothing here fits that energy level.</p>`}
  </section>`;
}

export function PlanItems({ ctx, compact }){
  const { cur } = ctx;
  const items = cur.items || [], done = cur.done || [];
  return html`<div class=${compact ? 'mini-plan' : 'list'}>
    ${items.map(it => {
      const d = done.includes(it.id);
      return html`<button key=${it.id} class=${(compact ? 'mini-item' : 'plan-item') + ' tint' + (d ? ' done' : '')} style=${'--t:' + tint(it.color)} aria-pressed=${String(d)} onClick=${() => ctx.toggleDone(it.id)}>
        <span class=${'badge' + (compact ? ' sm' : '')}><${Ico} d=${iconPath(it.icon)} size=${compact ? 15 : 20} sw=${compact ? 2.6 : 2.2}/></span>
        <span class="grow col"><span class="plan-name">${it.name}</span>${!compact && html`<span class="plan-sub">${[it.catName, it.duration].filter(Boolean).join(' · ')}</span>`}</span>
        <span class="tick">${d && html`<${Ico} d=${UI.check} size=${16} sw=${3.4}/>`}</span>
      </button>`;
    })}
  </div>`;
}

function PlanView({ ctx }){
  const { cur, today } = ctx;
  const items = cur.items || [], done = cur.done || [];
  const n = items.filter(i => done.includes(i.id)).length;
  return html`
    ${cur.date !== today && html`
      <div class="banner">
        <span>This plan is from ${fmtShort(cur.date)}.</span>
        <button class="btn btn-solid sm" onClick=${ctx.newPlan}>Plan today</button>
      </div>`}
    <section class="card">
      <${PlanItems} ctx=${ctx}/>
      <p class="hint">${n === 0 ? 'Nothing ticked off yet, and that’s fine.' : n + ' of ' + items.length + ' done.'} It’s a loose plan, not a schedule.</p>
      <div class="btn-row">
        <button class="btn btn-ghost sm" onClick=${ctx.changePlan}>Change plan</button>
        <button class="btn btn-ghost sm" onClick=${ctx.newPlan}>Start over</button>
      </div>
    </section>
    <${WeekCard} ctx=${ctx}/>
  `;
}

/* ---------- History ---------- */
function weekStats(days, from, to){
  const m = new Map();
  days.filter(d => d.date >= from && d.date <= to).forEach(d => (d.items || []).forEach(it => {
    const e = m.get(it.catId) || { name: it.catName, color: it.color, n: 0 };
    e.n++; m.set(it.catId, e);
  }));
  return Array.from(m.values()).sort((a, b) => b.n - a.n);
}
function WeekCard({ ctx }){
  const stats = weekStats(ctx.days, weekStartKey(ctx.today), ctx.today);
  const max = Math.max(1, ...stats.map(s => s.n));
  return html`<section class="card">
    <div class="row-between"><h2 class="card-title">This week</h2><span class="cat-sub">${plural(ctx.weekCount, 'day', 'days')} planned</span></div>
    ${stats.length
      ? html`<div class="bars">${stats.map(s => html`
          <div key=${s.name} class="bar-row tint" style=${'--t:' + tint(s.color)}>
            <span class="bar-label">${s.name}</span>
            <span class="bar-track"><span class="bar-fill" style=${'width:' + Math.round(s.n / max * 100) + '%'}></span></span>
            <span class="bar-n">${s.n}</span>
          </div>`)}</div>`
      : html`<p class="hint">Your mix of activities for the week shows up here once you set a plan.</p>`}
  </section>`;
}
function relLabel(date, today){
  const y = Number(today.slice(0, 4)) - Number(date.slice(0, 4));
  if (date.slice(5) === today.slice(5) && y > 0) return y === 1 ? 'A year ago' : y + ' years ago';
  return 'A month ago';
}
function OnThisDay({ ctx }){
  const md = ctx.today.slice(5), lm = lastMonthKey(ctx.today);
  const list = ctx.days.filter(d => d.date !== ctx.today && (d.date.slice(5) === md || d.date === lm));
  if (!list.length) return null;
  return html`<section class="card">
    <h2 class="card-title">On this day</h2>
    ${list.map(d => html`<${DayEntry} key=${d.date} ctx=${ctx} day=${d} label=${relLabel(d.date, ctx.today)}/>`)}
  </section>`;
}
function DayEntry({ ctx, day, label }){
  const items = day.items || [], done = day.done || [];
  const n = items.filter(i => done.includes(i.id)).length;
  const past = day.date < ctx.today;
  return html`<div class="day">
    <div class="day-head">
      <span class="day-date">${fmtShort(day.date)}</span>
      <span class="cat-sub">${label || (n + ' of ' + items.length + ' done')}</span>
      <button class="day-edit" aria-label=${'Edit ' + fmtShort(day.date)} onClick=${() => ctx.openDay(day.date)}><${Ico} d=${UI.pen} size=${14}/>Edit</button>
    </div>
    <div class="chips">${items.map(it => {
      const d = done.includes(it.id);
      return html`<span key=${it.id} class=${'chip tint' + (past && !d ? ' skipped' : '')} style=${'--t:' + tint(it.color)}>
        ${d ? html`<${Ico} d=${UI.check} size=${13} sw=${3.4}/>` : html`<span class="dot"></span>`}${it.name}
      </span>`;
    })}</div>
  </div>`;
}
function HistoryView({ ctx }){
  const { days, today } = ctx;
  const month = today.slice(0, 7);
  const monthDays = days.filter(d => d.date.slice(0, 7) === month);
  const counts = {};
  monthDays.forEach(d => (d.items || []).forEach(it => { if ((d.done || []).includes(it.id)) counts[it.name] = (counts[it.name] || 0) + 1; }));
  const topName = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const groups = [];
  days.forEach(d => {
    const k = d.date.slice(0, 7);
    if (!groups.length || groups[groups.length - 1].key !== k) groups.push({ key: k, days: [] });
    groups[groups.length - 1].days.push(d);
  });
  return html`
    <p class="hint">Every plan you set is saved here. Ticked = done; crossed out = planned but skipped. Tap Edit to fix any day.</p>
    <${WeekCard} ctx=${ctx}/>
    <section class="card">
      <h2 class="card-title">This month</h2>
      <p class="hint">${monthDays.length
        ? plural(monthDays.length, 'day', 'days') + ' planned so far.' + (topName && counts[topName] > 1 ? ' Done most: ' + topName + ' (' + counts[topName] + ' times).' : '')
        : 'No plans yet this month.'}</p>
    </section>
    <${OnThisDay} ctx=${ctx}/>
    ${days.length === 0
      ? html`<section class="card"><p class="hint">Your first plan shows up here after you set it on the Plan tab.</p></section>`
      : groups.map(g => html`<section key=${g.key} class="card"><h2 class="month">${fmtMonth(g.key)}</h2>${g.days.map(d => html`<${DayEntry} key=${d.date} ctx=${ctx} day=${d}/>`)}</section>`)}
  `;
}

/* ---------- Edit a past day ---------- */
function DayEditor({ ctx, date }){
  const day = ctx.days.find(d => d.date === date);
  const [items, setItems] = useState(() => clone((day && day.items) || []));
  const [done, setDone] = useState(() => clone((day && day.done) || []));
  const [adding, setAdding] = useState(false);
  if (!day) return html`<div class="stack"><${EditorBar} title="Edit day" onDone=${ctx.closeEdit}/><section class="card"><p class="hint">This day was deleted.</p></section></div>`;
  const toggle = id => setDone(done.includes(id) ? done.filter(x => x !== id) : done.concat([id]));
  const remove = id => { setItems(items.filter(i => i.id !== id)); setDone(done.filter(x => x !== id)); };
  const add = (a, c) => { if (!items.some(i => i.id === a.id)) setItems(items.concat([ctx.itemFor(a, c)])); };
  const save = () => { ctx.saveDayEdit(date, items, done.filter(x => items.some(i => i.id === x))); ctx.closeEdit(); };
  return html`<div class="stack">
    <div class="topbar">
      <button class="link" onClick=${ctx.closeEdit}><${Ico} d=${UI.back} size=${18} sw=${2.6}/>Cancel</button>
      <h1>${fmtShort(date)}</h1>
      <button class="link" onClick=${save}>Save</button>
    </div>
    <p class="hint">Tick what you actually did. Untick anything you planned but skipped, so your history stays honest.</p>
    <section class="card">
      <div class="list">
        ${items.map(it => {
          const d = done.includes(it.id);
          return html`<div key=${it.id} class="plan-item tint" style=${'--t:' + tint(it.color)}>
            <button class=${'tick' + (d ? ' on' : '')} aria-pressed=${String(d)} aria-label=${(d ? 'Mark not done: ' : 'Mark done: ') + it.name} onClick=${() => toggle(it.id)}>${d && html`<${Ico} d=${UI.check} size=${16} sw=${3.4}/>`}</button>
            <span class="grow col"><span class="plan-name">${it.name}</span><span class="plan-sub">${d ? 'Done' : 'Skipped'} · ${it.catName}</span></span>
            <button class="icon-btn" aria-label=${'Remove ' + it.name} onClick=${() => remove(it.id)}><${Ico} d=${UI.x} size=${18}/></button>
          </div>`;
        })}
        ${items.length === 0 && html`<p class="hint">No activities. Saving like this deletes the day.</p>`}
      </div>
      ${adding
        ? html`<div class="stack-sm">
            ${ctx.cats.map(c => c.activities.length > 0 && html`<div key=${c.id} class="picker-group tint" style=${'--t:' + tint(c.color)}>
              <h3 class="label">${c.name || 'Untitled'}</h3>
              ${c.activities.filter(a => !items.some(i => i.id === a.id)).map(a => html`
                <button key=${a.id} class="add-pick" onClick=${() => add(a, c)}><span class="badge sm"><${Ico} d=${iconPath(c.icon)} size=${15} sw=${2.6}/></span><span class="grow">${a.name || 'Untitled'}</span><${Ico} d=${UI.plus} size=${18}/></button>`)}
            </div>`)}
            <button class="btn btn-ghost sm" onClick=${() => setAdding(false)}>Done adding</button>
          </div>`
        : html`<button class="add-wide sm" onClick=${() => setAdding(true)}>+ Add something I did</button>`}
    </section>
    <button class="btn btn-solid wide" onClick=${save}>Save changes</button>
    <button class="btn btn-danger wide" onClick=${() => ctx.deleteDay(date)}>Delete this day</button>
  </div>`;
}

/* ---------- Activities (manage) ---------- */
function TagChip({ ctx, name, index, count }){
  const [v, setV] = useState(name);
  useEffect(() => setV(name), [name]);
  const commit = () => { if (!ctx.renameTag(name, v)) setV(name); };
  return html`<span class="tag">
    <input id=${'tag-' + index} aria-label=${'Energy level ' + (index + 1)} value=${v} onInput=${e => setV(e.target.value)} onBlur=${commit}
      onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape'){ setV(name); } }}/>
    <button class="icon-btn" aria-label=${'Move ' + name + ' lower'} disabled=${index === 0} onClick=${() => ctx.moveTag(name, -1)}><${Ico} d=${UI.back} size=${16}/></button>
    <button class="icon-btn" aria-label=${'Remove ' + name} disabled=${count <= 1} onClick=${() => ctx.removeTag(name)}><${Ico} d=${UI.x} size=${16}/></button>
  </span>`;
}
function ActivitiesView({ ctx }){
  const [reorder, setReorder] = useState(false);
  const { cats, cfg, index } = ctx;
  const comboList = co => { const names = co.picks.filter(id => index[id]).map(id => index[id].a.name || 'Untitled'); return names.length ? names.join(' · ') : 'No activities yet'; };
  return html`
    <section class="stack-sm">
      <div class="row-between"><h2 class="label">Categories</h2>${cats.length > 1 && html`<button class="link" onClick=${() => setReorder(!reorder)}>${reorder ? 'Done' : 'Reorder'}</button>`}</div>
      <div class="list">
        ${cats.map((c, i) => html`<div key=${c.id} class="row tint" style=${'--t:' + tint(c.color)}>
          <button class="row-main" onClick=${() => ctx.openCat(c.id)}>
            <span class="badge"><${Ico} d=${iconPath(c.icon)}/></span>
            <span class="col grow"><span class="row-title">${c.name || 'Untitled'}</span><span class="row-sub">${plural(c.activities.length, 'activity', 'activities')} · ${catSub(c).toLowerCase()}</span></span>
          </button>
          ${reorder
            ? html`<button class="icon-btn" aria-label=${'Move ' + (c.name || 'category') + ' up'} disabled=${i === 0} onClick=${() => ctx.moveCat(c.id, -1)}><${Ico} d=${UI.up}/></button>
                   <button class="icon-btn" aria-label=${'Move ' + (c.name || 'category') + ' down'} disabled=${i === cats.length - 1} onClick=${() => ctx.moveCat(c.id, 1)}><${Ico} d=${UI.down}/></button>`
            : html`<button class="icon-btn danger" aria-label=${'Delete ' + (c.name || 'category')} onClick=${() => ctx.deleteCat(c.id)}><${Ico} d=${UI.trash} size=${18}/></button>`}
        </div>`)}
        ${cats.length === 0 && html`<p class="hint">No categories yet.</p>`}
        <button class="add-wide" onClick=${ctx.newCategory}>+ New category</button>
      </div>
    </section>
    <section class="stack-sm">
      <h2 class="label">Combos</h2>
      <div class="list">
        ${cfg.combos.map(co => html`<div key=${co.id} class="row">
          <button class="row-main" onClick=${() => ctx.openCombo(co.id)}>
            <span class="col grow"><span class="row-title">${co.name || 'Untitled combo'}</span><span class="row-sub">${comboList(co)}</span></span>
          </button>
          <button class="icon-btn danger" aria-label=${'Delete ' + (co.name || 'combo')} onClick=${() => ctx.deleteCombo(co.id)}><${Ico} d=${UI.trash} size=${18}/></button>
        </div>`)}
        <button class="add-wide" onClick=${ctx.newCombo}>+ New combo</button>
      </div>
      <p class="hint">A new combo starts with whatever you’ve picked on Plan.</p>
    </section>
    <section class="stack-sm">
      <h2 class="label">Energy levels</h2>
      <div class="tags">
        ${cfg.energy.map((t, i) => html`<${TagChip} key=${t} ctx=${ctx} name=${t} index=${i} count=${cfg.energy.length}/>`)}
        <button class="tag-add" onClick=${ctx.addTag}>+ Add level</button>
      </div>
      <p class="hint">Lowest energy first. Tap a name to rename it. Choosing a level on Plan shows activities at that level or lower.</p>
    </section>`;
}

/* ---------- Editors ---------- */
function EditorBar({ title, onDone }){
  return html`<div class="topbar">
    <button class="link" onClick=${onDone}><${Ico} d=${UI.back} size=${18} sw=${2.6}/>Back</button>
    <h1>${title}</h1>
    <button class="link" onClick=${onDone}>Done</button>
  </div>`;
}
function ActRow({ ctx, cat, act }){
  const ref = useRef(null);
  useEffect(() => { if (ctx.ui.focusAct === act.id && ref.current){ ref.current.focus(); } }, [ctx.ui.focusAct]);
  const p = patch => ctx.patchAct(cat.id, act.id, patch);
  const known = ctx.tags.includes(act.energy);
  return html`<div class="act">
    <div class="act-line">
      <input ref=${ref} id=${'name-' + act.id} class="act-name" aria-label="Activity name" placeholder="Activity name" autocomplete="off" value=${act.name} onInput=${e => p({ name: e.target.value })}/>
      <button class="icon-btn" aria-label=${'Delete ' + (act.name || 'activity')} onClick=${() => ctx.removeAct(cat.id, act.id)}><${Ico} d=${UI.trash} size=${18}/></button>
    </div>
    <div class="act-line">
      <select id=${'energy-' + act.id} class="act-energy" aria-label="Energy needed" value=${known ? act.energy : ''} onChange=${e => p({ energy: e.target.value })}>
        ${!known && html`<option value="">No level</option>`}
        ${ctx.tags.map(t => html`<option key=${t} value=${t}>${t}</option>`)}
      </select>
      <input id=${'dur-' + act.id} class="act-dur" aria-label="How long it takes" placeholder="How long, e.g. 30 min" autocomplete="off" value=${act.duration} onInput=${e => p({ duration: e.target.value })}/>
    </div>
  </div>`;
}
function CategoryEditor({ ctx, id }){
  const cat = ctx.cats.find(c => c.id === id);
  const nameRef = useRef(null);
  useEffect(() => { if (ctx.ui.edit && ctx.ui.edit.isNew && nameRef.current) nameRef.current.focus(); }, []);
  if (!cat) return html`<div class="stack"><${EditorBar} title="Category" onDone=${ctx.closeEdit}/><section class="card"><p class="hint">This category was deleted.</p></section></div>`;
  const p = patch => ctx.patchCat(id, patch);
  const i = ctx.cats.indexOf(cat);
  const ip = iconPath(cat.icon);
  return html`<div class="stack tint" style=${'--t:' + tint(cat.color)}>
    <${EditorBar} title=${ctx.ui.edit && ctx.ui.edit.isNew ? 'New category' : 'Edit category'} onDone=${ctx.closeEdit}/>
    <section class="card" aria-label="Preview">
      <div class="cat-head">
        <span class="badge"><${Ico} d=${ip}/></span>
        <div class="grow"><div class="cat-name">${cat.name || 'Untitled'}</div><div class="cat-sub">${catSub(cat)}</div></div>
        <span class="cat-sub">Preview</span>
      </div>
      <div class="tiles" aria-hidden="true">
        <div class="tile on"><span class="tile-top"><${Ico} d=${ip}/><span class="check"><${Ico} d=${UI.check} size=${14} sw=${3.6}/></span></span><span class="tile-name">Picked</span></div>
        <div class="tile"><span class="tile-top"><${Ico} d=${ip}/></span><span class="tile-name">Not picked</span></div>
      </div>
    </section>
    <div class="field">
      <label class="label" for="cat-name">Name</label>
      <input id="cat-name" ref=${nameRef} class="input" placeholder="e.g. Social" autocomplete="off" value=${cat.name} onInput=${e => p({ name: e.target.value })}/>
    </div>
    <div class="field">
      <h2 class="label">Color</h2>
      <div class="swatches" role="group" aria-label="Color">
        ${COLORS.map(c => html`<button key=${c[0]} class="swatch" style=${'--sw:' + c[2]} aria-label=${c[1]} aria-pressed=${String(cat.color === c[0])} onClick=${() => p({ color: c[0] })}></button>`)}
      </div>
    </div>
    <div class="field">
      <h2 class="label">Icon</h2>
      <div class="icons" role="group" aria-label="Icon">
        ${ICONS.map(ic => html`<button key=${ic[0]} class="iconpick" aria-label=${ic[1]} aria-pressed=${String(cat.icon === ic[0])} onClick=${() => p({ icon: ic[0] })}><${Ico} d=${ic[2]} size=${22}/></button>`)}
      </div>
    </div>
    <div class="field">
      <h2 class="label">How many can I pick per day?</h2>
      <div class="stepper">
        <button class="step-btn" aria-label="Fewer" disabled=${cat.max === 1} onClick=${() => p({ max: cat.max === 0 ? 5 : Math.max(1, cat.max - 1) })}>−</button>
        <span class="val" aria-live="polite">${cat.max === 0 ? 'Any' : cat.max}</span>
        <button class="step-btn" aria-label="More" disabled=${cat.max === 0} onClick=${() => p({ max: Math.min(99, cat.max + 1) })}>+</button>
        <button class="chip-toggle push" aria-pressed=${String(cat.max === 0)} onClick=${() => p({ max: cat.max === 0 ? 1 : 0 })}>No limit</button>
      </div>
    </div>
    <button class="switch-row" aria-pressed=${String(!!cat.required)} onClick=${() => p({ required: !cat.required })}>
      <span class="col grow"><span class="row-title">Always required</span><span class="row-sub wrap">Remind me if I set a plan without picking from here</span></span>
      <span class=${'switch' + (cat.required ? ' on' : '')}><span class="knob"></span></span>
    </button>
    <div class="field">
      <h2 class="label">Activities</h2>
      <div class="acts">
        ${cat.activities.map(a => html`<${ActRow} key=${a.id} ctx=${ctx} cat=${cat} act=${a}/>`)}
        <button class="act-add" onClick=${() => ctx.addActivity(id, false)}>+ Add activity</button>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-ghost sm" disabled=${i === 0} onClick=${() => ctx.moveCat(id, -1)}>Move up</button>
      <button class="btn btn-ghost sm" disabled=${i === ctx.cats.length - 1} onClick=${() => ctx.moveCat(id, 1)}>Move down</button>
    </div>
    <button class="btn btn-danger" onClick=${() => ctx.deleteCat(id)}>Delete category</button>
  </div>`;
}
function ComboEditor({ ctx, id }){
  const co = ctx.cfg.combos.find(c => c.id === id);
  const nameRef = useRef(null);
  useEffect(() => { if (ctx.ui.edit && ctx.ui.edit.isNew && nameRef.current) nameRef.current.focus(); }, []);
  if (!co) return html`<div class="stack"><${EditorBar} title="Combo" onDone=${ctx.closeEdit}/><section class="card"><p class="hint">This combo was deleted.</p></section></div>`;
  const count = co.picks.filter(x => ctx.index[x]).length;
  return html`<div class="stack">
    <${EditorBar} title=${ctx.ui.edit && ctx.ui.edit.isNew ? 'New combo' : 'Edit combo'} onDone=${ctx.closeEdit}/>
    <div class="field">
      <label class="label" for="combo-name">Name</label>
      <input id="combo-name" ref=${nameRef} class="input" placeholder="e.g. Chill day" autocomplete="off" value=${co.name} onInput=${e => ctx.patchCombo(id, { name: e.target.value })}/>
    </div>
    <p class="hint">Tap what this combo should pick. ${plural(count, 'activity', 'activities')} selected.</p>
    ${ctx.cats.map(c => c.activities.length > 0 && html`
      <section key=${c.id} class="card tint" style=${'--t:' + tint(c.color)}>
        <div class="cat-head"><span class="badge"><${Ico} d=${iconPath(c.icon)}/></span><h2 class="cat-name grow">${c.name || 'Untitled'}</h2></div>
        <div class="tiles">
          ${c.activities.map(a => {
            const on = co.picks.includes(a.id);
            return html`<button key=${a.id} class=${'tile' + (on ? ' on' : '')} aria-pressed=${String(on)} onClick=${() => ctx.toggleComboAct(id, a.id)}>
              <span class="tile-top"><${Ico} d=${iconPath(c.icon)}/>${on && html`<span class="check"><${Ico} d=${UI.check} size=${14} sw=${3.6}/></span>`}</span>
              <span class="tile-text"><span class="tile-name">${a.name || 'Untitled'}</span>${meta(a) && html`<span class="tile-meta">${meta(a)}</span>`}</span>
            </button>`;
          })}
        </div>
      </section>`)}
    <button class="btn btn-danger" onClick=${() => ctx.deleteCombo(id)}>Delete combo</button>
  </div>`;
}

/* Required-category sheet, shown by the shell */
export function RequiredSheet({ ctx, sheet, close }){
  return html`<div class="scrim" onClick=${e => { if (e.target === e.currentTarget) close(); }}>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <h2 id="sheet-title">Set the plan anyway?</h2>
      <p class="hint">You haven’t picked anything from ${joinNames(sheet.missing)} yet. That’s okay if today isn’t the day for it.</p>
      <div class="sheet-actions">
        <button class="btn btn-ghost sm" onClick=${close}>Pick something</button>
        <button class="btn btn-solid sm" onClick=${() => ctx.setPlan(true)}>Set anyway</button>
      </div>
    </div>
  </div>`;
}
