/* Diet: food library (per 100 g), lookups (USDA → barcode via Open Food Facts → AI estimate), meal builder.
   Docs: foods/<id> = { id, name, brand, state: raw|cooked|'', kcal, p, c, fat (per 100 g), source, ref, barcode }
         meals/<id> = { id, name, tag, items: [{ id, foodId, g }] }
   Meals only point at foods, so editing a food changes every meal that uses it. */
import { html, useState, useEffect, useRef, Ico, UI, uid, clone, plural, scrollTop, dayKey, parseKey, fmtShort } from './lib.js';
import { store, deviceGet } from './store.js';

/* ---------- Math ---------- */
export const ZERO = { kcal: 0, p: 0, c: 0, fat: 0 };
export const scale = (food, g) => { const k = (Number(g) || 0) / 100; return { kcal: food.kcal * k, p: food.p * k, c: food.c * k, fat: food.fat * k }; };
export const addUp = list => list.reduce((a, m) => ({ kcal: a.kcal + m.kcal, p: a.p + m.p, c: a.c + m.c, fat: a.fat + m.fat }), ZERO);
export const fromMacros = m => 4 * m.p + 4 * m.c + 9 * m.fat;
export function kcalCheck(m){
  const est = fromMacros(m);
  if (m.kcal <= 0 && est <= 0) return null;
  return Math.abs(m.kcal - est) > Math.max(25, 0.15 * Math.max(m.kcal, est)) ? Math.round(est) : null;
}
export const foodMap = () => Object.fromEntries(store.list('foods/').map(f => [f.id, f]));
export const mealTotals = (meal, foods) => addUp(meal.items.map(it => foods[it.foodId] ? scale(foods[it.foodId], it.g) : ZERO));
export const g1 = n => String(Math.round(n * 10) / 10);
export const kc = n => String(Math.round(n));
const num = s => { const v = parseFloat(String(s == null ? '' : s).replace(',', '.')); return isFinite(v) && v >= 0 ? v : null; };
const macroLine = m => 'P ' + g1(m.p) + ' · C ' + g1(m.c) + ' · F ' + g1(m.fat);
const fullLine = m => kc(m.kcal) + ' kcal · ' + macroLine(m);

export const MEAL_TAGS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack']];
const STATES = [['raw', 'Raw'], ['cooked', 'Cooked'], ['', 'Neither']];
const SOURCES = { usda: 'USDA', off: 'Barcode', ai: 'Estimate', manual: 'Mine' };
const guessState = s => /\b(cooked|boiled|roasted|baked|grilled|fried|steamed|braised|stewed|broiled|microwaved|poached)\b/i.test(s) ? 'cooked'
  : /\b(raw|dry|uncooked)\b/i.test(s) ? 'raw' : '';

/* ---------- Lookups ---------- */
async function usdaSearch(q){
  const key = deviceGet().usdaKey || 'DEMO_KEY';
  const run = async all => {
    const res = await fetch('https://api.nal.usda.gov/fdc/v1/foods/search?query=' + encodeURIComponent(q) + '&dataType=Foundation,SR%20Legacy&pageSize=20' + (all ? '&requireAllWords=true' : ''),
      { headers: { 'X-Api-Key': key } });
    if (res.status === 429) throw new Error(deviceGet().usdaKey ? 'USDA says too many lookups. Try again in a few minutes.' : 'The shared USDA key is used up for now. Add your own free key in Settings → API keys.');
    if (res.status === 403) throw new Error('USDA didn’t accept the key. Check it in Settings → API keys.');
    if (!res.ok) throw new Error('USDA didn’t answer (' + res.status + '). Try again.');
    return (await res.json()).foods || [];
  };
  let foods = await run(true);
  if (foods.length < 3) foods = foods.concat((await run(false)).filter(f => !foods.some(x => x.fdcId === f.fdcId)));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return foods.map(f => {
    const n = id => { const x = (f.foodNutrients || []).find(v => v.nutrientId === id); return x ? x.value : null; };
    const p = n(1003) || 0, c = n(1005) || 0, fat = n(1004) || 0;
    let kcal = n(1008); if (kcal == null) kcal = n(2047); if (kcal == null) kcal = n(2048); if (kcal == null) kcal = fromMacros({ p, c, fat });
    const name = f.description || 'Unnamed';
    const first = name.toLowerCase().split(',')[0];
    const score = (words.every(w => first.includes(w)) ? 2 : 0) + (f.dataType === 'Foundation' ? 1 : 0) - name.length / 200;
    return { name, brand: '', state: guessState(name), kcal, p, c, fat, source: 'usda', ref: 'fdc:' + f.fdcId, score };
  }).sort((a, b) => b.score - a.score).slice(0, 12);
}

async function barcodeLookup(code){
  const res = await fetch('https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) + '.json?fields=product_name,product_name_en,brands,nutriments');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('The barcode database didn’t answer. Try again.');
  const j = await res.json();
  if (!j || j.status !== 1 || !j.product) return null;
  const pr = j.product, n = pr.nutriments || {};
  const v = k => { const x = num(n[k]); return x == null ? null : x; };
  const p = v('proteins_100g') || 0, c = v('carbohydrates_100g') || 0, fat = v('fat_100g') || 0;
  let kcal = v('energy-kcal_100g');
  if (kcal == null && v('energy_100g') != null) kcal = v('energy_100g') / 4.184;
  const name = (pr.product_name || pr.product_name_en || '').trim() || 'Product ' + code;
  return { name, brand: (pr.brands || '').split(',')[0].trim(), state: guessState(name), kcal: kcal == null ? fromMacros({ p, c, fat }) : kcal, p, c, fat,
    source: 'off', ref: 'off:' + code, barcode: code, incomplete: kcal == null && !p && !c && !fat };
}

async function aiEstimate(q){
  const key = deviceGet().claudeKey;
  if (!key) throw new Error('Add your Claude key in Settings → API keys to get estimates.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 300, messages: [{ role: 'user', content:
      'Estimate typical nutrition values per 100 g for this food: "' + q + '". Use standard reference values (USDA-style). ' +
      'If it could be raw or cooked and the text does not say, assume how it is usually weighed. ' +
      'Reply with only JSON: {"name": short food name, "state": "raw"|"cooked"|"", "kcal": number, "protein": number, "carbs": number, "fat": number}' }] })
  });
  if (res.status === 401) throw new Error('Claude didn’t accept the key. Check it in Settings.');
  if (!res.ok) throw new Error('Claude didn’t answer (' + res.status + '). Try again.');
  const j = await res.json();
  const text = ((j.content || []).find(b => b.type === 'text') || {}).text || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('The estimate came back unreadable. Try again.');
  const e = JSON.parse(m[0]);
  const p = num(e.protein) || 0, c = num(e.carbs) || 0, fat = num(e.fat) || 0;
  return { name: e.name || q, brand: '', state: ['raw', 'cooked'].includes(e.state) ? e.state : '', kcal: num(e.kcal) == null ? fromMacros({ p, c, fat }) : num(e.kcal), p, c, fat, source: 'ai', ref: 'ai' };
}

/* ---------- Diet tab ---------- */
const SUBS = [['log', 'Log'], ['meals', 'Meals'], ['foods', 'Foods'], ['weight', 'Weight']];

export function DietTab({ app, ui, setUi }){
  const sub = ui.dsub || 'log';
  const e = ui.dedit;
  const close = () => { setUi({ dedit: null }); scrollTop(); };
  const open = x => { setUi({ dedit: x }); scrollTop(); };
  const env = { app, open, close };
  if (e && e.type === 'meal') return html`<${MealEditor} key=${e.id || 'new'} env=${env} id=${e.id}/>`;
  if (e && e.type === 'food') return html`<${FoodEditor} key=${e.id} env=${env} id=${e.id}/>`;
  if (e && e.type === 'find') return html`<div class="stack">
    <div class="topbar"><button class="link" onClick=${close}><${Ico} d=${UI.back} size=${18} sw=${2.6}/>Foods</button><h1>Add food</h1><span></span></div>
    <${FoodFinder} env=${env} initialQ=${e.q || ''} initialCode=${e.code} onPick=${f => { close(); app.showToast(f.name + ' saved to your foods.'); }}/>
  </div>`;
  return html`<div class="stack">
    <header class="head"><h1 class="grow">Diet</h1></header>
    <div class="seg" role="group" aria-label="Diet section">
      ${SUBS.map(s => html`<button key=${s[0]} aria-pressed=${String(sub === s[0])} onClick=${() => { setUi({ dsub: s[0], dedit: null }); scrollTop(); }}>${s[1]}</button>`)}
    </div>
    ${sub === 'foods' ? html`<${FoodsView} env=${env}/>` : sub === 'meals' ? html`<${MealsView} env=${env}/>` : sub === 'weight' ? html`<${WeightView} env=${env}/>` : html`<${LogView} env=${env} ui=${ui} setUi=${setUi}/>`}
  </div>`;
}

/* ---------- Foods ---------- */
function FoodsView({ env }){
  const [q, setQ] = useState('');
  const [scan, setScan] = useState(false);
  const foods = store.list('foods/').sort((a, b) => a.name.localeCompare(b.name));
  const ql = q.trim().toLowerCase();
  const shown = ql ? foods.filter(f => (f.name + ' ' + (f.brand || '')).toLowerCase().includes(ql)) : foods;
  return html`
    <${SearchBox} value=${q} onInput=${setQ} placeholder="Search your foods" onScan=${() => setScan(true)} onEnter=${() => { if (ql && !shown.length) env.open({ type: 'find', q }); }}/>
    <div class="list">
      ${shown.map(f => html`<${FoodRow} key=${f.id} food=${f} onClick=${() => env.open({ type: 'food', id: f.id })}/>`)}
      ${foods.length === 0 && html`<section class="card"><h2 class="card-title">Your food library is empty</h2><p class="hint">Add foods once, with values per 100 g. Search a name and the app looks it up in the USDA database, or scan a barcode.</p></section>`}
      ${foods.length > 0 && ql && shown.length === 0 && html`<p class="hint">Not in your foods yet.</p>`}
    </div>
    <button class="btn btn-pop" onClick=${() => env.open({ type: 'find', q })}>${ql && !shown.length ? '+ Look up “' + q.trim() + '”' : '+ Add food'}</button>
    ${scan && html`<${Scanner} close=${() => setScan(false)} onCode=${code => { setScan(false); env.open({ type: 'find', q: '', code }); }}/>`}`;
}

function FoodRow({ food, onClick, right }){
  return html`<div class="row food-row">
    <button class="row-main" onClick=${onClick}>
      <span class="col grow">
        <span class="row-title">${food.name}${food.brand && !food.name.toLowerCase().includes(food.brand.toLowerCase()) ? html` <span class="brand">${food.brand}</span>` : ''}</span>
        <span class="row-sub">${kc(food.kcal)} kcal · ${macroLine(food)} <span class="per">/100 g</span></span>
      </span>
      ${food.state && html`<span class="pill">${food.state}</span>`}
      ${food.source === 'ai' && html`<span class="src src-ai">Estimate</span>`}
    </button>
    ${right}
  </div>`;
}

function SearchBox({ value, onInput, placeholder, onScan, onEnter, id = 'food-q', autoFocus }){
  const ref = useRef(null);
  useEffect(() => { if (autoFocus && ref.current && matchMedia('(min-width:960px)').matches) ref.current.focus(); }, []);
  return html`<div class="search">
    <${Ico} d=${UI.search} size=${18}/>
    <input ref=${ref} id=${id} type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label=${placeholder} placeholder=${placeholder} value=${value}
      onInput=${e => onInput(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter'){ e.preventDefault(); onEnter && onEnter(); } }}/>
    ${onScan && html`<button class="scan-btn" aria-label="Scan a barcode" onClick=${onScan}><${Ico} d=${UI.barcode} size=${20}/></button>`}
  </div>`;
}

/* Look a food up and save it to the library. Library matches come first when picking for a meal. */
function FoodFinder({ env, initialQ = '', initialCode, withLibrary, onPick }){
  const [q, setQ] = useState(initialQ);
  const [online, setOnline] = useState({ state: 'idle', items: [], err: '', for: '' });
  const [draft, setDraft] = useState(null);
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const hasClaude = !!deviceGet().claudeKey;

  const search = async () => {
    const t = q.trim(); if (!t) return;
    setMsg(''); setOnline({ state: 'loading', items: [], err: '', for: t });
    try { setOnline({ state: 'done', items: await usdaSearch(t), err: '', for: t }); }
    catch (e){ setOnline({ state: 'error', items: [], err: navigator.onLine === false ? 'You’re offline. Type the values yourself, or try again later.' : e.message, for: t }); }
  };
  const byCode = async c => {
    setScan(false); setMsg(''); setBusy('Looking up barcode ' + c + '…');
    try {
      const known = store.list('foods/').find(f => f.barcode === c);
      if (known){ setBusy(''); if (withLibrary){ onPick(known); return; } setMsg(known.name + ' is already in your foods.'); return; }
      const f = await barcodeLookup(c);
      setBusy('');
      if (!f){ setMsg('Barcode ' + c + ' isn’t in the database. Search by name or type the label values.'); setDraft(null); return; }
      if (f.incomplete) setMsg('The database has this product but no nutrition values. Copy them from the label.');
      setDraft(f);
    } catch (e){ setBusy(''); setMsg(e.message); }
  };
  const estimate = async () => {
    const t = q.trim(); if (!t) return;
    setMsg(''); setBusy('Estimating…');
    try { setDraft(await aiEstimate(t)); } catch (e){ setMsg(e.message); }
    finally { setBusy(''); }
  };
  useEffect(() => { if (initialCode) byCode(initialCode); else if (initialQ.trim() && !withLibrary) search(); }, []);

  if (draft) return html`<${FoodForm} initial=${draft} saveLabel=${withLibrary ? 'Save and add' : 'Save food'} onCancel=${() => setDraft(null)}
    onSave=${f => { const id = uid(); const food = Object.assign({}, f, { id, createdAt: Date.now() }); store.set('foods/' + id, food); onPick(food); }}/>`;

  const ql = q.trim().toLowerCase();
  const lib = withLibrary ? store.list('foods/').filter(f => !ql || (f.name + ' ' + (f.brand || '')).toLowerCase().includes(ql)).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const searched = online.state !== 'idle' && online.for === q.trim();
  return html`<div class="stack-sm">
    <${SearchBox} id="find-q" value=${q} onInput=${v => { setQ(v); setMsg(''); }} placeholder=${withLibrary ? 'Search your foods or look up' : 'Food name, like “rolled oats”'} autoFocus=${true}
      onScan=${() => setScan(true)} onEnter=${search}/>
    ${withLibrary && html`<div class="list">
      ${lib.slice(0, ql ? 30 : 60).map(f => html`<${FoodRow} key=${f.id} food=${f} onClick=${() => onPick(f)}/>`)}
      ${lib.length === 0 && html`<p class="hint">${ql ? 'Not in your foods yet. Look it up below.' : 'No foods saved yet. Type a name to look it up.'}</p>`}
    </div>`}
    ${q.trim() && !searched && html`<button class="btn btn-solid sm" onClick=${search}><${Ico} d=${UI.search} size=${16}/>Look up “${q.trim()}” in USDA</button>`}
    ${busy && html`<p class="status off">${busy}</p>`}
    ${msg && html`<p class="status bad">${msg}</p>`}
    ${searched && html`<section class="stack-sm">
      <h2 class="label">From the USDA database</h2>
      ${online.state === 'loading' && html`<p class="status off">Searching USDA…</p>`}
      ${online.state === 'error' && html`<p class="status bad">${online.err}</p>`}
      ${online.state === 'done' && online.items.length === 0 && html`<p class="hint">USDA has nothing for “${online.for}”. Try a simpler word, scan the barcode, or use an estimate.</p>`}
      <div class="list">
        ${online.items.map((f, i) => html`<div key=${i} class="row food-row">
          <button class="row-main" onClick=${() => setDraft(f)}>
            <span class="col grow"><span class="row-title">${f.name}</span><span class="row-sub">${kc(f.kcal)} kcal · ${macroLine(f)} <span class="per">/100 g</span></span></span>
            <span class="src src-usda">USDA</span>
          </button>
        </div>`)}
      </div>
    </section>`}
    ${q.trim() && html`<div class="list">
      ${hasClaude
        ? html`<button class="row-btn" disabled=${!!busy} onClick=${estimate}><span class="grow">Not listed? Estimate “${q.trim()}”</span><span class="src src-ai">Estimate</span></button>`
        : searched && html`<p class="hint">Add a Claude key in Settings to get an estimate when a food isn’t listed.</p>`}
    </div>`}
    <button class="row-btn" onClick=${() => setDraft({ name: q.trim(), brand: '', state: '', kcal: '', p: '', c: '', fat: '', source: 'manual', ref: '' })}><span class="grow">Type the values myself</span><${Ico} d=${UI.pen} size=${16}/></button>
    ${scan && html`<${Scanner} close=${() => setScan(false)} onCode=${byCode}/>`}
  </div>`;
}

/* Edit or confirm a food. Label values can be per 100 g or per serving; the app converts. */
function FoodForm({ initial, onSave, onCancel, saveLabel, extra }){
  const str = v => v === '' || v == null ? '' : g1(Number(v));
  const [f, setF] = useState(() => ({ name: initial.name || '', brand: initial.brand || '', state: initial.state || '', kcal: initial.kcal === '' ? '' : String(Math.round(initial.kcal || 0)), p: str(initial.p), c: str(initial.c), fat: str(initial.fat) }));
  const [per, setPer] = useState('100');
  const [serving, setServing] = useState('');
  const [err, setErr] = useState('');
  const set = (k, v) => { setF(prev => Object.assign({}, prev, { [k]: v })); setErr(''); };
  const factor = per === '100' ? 1 : 100 / (num(serving) || NaN);
  const vals = { p: (num(f.p) || 0) * factor, c: (num(f.c) || 0) * factor, fat: (num(f.fat) || 0) * factor };
  vals.kcal = num(f.kcal) == null ? fromMacros(vals) : num(f.kcal) * factor;
  const ok = isFinite(factor);
  const off = ok ? kcalCheck(vals) : null;
  const save = () => {
    if (!f.name.trim()){ setErr('Give the food a name.'); return; }
    if (!ok){ setErr('Enter the serving size in grams.'); return; }
    if ([f.p, f.c, f.fat].some(v => v !== '' && num(v) == null) || (f.kcal !== '' && num(f.kcal) == null)){ setErr('Use numbers only, like 12.5.'); return; }
    if (vals.p + vals.c + vals.fat > 100.5){ setErr('Protein, carbs and fat add up to more than 100 g per 100 g. Check the numbers.'); return; }
    onSave({ name: f.name.trim(), brand: f.brand.trim(), state: f.state, kcal: Math.round(vals.kcal * 10) / 10, p: Math.round(vals.p * 10) / 10, c: Math.round(vals.c * 10) / 10, fat: Math.round(vals.fat * 10) / 10,
      source: initial.source || 'manual', ref: initial.ref || '', barcode: initial.barcode || '' });
  };
  const box = (k, label, unit) => html`<label class="mfield"><span class="label">${label}</span><span class="mbox"><input inputmode="decimal" autocomplete="off" placeholder=${k === 'kcal' ? 'auto' : '0'} value=${f[k]} onInput=${e => set(k, e.target.value)}/><span class="unit">${unit}</span></span></label>`;
  return html`<div class="stack-sm">
    ${initial.source && initial.source !== 'manual' && html`<p class="source-note">
      <span class=${'src src-' + initial.source}>${SOURCES[initial.source]}</span>
      ${initial.source === 'usda' ? 'Values from the USDA FoodData Central database.' : initial.source === 'off' ? 'Values from Open Food Facts (barcode ' + initial.barcode + '). Check them against the label.' : 'A Claude estimate, not measured data. Replace it with label values when you can.'}
    </p>`}
    <section class="card">
      <div class="field"><label class="label" for="food-name">Name</label><input id="food-name" class="input inset" value=${f.name} onInput=${e => set('name', e.target.value)}/></div>
      <div class="field"><label class="label" for="food-brand">Brand (optional)</label><input id="food-brand" class="input inset" value=${f.brand} onInput=${e => set('brand', e.target.value)}/></div>
      <div class="field"><span class="label">Weighed</span>
        <div class="seg inset" role="group" aria-label="Weighed raw or cooked">${STATES.map(s => html`<button key=${s[0]} aria-pressed=${String(f.state === s[0])} onClick=${() => set('state', s[0])}>${s[1]}</button>`)}</div>
      </div>
    </section>
    <section class="card">
      <div class="row-between"><h2 class="card-title">Nutrition</h2>
        <div class="seg inset mini" role="group" aria-label="Values are per">
          <button aria-pressed=${String(per === '100')} onClick=${() => setPer('100')}>Per 100 g</button>
          <button aria-pressed=${String(per === 'serv')} onClick=${() => setPer('serv')}>Per serving</button>
        </div>
      </div>
      ${per === 'serv' && html`<label class="mfield wide"><span class="label">Serving size</span><span class="mbox"><input inputmode="decimal" placeholder="30" value=${serving} onInput=${e => { setServing(e.target.value); setErr(''); }}/><span class="unit">g</span></span></label>`}
      <div class="mgrid">${box('kcal', 'Calories', 'kcal')}${box('p', 'Protein', 'g')}${box('c', 'Carbs', 'g')}${box('fat', 'Fat', 'g')}</div>
      ${per === 'serv' && ok && html`<p class="hint">Saved per 100 g: ${kc(vals.kcal)} kcal · ${macroLine(vals)}</p>`}
      ${f.kcal === '' && html`<p class="hint">Leave calories empty and the app works them out from protein, carbs and fat.</p>`}
      ${off != null && html`<p class="warn"><${Ico} d=${UI.alert} size=${16}/>Calories don’t add up: protein, carbs and fat give about ${off} kcal, not ${kc(vals.kcal)}. Fibre or alcohol can explain a small gap; otherwise check the numbers.</p>`}
    </section>
    ${err && html`<p class="status bad">${err}</p>`}
    <div class="btn-row two">
      <button class="btn btn-ghost" onClick=${onCancel}>Back</button>
      <button class="btn btn-pop" onClick=${save}>${saveLabel}</button>
    </div>
    ${extra}
  </div>`;
}

function FoodEditor({ env, id }){
  const food = store.get('foods/' + id);
  const { app } = env;
  if (!food) return html`<div class="stack"><div class="topbar"><button class="link" onClick=${env.close}><${Ico} d=${UI.back} size=${18} sw=${2.6}/>Foods</button><h1>Food</h1><span></span></div><p class="hint">This food was deleted.</p></div>`;
  const meals = store.list('meals/').filter(m => m.items.some(it => it.foodId === id));
  const del = () => {
    const run = () => {
      const before = meals.map(clone);
      store.del('foods/' + id);
      meals.forEach(m => store.set('meals/' + m.id, Object.assign({}, m, { items: m.items.filter(it => it.foodId !== id) })));
      env.close();
      app.showToast(food.name + ' deleted.', { label: 'Undo', run: () => { store.set('foods/' + id, food); before.forEach(m => store.set('meals/' + m.id, m)); } });
    };
    if (!meals.length) return run();
    app.setSheet({ kind: 'confirm', title: 'Delete ' + food.name + '?', ok: 'Delete', danger: true,
      text: 'It’s used in ' + plural(meals.length, 'meal', 'meals') + ' (' + meals.map(m => m.name).join(', ') + '). It will be taken out of ' + (meals.length === 1 ? 'that meal' : 'those meals') + '.', run });
  };
  return html`<div class="stack">
    <div class="topbar"><button class="link" onClick=${env.close}><${Ico} d=${UI.back} size=${18} sw=${2.6}/>Foods</button><h1>Edit food</h1><span></span></div>
    ${meals.length > 0 && html`<p class="hint">Used in ${plural(meals.length, 'meal', 'meals')}. Changes here update ${meals.length === 1 ? 'it' : 'all of them'}.</p>`}
    <${FoodForm} initial=${food} saveLabel="Save changes" onCancel=${env.close}
      onSave=${f => { store.set('foods/' + id, Object.assign({}, food, f, { updatedAt: Date.now() })); env.close(); app.showToast('Food saved.'); }}
      extra=${html`<button class="btn btn-danger wide" onClick=${del}>Delete food</button>`}/>
  </div>`;
}

/* ---------- Meals ---------- */
function MealsView({ env }){
  const foods = foodMap();
  const meals = store.list('meals/').sort((a, b) => a.name.localeCompare(b.name));
  const groups = MEAL_TAGS.map(t => [t, meals.filter(m => m.tag === t[0])]).filter(g => g[1].length);
  return html`
    ${meals.length === 0 && html`<section class="card"><h2 class="card-title">No meals yet</h2><p class="hint">A meal is foods plus their weights, like “Chicken rice bowl”. Save it once, then log it with a tap in step 3.</p></section>`}
    ${groups.map(([t, list]) => html`<section key=${t[0]} class="stack-sm">
      <h2 class="label">${t[1]}</h2>
      <div class="list">${list.map(m => { const tot = mealTotals(m, foods); return html`<div key=${m.id} class="row">
        <button class="row-main" onClick=${() => env.open({ type: 'meal', id: m.id })}>
          <span class="col grow"><span class="row-title">${m.name}</span><span class="row-sub">${plural(m.items.length, 'food', 'foods')} · ${macroLine(tot)}</span></span>
          <span class="kcal-n">${kc(tot.kcal)}<small>kcal</small></span>
        </button>
      </div>`; })}</div>
    </section>`)}
    <button class="btn btn-pop" onClick=${() => env.open({ type: 'meal', id: null })}>+ New meal</button>`;
}

function MealEditor({ env, id }){
  const { app } = env;
  const saved = id ? store.get('meals/' + id) : null;
  const [m, setM] = useState(() => saved ? clone(saved) : { id: null, name: '', tag: 'lunch', items: [] });
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState('');
  if (id && !saved) return html`<div class="stack"><div class="topbar"><button class="link" onClick=${env.close}><${Ico} d=${UI.back} size=${18} sw=${2.6}/>Meals</button><h1>Meal</h1><span></span></div><p class="hint">This meal was deleted.</p></div>`;
  const foods = foodMap();
  const tot = mealTotals(m, foods);
  const off = kcalCheck(tot);
  const share = tot.kcal > 0 ? (() => { const a = fromMacros(tot) || 1; return [tot.p * 4 / a, tot.c * 4 / a, tot.fat * 9 / a]; })() : [0, 0, 0];
  const upd = patch => { setM(prev => Object.assign({}, prev, typeof patch === 'function' ? patch(prev) : patch)); setErr(''); };
  const setG = (iid, v) => upd(prev => ({ items: prev.items.map(it => it.id === iid ? Object.assign({}, it, { g: v }) : it) }));
  const save = () => {
    if (!m.name.trim()){ setErr('Give the meal a name.'); scrollTop(); return; }
    if (!m.items.length){ setErr('Add at least one food.'); return; }
    if (m.items.some(it => num(it.g) == null || num(it.g) <= 0)){ setErr('Every food needs a weight in grams.'); return; }
    const mid = m.id || uid();
    store.set('meals/' + mid, { id: mid, name: m.name.trim(), tag: m.tag, items: m.items.map(it => ({ id: it.id, foodId: it.foodId, g: num(it.g) })), createdAt: m.createdAt || Date.now() });
    env.close(); app.showToast('Meal saved.');
  };
  const del = () => app.setSheet({ kind: 'confirm', title: 'Delete ' + (saved.name || 'this meal') + '?', ok: 'Delete', danger: true, text: 'The foods stay in your library.',
    run: () => { store.del('meals/' + id); env.close(); app.showToast('Meal deleted.', { label: 'Undo', run: () => store.set('meals/' + id, saved) }); } });
  return html`<div class="stack">
    <div class="topbar">
      <button class="link" onClick=${env.close}><${Ico} d=${UI.back} size=${18} sw=${2.6}/>Cancel</button>
      <h1>${id ? 'Edit meal' : 'New meal'}</h1>
      <button class="link" onClick=${save}>Save</button>
    </div>
    <section class="card">
      <input class="input inset meal-name" aria-label="Meal name" placeholder="Meal name, like “Chicken rice bowl”" value=${m.name} onInput=${e => upd({ name: e.target.value })}/>
      <div class="seg inset" role="group" aria-label="Meal type">${MEAL_TAGS.map(t => html`<button key=${t[0]} aria-pressed=${String(m.tag === t[0])} onClick=${() => upd({ tag: t[0] })}>${t[1]}</button>`)}</div>
    </section>
    <section class="card totals" aria-label="Meal totals">
      <div class="row-between"><span class="tot-kcal">${kc(tot.kcal)} <small>kcal</small></span><span class="tot-macros">${macroLine(tot)}</span></div>
      <div class="mbar" aria-hidden="true"><i class="mp" style=${'width:' + share[0] * 100 + '%'}></i><i class="mc" style=${'width:' + share[1] * 100 + '%'}></i><i class="mf" style=${'width:' + share[2] * 100 + '%'}></i></div>
      <div class="legend"><span><i class="mp"></i>Protein</span><span><i class="mc"></i>Carbs</span><span><i class="mf"></i>Fat</span></div>
      ${off != null && html`<p class="warn"><${Ico} d=${UI.alert} size=${16}/>Calories don’t match the macros (about ${off} kcal from protein, carbs and fat). One of the foods probably has a typo.</p>`}
    </section>
    ${err && html`<p class="status bad">${err}</p>`}
    <section class="card">
      <div class="list">
        ${m.items.map(it => { const f = foods[it.foodId]; const part = f ? scale(f, num(it.g) || 0) : ZERO; return html`<div key=${it.id} class="ing">
          <span class="col grow"><span class="ing-name">${f ? f.name : 'Deleted food'}${f && f.state && html` <span class="pill">${f.state}</span>`}</span><span class="row-sub">${kc(part.kcal)} kcal · ${macroLine(part)}</span></span>
          <label class="gbox"><input inputmode="decimal" aria-label=${'Grams of ' + (f ? f.name : 'food')} value=${it.g} onInput=${e => setG(it.id, e.target.value)} onFocus=${e => e.target.select()}/><span>g</span></label>
          <button class="icon-btn" aria-label=${'Remove ' + (f ? f.name : 'food')} onClick=${() => upd(prev => ({ items: prev.items.filter(x => x.id !== it.id) }))}><${Ico} d=${UI.x} size=${18}/></button>
        </div>`; })}
        ${m.items.length === 0 && html`<p class="hint">No foods yet. Add them with their weight in grams; the totals update as you go.</p>`}
      </div>
      <button class="add-wide sm" onClick=${() => setPicking(true)}>+ Add food</button>
    </section>
    <button class="btn btn-pop wide" onClick=${save}>Save meal</button>
    ${id && html`<button class="btn btn-danger wide" onClick=${del}>Delete meal</button>`}
    ${picking && html`<div class="scrim" onClick=${e => { if (e.target === e.currentTarget) setPicking(false); }}>
      <div class="sheet tall" role="dialog" aria-modal="true" aria-label="Add food to meal">
        <div class="row-between"><h2>Add food</h2><button class="icon-btn" aria-label="Close" onClick=${() => setPicking(false)}><${Ico} d=${UI.x}/></button></div>
        <${FoodFinder} env=${env} withLibrary=${true} onPick=${f => { setPicking(false); upd(prev => ({ items: prev.items.concat([{ id: uid(), foodId: f.id, g: '100' }]) })); }}/>
      </div>
    </div>`}
  </div>`;
}

/* ---------- Barcode scanner: native BarcodeDetector where it exists, else ZXing (loaded on first use) ---------- */
let zxingLoad = null;
const loadZxing = () => zxingLoad || (zxingLoad = new Promise((ok, fail) => {
  if (window.ZXing) return ok(window.ZXing);
  const s = document.createElement('script'); s.src = 'vendor/zxing.min.js'; s.onload = () => ok(window.ZXing); s.onerror = () => { zxingLoad = null; fail(new Error('load')); };
  document.head.appendChild(s);
}));

function Scanner({ close, onCode }){
  const video = useRef(null);
  const [err, setErr] = useState('');
  const [typed, setTyped] = useState('');
  useEffect(() => {
    let stop = () => {}, done = false;
    const hit = c => { if (done) return; done = true; stop(); try { navigator.vibrate && navigator.vibrate(40); } catch (e){} onCode(c); };
    (async () => {
      try {
        if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('ean_13')){
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
          stop = () => stream.getTracks().forEach(t => t.stop());
          if (done){ stop(); return; }
          video.current.srcObject = stream; await video.current.play();
          const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
          const tick = async () => { if (done) return; try { const r = await det.detect(video.current); if (r.length) return hit(r[0].rawValue); } catch (e){} setTimeout(tick, 200); };
          tick();
        } else {
          const ZX = await loadZxing();
          if (done) return;
          const hints = new Map(); hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E]);
          const reader = new ZX.BrowserMultiFormatReader(hints, 250);
          stop = () => { try { reader.reset(); } catch (e){} };
          await reader.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video.current, r => { if (r) hit(r.getText()); });
        }
      } catch (e){
        setErr(e && e.message === 'load' ? 'The scanner couldn’t load. Check your connection, or type the number below.'
          : e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'Camera access is off. Allow it for this app in Settings → Safari → Camera, or type the number below.'
          : 'The camera couldn’t start. Type the number under the barcode instead.');
      }
    })();
    return () => { done = true; stop(); };
  }, []);
  const submit = () => { const c = typed.replace(/\D/g, ''); if (c.length >= 8) onCode(c); else setErr('A barcode number has 8 to 13 digits.'); };
  return html`<div class="scrim scan-scrim" onClick=${e => { if (e.target === e.currentTarget) close(); }}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Scan a barcode">
      <div class="row-between"><h2>Scan a barcode</h2><button class="icon-btn" aria-label="Close scanner" onClick=${close}><${Ico} d=${UI.x}/></button></div>
      <div class="viewfinder"><video ref=${video} playsinline muted autoplay></video><span class="aim" aria-hidden="true"></span></div>
      ${err ? html`<p class="status bad">${err}</p>` : html`<p class="hint">Hold the barcode inside the frame. It reads on its own.</p>`}
      <div class="search"><input inputmode="numeric" aria-label="Barcode number" placeholder="Or type the number" value=${typed} onInput=${e => setTyped(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') submit(); }}/>
        <button class="scan-btn" aria-label="Look up number" onClick=${submit}><${Ico} d=${UI.fwd} size=${20}/></button></div>
    </div>
  </div>`;
}

/* ---------- Targets ----------
   settings/targets = { split, base, train, rest }, each { kcal, p, c, fat }. With split on, a day uses train or rest
   depending on its log's `training` flag (the Gym tab sets it in step 4). */
const NO_T = { kcal: 0, p: 0, c: 0, fat: 0 };
export const getTargets = () => Object.assign({ split: false, base: NO_T, train: NO_T, rest: NO_T }, store.get('settings/targets') || {});
export const hasTargets = t => [t.base, t.train, t.rest].some(x => x && x.kcal > 0);
export function targetsFor(date){
  const t = getTargets(), log = store.get('log/' + date);
  if (!t.split) return t.base;
  return log && log.training ? t.train : t.rest;
}
/* A day counts as hit when calories are within 10% and protein reaches 90% of the target */
export const hitKcal = (tot, t) => t.kcal > 0 && Math.abs(tot.kcal - t.kcal) <= t.kcal * 0.1;
export const hitProtein = (tot, t) => t.p > 0 && tot.p >= t.p * 0.9;

export function TargetsForm({ onSaved }){
  const t0 = getTargets();
  const toS = o => ({ kcal: o.kcal ? String(o.kcal) : '', p: o.p ? String(o.p) : '', c: o.c ? String(o.c) : '', fat: o.fat ? String(o.fat) : '' });
  const [split, setSplit] = useState(t0.split);
  const [v, setV] = useState(() => ({ base: toS(t0.base), train: toS(t0.split ? t0.train : t0.base), rest: toS(t0.split ? t0.rest : t0.base) }));
  const [err, setErr] = useState('');
  const set = (which, k, val) => { setV(prev => Object.assign({}, prev, { [which]: Object.assign({}, prev[which], { [k]: val }) })); setErr(''); };
  const parse = o => ({ kcal: num(o.kcal) || 0, p: num(o.p) || 0, c: num(o.c) || 0, fat: num(o.fat) || 0 });
  const save = () => {
    const sets = split ? ['train', 'rest'] : ['base'];
    if (sets.some(w => ['kcal', 'p', 'c', 'fat'].some(k => v[w][k] !== '' && num(v[w][k]) == null))){ setErr('Use numbers only.'); return; }
    sets.forEach(w => { const o = parse(v[w]); if (!o.kcal && (o.p || o.c || o.fat)) o.kcal = Math.round(fromMacros(o)); v[w] = toS(o); });
    const base = split ? parse(v.train) : parse(v.base);
    store.set('settings/targets', { split, base, train: split ? parse(v.train) : base, rest: split ? parse(v.rest) : base });
    onSaved && onSaved();
  };
  const group = (which, title) => {
    const o = parse(v[which]), off = o.kcal && (o.p || o.c || o.fat) ? kcalCheck(o) : null;
    return html`<div class="stack-sm">
      ${title && html`<h3 class="label">${title}</h3>`}
      <div class="mgrid">${[['kcal', 'Calories', 'kcal'], ['p', 'Protein', 'g'], ['c', 'Carbs', 'g'], ['fat', 'Fat', 'g']].map(([k, label, unit]) => html`
        <label key=${k} class="mfield"><span class="label">${label}</span><span class="mbox"><input inputmode="decimal" autocomplete="off" placeholder=${k === 'kcal' ? 'auto' : '0'} value=${v[which][k]} onInput=${e => set(which, k, e.target.value)}/><span class="unit">${unit}</span></span></label>`)}</div>
      ${off != null && html`<p class="warn"><${Ico} d=${UI.alert} size=${16}/>These macros add up to about ${off} kcal, not ${kc(o.kcal)}.</p>`}
    </div>`;
  };
  return html`<div class="stack-sm">
    <button class="switch-row inset" aria-pressed=${String(split)} onClick=${() => setSplit(!split)}>
      <span class="col grow"><span class="row-title">Different targets on training days</span><span class="row-sub wrap">Each day in the log gets a training / rest switch</span></span>
      <span class=${'switch' + (split ? ' on' : '')}><span class="knob"></span></span>
    </button>
    ${split ? html`${group('train', 'Training day')}${group('rest', 'Rest day')}` : group('base', '')}
    <p class="hint">Leave calories empty to have them worked out from protein, carbs and fat.</p>
    ${err && html`<p class="status bad">${err}</p>`}
    <button class="btn btn-solid" onClick=${save}>Save targets</button>
  </div>`;
}

/* ---------- Daily log ----------
   log/<date> = { date, training, entries: [{ id, slot, kind: meal|food, ref, name, amount, unit, mealG }]
   unit = macros for 1 portion (meal) or per 100 g (food), copied when logged so old days never change by themselves. */
const SLOTS = MEAL_TAGS;
export const entryMacros = e => e.kind === 'meal' ? { kcal: e.unit.kcal * e.amount, p: e.unit.p * e.amount, c: e.unit.c * e.amount, fat: e.unit.fat * e.amount } : scale(e.unit, e.amount);
export const dayTotals = date => { const l = store.get('log/' + date); return l ? addUp(l.entries.map(entryMacros)) : ZERO; };
const PORTIONS = [[0.5, '½'], [1, '1'], [1.5, '1½'], [2, '2']];
const amountLabel = e => { if (e.kind === 'food') return g1(e.amount) + ' g'; if (e.amount === 1) return ''; const p = PORTIONS.find(x => x[0] === e.amount); return '×' + (p ? p[1] : g1(e.amount)); };
const dayLabel = (d, today) => d === today ? 'Today' : dayKey(new Date(parseKey(today).getTime() - 864e5)) === d ? 'Yesterday' : fmtShort(d);
const shiftDay = (d, n) => { const x = parseKey(d); x.setDate(x.getDate() + n); return dayKey(x); };

function MacroBar({ label, val, target, unit, cls }){
  const pct = target > 0 ? Math.min(100, val / target * 100) : 0;
  const over = target > 0 && val > target * 1.1;
  return html`<div class="tbar">
    <div class="row-between"><span class="tbar-label">${label}</span><span class="tbar-n"><b>${unit === 'kcal' ? kc(val) : g1(val)}</b>${target > 0 ? ' / ' + (unit === 'kcal' ? kc(target) : g1(target)) : ''} ${unit}</span></div>
    <div class="bar-track"><span class=${'bar-fill ' + cls + (over ? ' over' : '')} style=${'width:' + pct + '%'}></span></div>
  </div>`;
}

function LogView({ env, ui, setUi }){
  const { app } = env;
  const today = app.today;
  const date = ui.ddate && ui.ddate <= today ? ui.ddate : today;
  const setDate = d => setUi({ ddate: d > today ? today : d });
  const [sheet, setSheet] = useState(null);
  const log = store.get('log/' + date) || { date, training: false, entries: [] };
  const t = getTargets();
  const target = targetsFor(date);
  const tot = addUp(log.entries.map(entryMacros));
  const saveLog = next => { if (!next.entries.length && !next.training) store.del('log/' + date); else store.set('log/' + date, next); };
  const left = target.kcal - tot.kcal;
  return html`
    <div class="daynav">
      <button class="icon-btn" aria-label="Previous day" onClick=${() => setDate(shiftDay(date, -1))}><${Ico} d=${UI.back}/></button>
      <span class="daynav-label">${dayLabel(date, today)}</span>
      <button class="icon-btn" aria-label="Next day" disabled=${date >= today} onClick=${() => setDate(shiftDay(date, 1))}><${Ico} d=${UI.fwd}/></button>
    </div>
    ${t.split && html`<div class="seg" role="group" aria-label="Day type">
      <button aria-pressed=${String(!log.training)} onClick=${() => saveLog(Object.assign({}, log, { date, training: false }))}>Rest day</button>
      <button aria-pressed=${String(!!log.training)} onClick=${() => saveLog(Object.assign({}, log, { date, training: true }))}>Training day</button>
    </div>`}
    <section class="card" aria-label="Day totals">
      <div class="row-between">
        <span class="tot-kcal">${kc(tot.kcal)} <small>${target.kcal > 0 ? '/ ' + kc(target.kcal) + ' kcal' : 'kcal'}</small></span>
        ${target.kcal > 0 ? html`<span class=${'left' + (left < 0 ? ' over' : '')}>${left >= 0 ? kc(left) + ' left' : kc(-left) + ' over'}</span>`
          : html`<button class="link" onClick=${() => setSheet({ kind: 'targets' })}>Set targets</button>`}
      </div>
      <div class="bar-track big"><span class=${'bar-fill mk' + (target.kcal > 0 && tot.kcal > target.kcal * 1.1 ? ' over' : '')} style=${'width:' + (target.kcal > 0 ? Math.min(100, tot.kcal / target.kcal * 100) : 0) + '%'}></span></div>
      <div class="tbars">
        <${MacroBar} label="Protein" val=${tot.p} target=${target.p} unit="g" cls="mp"/>
        <${MacroBar} label="Carbs" val=${tot.c} target=${target.c} unit="g" cls="mc"/>
        <${MacroBar} label="Fat" val=${tot.fat} target=${target.fat} unit="g" cls="mf"/>
      </div>
      ${target.kcal > 0 && html`<button class="link sm-link" onClick=${() => setSheet({ kind: 'targets' })}>Edit targets</button>`}
    </section>
    ${SLOTS.map(([slot, name]) => {
      const list = log.entries.filter(e => e.slot === slot);
      const st = addUp(list.map(entryMacros));
      return html`<section key=${slot} class="slot">
        <div class="slot-head"><h2 class="label">${name}</h2>${list.length > 0 && html`<span class="slot-sum">${fullLine(st)}</span>`}</div>
        ${list.map(e => { const m = entryMacros(e); return html`<button key=${e.id} class="entry" onClick=${() => setSheet({ kind: 'entry', entry: e })}>
          <span class="entry-name">${e.name}${amountLabel(e) && html` <span class="amt">${amountLabel(e)}</span>`}</span>
          <span class="entry-sub">${fullLine(m)}</span>
        </button>`; })}
        <button class="add-wide sm" onClick=${() => setSheet({ kind: 'add', slot })}>+ Add to ${name.toLowerCase()}</button>
      </section>`;
    })}
    ${sheet && sheet.kind === 'targets' && html`<${Sheet} title="Targets" close=${() => setSheet(null)}><${TargetsForm} onSaved=${() => { setSheet(null); app.showToast('Targets saved.'); }}/><//>`}
    ${sheet && sheet.kind === 'add' && html`<${AddSheet} env=${env} slot=${sheet.slot} close=${() => setSheet(null)}
      onLog=${e => { saveLog(Object.assign({}, log, { date, entries: log.entries.concat([e]) })); setSheet(null); app.showToast(e.name + ' logged.'); }}/>`}
    ${sheet && sheet.kind === 'entry' && html`<${Sheet} title=${sheet.entry.name} close=${() => setSheet(null)}>
      <${PortionPicker} entry=${sheet.entry} okLabel="Save" onOk=${e => { saveLog(Object.assign({}, log, { entries: log.entries.map(x => x.id === e.id ? e : x) })); setSheet(null); }}/>
      <div class="seg inset" role="group" aria-label="Move to">${SLOTS.map(([s2, n2]) => html`<button key=${s2} aria-pressed=${String(sheet.entry.slot === s2)}
        onClick=${() => { saveLog(Object.assign({}, log, { entries: log.entries.map(x => x.id === sheet.entry.id ? Object.assign({}, x, { slot: s2 }) : x) })); setSheet(null); }}>${n2}</button>`)}</div>
      <button class="btn btn-danger" onClick=${() => {
        const before = log; saveLog(Object.assign({}, log, { entries: log.entries.filter(x => x.id !== sheet.entry.id) })); setSheet(null);
        app.showToast(sheet.entry.name + ' removed.', { label: 'Undo', run: () => store.set('log/' + date, before) });
      }}>Remove from log</button>
    <//>`}`;
}

function Sheet({ title, close, children, tall }){
  return html`<div class="scrim" onClick=${e => { if (e.target === e.currentTarget) close(); }}>
    <div class=${'sheet' + (tall ? ' tall' : '')} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="row-between"><h2>${title}</h2><button class="icon-btn" aria-label="Close" onClick=${close}><${Ico} d=${UI.x}/></button></div>
      ${children}
    </div>
  </div>`;
}

/* Pick what to log: a saved meal (portion) or a single food (grams) */
function AddSheet({ env, slot, close, onLog }){
  const [tab, setTab] = useState('meals');
  const [pick, setPick] = useState(null);
  const foods = foodMap();
  const meals = store.list('meals/').sort((a, b) => (a.tag === slot ? 0 : 1) - (b.tag === slot ? 0 : 1) || a.name.localeCompare(b.name));
  const name = (SLOTS.find(s => s[0] === slot) || ['', ''])[1];
  if (pick) return html`<${Sheet} title=${pick.name} close=${close}>
    <${PortionPicker} entry=${pick} okLabel=${'Log to ' + name.toLowerCase()} onOk=${onLog}/>
    <button class="btn btn-ghost sm" onClick=${() => setPick(null)}>Back</button>
  <//>`;
  const fromMeal = m => { const unit = mealTotals(m, foods); const mealG = m.items.reduce((a, it) => a + (Number(it.g) || 0), 0);
    setPick({ id: uid(), slot, kind: 'meal', ref: m.id, name: m.name, amount: 1, unit, mealG }); };
  const fromFood = f => setPick({ id: uid(), slot, kind: 'food', ref: f.id, name: f.name, amount: 100, unit: { kcal: f.kcal, p: f.p, c: f.c, fat: f.fat } });
  return html`<${Sheet} title=${'Add to ' + name.toLowerCase()} close=${close} tall=${true}>
    <div class="seg inset" role="group" aria-label="What to add">
      <button aria-pressed=${String(tab === 'meals')} onClick=${() => setTab('meals')}>Saved meals</button>
      <button aria-pressed=${String(tab === 'foods')} onClick=${() => setTab('foods')}>Single food</button>
    </div>
    ${tab === 'meals'
      ? html`<div class="list">
          ${meals.map(m => { const tot = mealTotals(m, foods); return html`<div key=${m.id} class="row"><button class="row-main" onClick=${() => fromMeal(m)}>
            <span class="col grow"><span class="row-title">${m.name}</span><span class="row-sub wrap">${fullLine(tot)}</span></span>
          </button></div>`; })}
          ${meals.length === 0 && html`<p class="hint">No saved meals yet. Build them in Meals, or log a single food.</p>`}
        </div>`
      : html`<${FoodFinder} env=${env} withLibrary=${true} onPick=${fromFood}/>`}
  <//>`;
}

function PortionPicker({ entry, okLabel, onOk }){
  const meal = entry.kind === 'meal';
  const preset = meal && PORTIONS.some(p => p[0] === entry.amount);
  const [mode, setMode] = useState(meal && !preset ? 'g' : 'x');
  const [x, setX] = useState(entry.amount);
  const [g, setG] = useState(() => meal ? (entry.mealG ? g1(entry.amount * entry.mealG) : '') : g1(entry.amount));
  const grams = num(g);
  const amount = !meal ? grams : mode === 'x' ? x : (grams && entry.mealG ? grams / entry.mealG : null);
  const m = amount ? entryMacros(Object.assign({}, entry, { amount })) : null;
  return html`<div class="stack-sm">
    ${meal && html`<p class="hint">One portion: ${fullLine(entry.unit)}${entry.mealG ? ' (' + g1(entry.mealG) + ' g)' : ''}</p>`}
    ${meal && html`<div class="portions">
      ${PORTIONS.map(([v, l]) => html`<button key=${v} class="chip-toggle" aria-pressed=${String(mode === 'x' && x === v)} onClick=${() => { setMode('x'); setX(v); }}>${l}</button>`)}
      ${entry.mealG > 0 && html`<button class="chip-toggle" aria-pressed=${String(mode === 'g')} onClick=${() => setMode('g')}>Grams</button>`}
    </div>`}
    ${(!meal || mode === 'g') && html`<label class="mfield"><span class="label">${meal ? 'How much of the meal' : 'How much'}</span>
      <span class="mbox"><input inputmode="decimal" autocomplete="off" value=${g} onInput=${e => setG(e.target.value)} onFocus=${e => e.target.select()}/><span class="unit">g</span></span></label>`}
    ${!meal && html`<p class="hint">Per 100 g: ${fullLine(entry.unit)}</p>`}
    <div class="card inset-card"><span class="tot-kcal sm">${m ? kc(m.kcal) : '–'} <small>kcal</small></span><span class="tot-macros">${m ? macroLine(m) : 'Enter an amount'}</span></div>
    <button class="btn btn-pop" disabled=${!amount} onClick=${() => onOk(Object.assign({}, entry, { amount: Math.round(amount * 1000) / 1000 }))}>${okLabel}</button>
  </div>`;
}

/* ---------- Weight ----------
   weights/<date> = { date, kg }. Trend = straight-line fit through the last 8 weeks of weigh-ins. */
export function weightTrend(list){
  const pts = list.slice(-1)[0] ? list.filter(w => parseKey(w.date) >= parseKey(list[list.length - 1].date).getTime() - 56 * 864e5) : [];
  if (pts.length < 2) return null;
  const xs = pts.map(w => parseKey(w.date).getTime() / 864e5), ys = pts.map(w => w.kg);
  if (xs[xs.length - 1] - xs[0] < 6) return null;
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) * (x - mx), 0);
  return { perWeek: slope * 7, weeks: Math.round((xs[xs.length - 1] - xs[0]) / 7) || 1 };
}

function WeightChart({ list }){
  const pts = list.slice(-20);
  if (pts.length < 2) return null;
  const W = 300, H = 90, P = 8;
  const t = pts.map(w => parseKey(w.date).getTime()), lo = Math.min(...pts.map(w => w.kg)), hi = Math.max(...pts.map(w => w.kg));
  const span = Math.max(hi - lo, 1), t0 = t[0], tr = (t[t.length - 1] - t0) || 1;
  const xy = pts.map((w, i) => [P + (t[i] - t0) / tr * (W - 2 * P), P + (hi + span * 0.1 - w.kg) / (span * 1.2) * (H - 2 * P)]);
  return html`<svg class="wchart" viewBox=${'0 0 ' + W + ' ' + H} role="img" aria-label=${'Weight from ' + g1(pts[0].kg) + ' to ' + g1(pts[pts.length - 1].kg) + ' kg'}>
    <polyline points=${xy.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')} fill="none" stroke="var(--pop)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${xy.map((p, i) => html`<circle key=${i} cx=${p[0].toFixed(1)} cy=${p[1].toFixed(1)} r="3.5" fill="var(--pop)"/>`)}
  </svg>`;
}

function hitStats(today, days){
  let logged = 0, kcal = 0, prot = 0;
  for (let i = 1; i <= days; i++){
    const d = shiftDay(today, -i), l = store.get('log/' + d);
    if (!l || !l.entries.length) continue;
    const tot = addUp(l.entries.map(entryMacros)), t = targetsFor(d);
    logged++; if (hitKcal(tot, t)) kcal++; if (hitProtein(tot, t)) prot++;
  }
  return { logged, kcal, prot };
}

const kg1 = n => (Math.round(n * 10) / 10).toFixed(1);

function WeightView({ env }){
  const { app } = env;
  const today = app.today;
  const [adding, setAdding] = useState(false);
  const [kg, setKg] = useState('');
  const [date, setDate] = useState(today);
  const [err, setErr] = useState('');
  const list = store.list('weights/').sort((a, b) => a.date < b.date ? -1 : 1);
  const last = list[list.length - 1], prev = list[list.length - 2];
  const trend = weightTrend(list);
  const tgt = hasTargets(getTargets());
  const w7 = hitStats(today, 7), w30 = hitStats(today, 30);
  const save = () => {
    const v = num(kg);
    if (v == null || v < 25 || v > 350){ setErr('Enter your weight in kg, like 82.4.'); return; }
    if (!date || date > today){ setErr('Pick today or an earlier date.'); return; }
    store.set('weights/' + date, { date, kg: Math.round(v * 10) / 10 });
    setAdding(false); setKg(''); setErr(''); app.showToast('Weigh-in saved.');
  };
  const diffTxt = (a, b) => { const d = a - b; return (d > 0 ? '+' : d < 0 ? '−' : '±') + kg1(Math.abs(d)) + ' kg'; };
  const hist = list.slice().reverse();
  return html`
    <section class="card">
      ${last ? html`
        <div class="row-between"><span class="tot-kcal">${kg1(last.kg)} <small>kg</small></span><span class="cat-sub">${dayLabel(last.date, today)}</span></div>
        ${prev && html`<p class="hint"><b class="wdiff">${diffTxt(last.kg, prev.kg)}</b> since ${dayLabel(prev.date, today).toLowerCase() === 'yesterday' ? 'yesterday' : fmtShort(prev.date)}</p>`}
        <${WeightChart} list=${list}/>
        <p class="hint">${trend ? html`Trend: <b class="wdiff">${(trend.perWeek > 0 ? '+' : trend.perWeek < 0 ? '−' : '±') + kg1(Math.abs(trend.perWeek)) + ' kg per week'}</b> over the last ${plural(trend.weeks, 'week', 'weeks')}.` : 'Weigh in again at least a week later to see your weekly trend.'}</p>`
      : html`<h2 class="card-title">No weigh-ins yet</h2><p class="hint">Weigh in whenever you like, ideally in the morning before eating. The trend works with gaps.</p>`}
      ${adding ? html`<div class="stack-sm">
          <div class="mgrid two">
            <label class="mfield"><span class="label">Weight</span><span class="mbox"><input inputmode="decimal" autocomplete="off" placeholder=${last ? kg1(last.kg) : '80.0'} value=${kg} onInput=${e => { setKg(e.target.value); setErr(''); }}/><span class="unit">kg</span></span></label>
            <label class="mfield"><span class="label">Date</span><input class="input inset" type="date" max=${today} value=${date} onInput=${e => { setDate(e.target.value); setErr(''); }}/></label>
          </div>
          ${err && html`<p class="status bad">${err}</p>`}
          <div class="btn-row two"><button class="btn btn-ghost" onClick=${() => { setAdding(false); setErr(''); }}>Cancel</button><button class="btn btn-pop" onClick=${save}>Save</button></div>
        </div>`
        : html`<button class="btn btn-pop" onClick=${() => { setAdding(true); setDate(today); }}>+ Weigh in</button>`}
    </section>
    <section class="card">
      <h2 class="card-title">Targets hit</h2>
      ${!tgt ? html`<p class="hint">Set your targets in Log or Settings to see how often you hit them.</p>`
        : html`<div class="hits">
            ${[['Last 7 days', w7], ['Last 30 days', w30]].map(([l, s]) => html`<div key=${l} class="hit">
              <span class="label">${l}</span>
              <span class="hit-n"><b>${s.kcal}</b>/${s.logged} <small>calories</small></span>
              <span class="hit-n"><b>${s.prot}</b>/${s.logged} <small>protein</small></span>
            </div>`)}
          </div>
          <p class="hint">Out of the finished days you logged, so today doesn’t count yet. Calories count when within 10% of the target; protein when you reach at least 90%.</p>`}
    </section>
    ${hist.length > 0 && html`<section class="card">
      <h2 class="card-title">History</h2>
      <div class="list">${hist.map((w, i) => { const before = hist[i + 1]; return html`<div key=${w.date} class="wrow">
        <span class="grow">${fmtShort(w.date)}</span>
        ${before && html`<span class="cat-sub">${diffTxt(w.kg, before.kg)}</span>`}
        <b>${kg1(w.kg)} kg</b>
        <button class="icon-btn" aria-label=${'Delete weigh-in of ' + fmtShort(w.date)} onClick=${() => { store.del('weights/' + w.date); app.showToast('Weigh-in deleted.', { label: 'Undo', run: () => store.set('weights/' + w.date, w) }); }}><${Ico} d=${UI.x} size=${16}/></button>
      </div>`; })}</div>
    </section>`}`;
}
