/* AI assistant: a chat that can read your Ember Life data and propose new foods, meals, log entries and routines.
   Nothing is saved by the assistant itself: every change shows up as a card and is saved only when you tap it.
   The conversation lives on this device only (it can hold photos), and is only ever appended to. */
import { html, useState, useEffect, useRef, Ico, UI, uid, dayKey, fmtShort, plural } from './lib.js';
import { store } from './store.js';
import { claude, aiModel, fallbackParams, aiError } from './claude.js';
import { foodMap, mealTotals, entryMacros, addUp, getTargets, targetsFor, goalFor, maintenance, latestWeight, dayTotals, usdaSearch, MEAL_TAGS, kc, g1 } from './diet.js';
import { loadLib, allExercises, rank, exById, workoutsList, workedOutOn, normRoutine } from './gym.js';

const CHAT_KEY = 'ember-life-chat';
const MAX_STEPS = 10;

const SYSTEM = `You are the assistant inside Ember Life, a personal app that combines a day planner, a diet tracker (food library per 100 g, saved meals, a daily log, calorie and macro targets, weigh-ins) and a gym tracker (exercise library, routines, workout history).

How to work:
- Look things up with the tools before answering questions about the user's data. Never guess their targets, foods, meals, weight or workouts.
- Units are metric: grams, kg, kcal. Food values are per 100 g.
- For nutrition values, use the user's own foods first, then usda_lookup. Only estimate when neither has it, and say clearly that it is an estimate.
- To create anything (a food, a meal, a log entry, a routine), call the matching propose_ tool. The app shows it as a card and saves it only when the user taps the button. Never say something was saved or logged; say it's ready to add.
- When recommending portions of meat, fish, rice, pasta, potatoes or similar, give the weight the way their food is stored (raw or cooked, per the food library), and also give the other one when it helps (for example "200 g raw chicken, about 150 g cooked").
- Photos: if it's a nutrition label, read the exact values and convert them to per 100 g. If it's a plate of food, identify the foods, look them up, estimate the portions and say the portions are estimates. If it's a package front without a label, ask for a photo of the nutrition table or suggest the barcode scanner in Diet → Foods.
- When proposing a meal or a day of eating, keep the totals close to the user's targets and mention how they compare.
- For routines, use search_exercises to find real exercise ids.
- Keep answers short and easy to read on a phone: plain sentences and short "- " bullet lists, no tables, no headings.`;

const T = (name, description, properties, required) => ({ name, description, eager_input_streaming: true, input_schema: { type: 'object', properties, required: required || [] } });
const NUTR = { kcal: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' } };
const TOOLS = [
  T('get_status', 'The user\'s situation right now: date and time, today\'s targets and what is already logged per meal, what is left, cut/maintain/bulk goal, body details, latest weight, today\'s plan and gym status.', {}),
  T('search_my_foods', 'Search the user\'s food library (values per 100 g). Empty query lists everything.', { query: { type: 'string' } }),
  T('list_my_meals', 'List the user\'s saved meals with their foods, grams and totals.', {}),
  T('usda_lookup', 'Look up a food in the USDA FoodData Central database. Returns values per 100 g.', { query: { type: 'string', description: 'Plain food name, like "chicken breast raw"' } }, ['query']),
  T('get_weight_history', 'The user\'s weigh-ins, newest first.', {}),
  T('search_exercises', 'Search the exercise library. Returns ids for routines.', { query: { type: 'string' } }, ['query']),
  T('get_workouts', 'Recent workouts with exercises and sets, newest first. Optionally only those containing one exercise.', { exercise_id: { type: 'string' }, limit: { type: 'integer' } }),
  T('list_routines', 'The user\'s saved gym routines.', {}),
  T('propose_food', 'Show a card to add a food to the user\'s library. Values per 100 g.', {
    name: { type: 'string' }, brand: { type: 'string' }, state: { type: 'string', enum: ['raw', 'cooked', ''] },
    kcal: NUTR.kcal, protein: NUTR.protein, carbs: NUTR.carbs, fat: NUTR.fat,
    source: { type: 'string', enum: ['usda', 'label', 'estimate'], description: 'usda = from usda_lookup, label = read from a nutrition label, estimate = your estimate' }
  }, ['name', 'state', 'kcal', 'protein', 'carbs', 'fat', 'source']),
  T('propose_meal', 'Show a card to save a meal (foods with weights). Use food_id for foods already in the library; give new_food for foods that are not.', {
    name: { type: 'string' }, tag: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
    items: { type: 'array', items: { type: 'object', properties: { food_id: { type: 'string' }, name: { type: 'string' }, grams: { type: 'number' },
      new_food: { type: 'object', properties: { state: { type: 'string', enum: ['raw', 'cooked', ''] }, kcal: NUTR.kcal, protein: NUTR.protein, carbs: NUTR.carbs, fat: NUTR.fat, source: { type: 'string', enum: ['usda', 'label', 'estimate'] } } } }, required: ['name', 'grams'] } }
  }, ['name', 'tag', 'items']),
  T('propose_log', 'Show a card to add items to the daily log. Each item is a saved meal (meal_id + portions) or a food (food_id or new_food + grams).', {
    date: { type: 'string', description: 'YYYY-MM-DD, default today' }, slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
    items: { type: 'array', items: { type: 'object', properties: { meal_id: { type: 'string' }, portions: { type: 'number' }, food_id: { type: 'string' }, name: { type: 'string' }, grams: { type: 'number' },
      new_food: { type: 'object', properties: { state: { type: 'string', enum: ['raw', 'cooked', ''] }, kcal: NUTR.kcal, protein: NUTR.protein, carbs: NUTR.carbs, fat: NUTR.fat, source: { type: 'string', enum: ['usda', 'label', 'estimate'] } } } }, required: ['name'] } }
  }, ['slot', 'items']),
  T('propose_routine', 'Show a card to save a gym routine. exercise_id must come from search_exercises.', {
    name: { type: 'string' },
    exercises: { type: 'array', items: { type: 'object', properties: { exercise_id: { type: 'string' }, warmup_sets: { type: 'integer' }, working_sets: { type: 'integer' }, rest_seconds: { type: 'integer' } }, required: ['exercise_id', 'working_sets'] } }
  }, ['name', 'exercises'])
];

/* ---------- Reading data for the tools ---------- */
const r1 = n => Math.round(n * 10) / 10;
const per100 = f => ({ kcal: r1(f.kcal), protein: r1(f.p), carbs: r1(f.c), fat: r1(f.fat) });
const macros = m => ({ kcal: Math.round(m.kcal), protein: r1(m.p), carbs: r1(m.c), fat: r1(m.fat) });
const isNum = v => typeof v === 'number' && isFinite(v) && v >= 0;

export async function runTool(name, input){
  const today = dayKey();
  if (name === 'get_status'){
    const log = store.get('log/' + today) || { entries: [] };
    const t = targetsFor(today), tot = dayTotals(today), m = maintenance(), g = goalFor(t.kcal, m);
    const cur = store.get('planner/current');
    const active = store.get('gym/active');
    const ws = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayKey(d); })();
    return {
      now: new Date().toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
      day_type: getTargets().split ? (log.training ? 'training day' : 'rest day') : 'same targets every day',
      targets: t.kcal ? macros(t) : 'not set yet',
      eaten_today: macros(tot),
      left_today: t.kcal ? macros({ kcal: t.kcal - tot.kcal, p: t.p - tot.p, c: t.c - tot.c, fat: t.fat - tot.fat }) : null,
      logged_today: MEAL_TAGS.map(([s, n]) => ({ meal: n, items: log.entries.filter(e => e.slot === s).map(e => ({ name: e.name, amount: e.kind === 'food' ? e.amount + ' g' : e.amount + ' portion(s)', ...macros(entryMacros(e)) })) })),
      goal: g ? { kind: g.kind, kcal_vs_maintenance_per_day: Math.round(g.diff), kg_per_week: r1(g.perWeek) } : 'add body details in targets to see this',
      maintenance_kcal: m ? m.kcal : null, body: store.get('settings/body') || null, latest_weight_kg: latestWeight(),
      plan_today: cur && cur.set && cur.date === today ? (cur.items || []).map(i => i.name + ((cur.done || []).includes(i.id) ? ' (done)' : '')) : 'no plan set today',
      gym: { worked_out_today: workedOutOn(today), workout_in_progress: active ? active.name : null, workouts_this_week: store.list('workouts/').filter(w => w.date >= ws).length }
    };
  }
  if (name === 'search_my_foods'){
    const q = String(input.query || '').toLowerCase().trim();
    const list = store.list('foods/').filter(f => !q || (f.name + ' ' + (f.brand || '')).toLowerCase().includes(q)).slice(0, 60);
    return list.length ? list.map(f => ({ food_id: f.id, name: f.name, brand: f.brand || undefined, state: f.state || 'not specified', per_100g: per100(f) })) : 'No matching foods in the library.';
  }
  if (name === 'list_my_meals'){
    const foods = foodMap();
    const list = store.list('meals/');
    return list.length ? list.map(m => ({ meal_id: m.id, name: m.name, tag: m.tag, items: m.items.map(it => ({ food_id: it.foodId, name: foods[it.foodId] ? foods[it.foodId].name : 'deleted food', grams: it.g, state: foods[it.foodId] ? foods[it.foodId].state : '' })), one_portion: macros(mealTotals(m, foods)) })) : 'No saved meals yet.';
  }
  if (name === 'usda_lookup'){
    const res = await usdaSearch(String(input.query || ''));
    return res.length ? res.slice(0, 6).map(f => ({ name: f.name, state: f.state || 'not specified', per_100g: per100(f) })) : 'USDA has nothing for that. Try simpler words.';
  }
  if (name === 'get_weight_history'){
    const w = store.list('weights/').sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 40);
    return w.length ? w : 'No weigh-ins yet.';
  }
  if (name === 'search_exercises'){
    await loadLib();
    const q = String(input.query || '').toLowerCase().trim(), words = q.split(/\s+/).filter(Boolean);
    const list = allExercises().filter(x => words.every(w => (x.n + ' ' + (x.a || '') + ' ' + x.p.join(' ')).toLowerCase().includes(w)))
      .sort((a, b) => rank(b, q) - rank(a, q) || a.n.length - b.n.length).slice(0, 12);
    return list.length ? list.map(x => ({ exercise_id: x.id, name: x.n, main_muscles: x.p, helper_muscles: x.s, equipment: x.e })) : 'No match. Try a shorter or more common name.';
  }
  if (name === 'get_workouts'){
    await loadLib();
    let list = workoutsList();
    if (input.exercise_id) list = list.filter(w => w.exercises.some(e => e.ex === input.exercise_id));
    list = list.slice(0, Math.min(20, input.limit || 8));
    return list.length ? list.map(w => ({ date: w.date, name: w.name, minutes: Math.round((w.end - w.start) / 60000), exercises: w.exercises.filter(e => !input.exercise_id || e.ex === input.exercise_id).map(e => ({ exercise: exById(e.ex).n, sets: e.sets.map(s => (s.t === 'w' ? 'warm-up ' : '') + s.kg + ' kg x ' + s.reps + (s.rpe ? ' @' + s.rpe : '')) })) })) : 'No workouts logged yet.';
  }
  if (name === 'list_routines'){
    await loadLib();
    const r = store.list('routines/');
    return r.length ? r.map(normRoutine).map(x => ({ name: x.name, exercises: x.items.map(it => exById(it.ex).n + ': ' + it.sets.map(z => (z.t === 'w' ? 'warm-up ' : '') + (z.kg !== '' ? z.kg + ' kg' : '') + (z.reps !== '' ? ' x ' + z.reps : '')).join(', ')) })) : 'No routines yet.';
  }
  if (name.startsWith('propose_')){ if (name === 'propose_routine') await loadLib(); return checkProposal(name, input); }
  return { error: 'Unknown tool' };
}

/* Proposals are checked here, then shown as cards. Returns text for Claude, or throws with what's wrong. */
function checkFoodSpec(f, where){
  if (!f || !['kcal', 'protein', 'carbs', 'fat'].every(k => isNum(f[k]))) throw new Error(where + ' needs kcal, protein, carbs and fat per 100 g as numbers.');
  if (f.protein + f.carbs + f.fat > 100.5) throw new Error(where + ': protein, carbs and fat add up to more than 100 g per 100 g.');
}
function checkProposal(name, x){
  const foods = foodMap(), meals = Object.fromEntries(store.list('meals/').map(m => [m.id, m]));
  if (name === 'propose_food'){ if (!x.name) throw new Error('The food needs a name.'); checkFoodSpec(x, 'The food'); }
  if (name === 'propose_meal' || name === 'propose_log'){
    if (!Array.isArray(x.items) || !x.items.length) throw new Error('Add at least one item.');
    x.items.forEach((it, i) => {
      const where = 'Item ' + (i + 1) + ' (' + (it.name || '?') + ')';
      if (it.meal_id){ if (name !== 'propose_log' || !meals[it.meal_id]) throw new Error(where + ': unknown meal_id. Use list_my_meals.'); return; }
      if (it.food_id){ if (!foods[it.food_id]) throw new Error(where + ': unknown food_id. Use search_my_foods.'); }
      else checkFoodSpec(it.new_food, where);
      if (!isNum(it.grams) || it.grams <= 0) throw new Error(where + ' needs grams.');
    });
  }
  if (name === 'propose_routine'){
    if (!x.name || !Array.isArray(x.exercises) || !x.exercises.length) throw new Error('The routine needs a name and exercises.');
    const ids = new Set(allExercises().map(e => e.id));
    x.exercises.forEach(e => { if (!ids.has(e.exercise_id)) throw new Error('Unknown exercise_id ' + e.exercise_id + '. Use search_exercises.'); });
  }
  return 'Shown to the user as a card with a button. Nothing is saved until they tap it.';
}

/* Saving a confirmed card */
const SRC = { usda: 'usda', label: 'manual', estimate: 'ai' };
function makeFood(name, f){
  const id = uid();
  store.set('foods/' + id, { id, name: name.trim(), brand: (f.brand || '').trim(), state: f.state || '', kcal: r1(f.kcal), p: r1(f.protein), c: r1(f.carbs), fat: r1(f.fat), source: SRC[f.source] || 'ai', ref: '', barcode: '', createdAt: Date.now() });
  return store.get('foods/' + id);
}
function confirmCard(name, x){
  if (name === 'propose_food') return makeFood(x.name, x).name + ' added to your foods.';
  if (name === 'propose_meal'){
    const items = x.items.map(it => ({ id: uid(), foodId: it.food_id || makeFood(it.name, it.new_food).id, g: it.grams }));
    const id = uid(); store.set('meals/' + id, { id, name: x.name.trim(), tag: x.tag, items, createdAt: Date.now() });
    return x.name + ' saved to your meals.';
  }
  if (name === 'propose_log'){
    const date = /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : dayKey();
    const foods = foodMap();
    const entries = x.items.map(it => {
      if (it.meal_id){ const m = store.get('meals/' + it.meal_id);
        return { id: uid(), slot: x.slot, kind: 'meal', ref: m.id, name: m.name, amount: isNum(it.portions) && it.portions > 0 ? it.portions : 1, unit: mealTotals(m, foods), mealG: m.items.reduce((a, i) => a + (Number(i.g) || 0), 0) }; }
      const f = it.food_id ? foods[it.food_id] : makeFood(it.name, it.new_food);
      return { id: uid(), slot: x.slot, kind: 'food', ref: f.id, name: f.name, amount: it.grams, unit: { kcal: f.kcal, p: f.p, c: f.c, fat: f.fat } };
    });
    const log = store.get('log/' + date) || { date, entries: [] };
    store.set('log/' + date, Object.assign({}, log, { date, entries: log.entries.concat(entries) }));
    return plural(entries.length, 'item', 'items') + ' added to ' + (date === dayKey() ? 'today' : fmtShort(date)) + '.';
  }
  if (name === 'propose_routine'){
    const id = uid();
    store.set('routines/' + id, normRoutine({ id, name: x.name.trim(), items: x.exercises.map(e => ({ ex: e.exercise_id, warm: Math.max(0, e.warmup_sets || 0), sets: Math.max(1, e.working_sets || 3), rest: isNum(e.rest_seconds) ? e.rest_seconds : 90 })) }));
    return x.name + ' saved to your routines.';
  }
}

/* What a card shows */
function cardView(name, x){
  const foods = foodMap();
  const line = m => kc(m.kcal) + ' kcal · P ' + g1(m.p) + ' · C ' + g1(m.c) + ' · F ' + g1(m.fat);
  const asF = f => ({ kcal: f.kcal, p: f.protein, c: f.carbs, fat: f.fat });
  const itemMacros = it => {
    if (it.meal_id){ const m = store.get('meals/' + it.meal_id); if (!m) return null; const t = mealTotals(m, foods), k = isNum(it.portions) ? it.portions : 1; return { kcal: t.kcal * k, p: t.p * k, c: t.c * k, fat: t.fat * k }; }
    const f = it.food_id ? foods[it.food_id] : it.new_food && asF(it.new_food); if (!f) return null;
    const k = (it.grams || 0) / 100; return { kcal: f.kcal * k, p: f.p * k, c: f.c * k, fat: f.fat * k };
  };
  if (name === 'propose_food') return { title: x.name, kind: 'New food', badge: x.source, lines: ['Per 100 g: ' + line(asF(x)), x.state ? 'Weighed ' + x.state : ''], ok: 'Add to foods' };
  if (name === 'propose_meal' || name === 'propose_log'){
    const parts = x.items.map(it => ({ it, m: itemMacros(it) }));
    const tot = addUp(parts.map(p => p.m || { kcal: 0, p: 0, c: 0, fat: 0 }));
    const lines = parts.map(({ it, m }) => (it.meal_id ? it.name + (isNum(it.portions) && it.portions !== 1 ? ' ×' + it.portions : '') : it.name + ' · ' + g1(it.grams) + ' g') + (it.new_food ? ' (new' + (it.new_food.source === 'estimate' ? ', estimate' : '') + ')' : '') + (m ? ' — ' + kc(m.kcal) + ' kcal' : ''));
    const slot = (MEAL_TAGS.find(t => t[0] === (x.tag || x.slot)) || ['', ''])[1];
    return name === 'propose_meal'
      ? { title: x.name, kind: 'New meal · ' + slot, lines, total: 'Total: ' + line(tot), ok: 'Save meal' }
      : { title: 'Log to ' + slot.toLowerCase() + (x.date && x.date !== dayKey() ? ', ' + fmtShort(x.date) : ''), kind: 'Daily log', lines, total: 'Total: ' + line(tot), ok: 'Add to log' };
  }
  if (name === 'propose_routine') return { title: x.name, kind: 'New routine', lines: x.exercises.map(e => exById(e.exercise_id).n + ' · ' + (e.warmup_sets ? e.warmup_sets + 'W + ' : '') + (e.working_sets || 3) + ' sets'), ok: 'Save routine' };
}

/* ---------- Chat storage (device only) ---------- */
function loadChat(){ try { return JSON.parse(localStorage.getItem(CHAT_KEY)) || { messages: [], cards: {} }; } catch (e){ return { messages: [], cards: {} }; } }
function saveChat(c){ try { localStorage.setItem(CHAT_KEY, JSON.stringify(c)); return true; } catch (e){ return false; } }

/* Photos are shrunk before sending: smaller is cheaper and still sharp enough for labels */
function photoData(file){
  return new Promise((ok, fail) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(1, 1400 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.82).split(',')[1]); };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('That photo couldn’t be read.')); };
    img.src = url;
  });
}

/* ---------- UI ---------- */
export function AssistantButton({ onOpen, raised }){
  return html`<button class=${'ai-fab' + (raised ? ' raised' : '')} aria-label="Open assistant" onClick=${onOpen}><${Ico} d=${UI.spark} size=${24} sw=${2}/></button>`;
}

const SUGGEST = ['What should I eat for dinner to hit my targets?', 'Add a food from a photo of the label', 'Build me a push day routine', 'How did I do this week?'];

export function AssistantChat({ app, close }){
  const [chat, setChat] = useState(loadChat);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const endRef = useRef(null), fileRef = useRef(null), stopRef = useRef(null), inputRef = useRef(null);
  const chatRef = useRef(chat);
  const commit = next => { chatRef.current = next; setChat(next); if (!saveChat(next)) setNote('This chat is too big to keep after closing. Start a new chat soon.'); };
  useEffect(() => { endRef.current && endRef.current.scrollIntoView({ block: 'end' }); }, [chat, live, busy]);
  const [, setLibReady] = useState(0);
  useEffect(() => { loadLib().then(() => setLibReady(1)); }, []);
  useEffect(() => { document.body.classList.add('noscroll'); return () => document.body.classList.remove('noscroll'); }, []);

  const send = async raw => {
    const q = (raw != null ? raw : text).trim();
    if ((!q && !photos.length) || busy) return;
    setErr(''); setText(''); const pics = photos; setPhotos([]);
    const now = new Date().toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const content = pics.map(d => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d } }))
      .concat([{ type: 'text', text: '[' + now + '] ' + (q || 'Here is a photo.') }]);
    let msgs = chatRef.current.messages.concat([{ role: 'user', content }]);
    commit(Object.assign({}, chatRef.current, { messages: msgs }));
    setBusy(true);
    let Anthropic = null;
    try {
      const c = await claude(); Anthropic = c.Anthropic;
      const model = aiModel();
      for (let step = 0; step < MAX_STEPS; step++){
        const stream = c.client.beta.messages.stream(Object.assign({ model, max_tokens: 16000, system: SYSTEM, tools: TOOLS, messages: msgs, cache_control: { type: 'ephemeral' } }, fallbackParams(model)));
        stopRef.current = stream;
        stream.on('text', (_, snapshot) => setLive(snapshot));
        let msg;
        try { msg = await stream.finalMessage(); }
        catch (e){ if (e instanceof Anthropic.APIError || stream.aborted) throw e; continue; }   /* a tool input that didn't parse: ask again */
        setLive('');
        msgs = msgs.concat([{ role: 'assistant', content: msg.content }]);
        commit(Object.assign({}, chatRef.current, { messages: msgs }));
        if (msg.stop_reason === 'refusal'){ setErr('Claude declined to answer that one. Try asking another way.'); break; }
        if (msg.stop_reason === 'pause_turn') continue;
        if (msg.stop_reason === 'max_tokens'){ setErr('The answer got too long. Ask for something smaller.'); break; }
        const uses = msg.content.filter(b => b.type === 'tool_use');
        if (msg.stop_reason !== 'tool_use' || !uses.length) break;
        const results = [];
        for (const u of uses){
          try { results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(await runTool(u.name, u.input || {})) }); }
          catch (e){ results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: e.message || 'Tool failed' }); }
        }
        msgs = msgs.concat([{ role: 'user', content: results }]);
        commit(Object.assign({}, chatRef.current, { messages: msgs }));
      }
    } catch (e){
      if (!(stopRef.current && stopRef.current.aborted)) setErr(aiError(Anthropic, e));
    } finally { setBusy(false); setLive(''); stopRef.current = null; }
  };
  const stop = () => { try { stopRef.current && stopRef.current.abort(); } catch (e){} };
  const addPhotos = async e => {
    const files = Array.from(e.target.files || []).slice(0, 3 - photos.length); e.target.value = '';
    try { const d = await Promise.all(files.map(photoData)); setPhotos(photos.concat(d)); } catch (er){ setErr(er.message); }
  };
  const decide = (u, ok) => {
    let msg = 'Dismissed.';
    if (ok){ try { msg = confirmCard(u.name, u.input); } catch (e){ setErr('Couldn’t save that: ' + (e.message || 'unknown problem')); return; } }
    commit(Object.assign({}, chatRef.current, { cards: Object.assign({}, chatRef.current.cards, { [u.id]: ok ? 'saved' : 'dismissed' }) }));
  };
  const newChat = () => { if (busy) return; commit({ messages: [], cards: {} }); setErr(''); setNote(''); };

  /* tool results tell us which proposals were rejected by the checks */
  const failed = {};
  chat.messages.forEach(m => { if (m.role === 'user' && Array.isArray(m.content)) m.content.forEach(b => { if (b.type === 'tool_result' && b.is_error) failed[b.tool_use_id] = true; }); });
  const items = [];
  chat.messages.forEach((m, i) => {
    if (!Array.isArray(m.content)) return;
    if (m.role === 'user'){
      const pics = m.content.filter(b => b.type === 'image'), txt = m.content.filter(b => b.type === 'text').map(b => b.text.replace(/^\[[^\]]*\]\s*/, '')).join('\n');
      if (pics.length || txt) items.push(html`<div key=${'u' + i} class="bubble me">${pics.map((p, j) => html`<img key=${j} class="bubble-img" src=${'data:image/jpeg;base64,' + p.source.data} alt="Your photo"/>`)}${txt && html`<span>${txt}</span>`}</div>`);
      return;
    }
    m.content.forEach((b, j) => {
      if (b.type === 'text' && b.text.trim()) items.push(html`<div key=${'a' + i + '-' + j} class="bubble ai">${md(b.text)}</div>`);
      else if (b.type === 'tool_use' && b.name.startsWith('propose_') && !failed[b.id]){
        const v = cardView(b.name, b.input || {}); if (!v) return;
        const st = chat.cards[b.id];
        items.push(html`<div key=${'c' + b.id} class=${'ai-card' + (st ? ' ' + st : '')}>
          <span class="cat-sub">${v.kind}${v.badge && html` <span class=${'src src-' + (v.badge === 'usda' ? 'usda' : v.badge === 'label' ? 'off' : 'ai')}>${v.badge === 'usda' ? 'USDA' : v.badge === 'label' ? 'Label' : 'Estimate'}</span>`}</span>
          <b class="ai-card-t">${v.title}</b>
          ${v.lines.filter(Boolean).map((l, k) => html`<span key=${k} class="ai-card-l">${l}</span>`)}
          ${v.total && html`<span class="ai-card-total">${v.total}</span>`}
          ${st ? html`<span class=${'ai-card-st ' + st}>${st === 'saved' ? '✓ Saved' : 'Dismissed'}</span>`
            : html`<div class="btn-row two"><button class="btn btn-ghost sm" onClick=${() => decide(b, false)}>Dismiss</button><button class="btn btn-pop sm" onClick=${() => decide(b, true)}>${v.ok}</button></div>`}
        </div>`);
      }
    });
  });

  return html`<div class="scrim ai-scrim" onClick=${e => { if (e.target === e.currentTarget) close(); }}>
    <div class="sheet ai-sheet" role="dialog" aria-modal="true" aria-label="Assistant">
      <div class="ai-head">
        <span class="ai-mark"><${Ico} d=${UI.spark} size=${18} sw=${2}/></span><h2 class="grow">Assistant</h2>
        ${chat.messages.length > 0 && html`<button class="link" disabled=${busy} onClick=${newChat}>New chat</button>`}
        <button class="icon-btn" aria-label="Close assistant" onClick=${close}><${Ico} d=${UI.x}/></button>
      </div>
      <div class="ai-body">
        ${items.length === 0 && !busy && html`<div class="ai-empty">
          <p class="hint">Ask about your food, targets, weight or workouts. I can also add foods (from a description or a photo), build meals and routines, and log what you ate. You confirm everything before it’s saved.</p>
          ${SUGGEST.map(s => html`<button key=${s} class="row-btn" onClick=${() => s.startsWith('Add a food') ? fileRef.current && fileRef.current.click() : send(s)}>${s}</button>`)}
        </div>`}
        ${items}
        ${busy && html`<div class="bubble ai">${live ? md(live) : html`<span class="typing"><i></i><i></i><i></i></span>`}</div>`}
        ${err && html`<p class="status bad">${err}</p>`}
        ${note && html`<p class="hint">${note}</p>`}
        <div ref=${endRef}></div>
      </div>
      ${photos.length > 0 && html`<div class="ai-photos">${photos.map((p, i) => html`<span key=${i} class="ai-photo"><img src=${'data:image/jpeg;base64,' + p} alt="Photo to send"/><button aria-label="Remove photo" onClick=${() => setPhotos(photos.filter((_, j) => j !== i))}><${Ico} d=${UI.x} size=${14} sw=${3}/></button></span>`)}</div>`}
      <div class="ai-input">
        <button class="icon-btn" aria-label="Add a photo" disabled=${busy || photos.length >= 3} onClick=${() => fileRef.current && fileRef.current.click()}><${Ico} d=${UI.camera} size=${22}/></button>
        <textarea ref=${inputRef} rows="1" placeholder="Ask or tell me what to add…" value=${text} onInput=${e => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'; }}
          onKeyDown=${e => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(min-width:960px)').matches){ e.preventDefault(); send(); } }}></textarea>
        ${busy ? html`<button class="ai-send stop" aria-label="Stop" onClick=${stop}><span class="sq"></span></button>`
          : html`<button class="ai-send" aria-label="Send" disabled=${!text.trim() && !photos.length} onClick=${() => send()}><${Ico} d=${UI.up} size=${20} sw=${3}/></button>`}
        <input ref=${fileRef} type="file" accept="image/*" multiple hidden onChange=${addPhotos}/>
      </div>
    </div>
  </div>`;
}

/* Light formatting: paragraphs, "- " bullets and **bold** */
function md(t){
  const out = [], lines = t.split('\n');
  let list = null;
  const inline = s => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') && p.endsWith('**') ? html`<b key=${i}>${p.slice(2, -2)}</b>` : p);
  lines.forEach((l, i) => {
    const b = l.match(/^\s*[-•*]\s+(.*)/);
    if (b){ (list = list || []).push(html`<li key=${i}>${inline(b[1])}</li>`); return; }
    if (list){ out.push(html`<ul key=${'l' + i}>${list}</ul>`); list = null; }
    if (l.trim()) out.push(html`<p key=${i}>${inline(l.replace(/^#+\s*/, ''))}</p>`);
  });
  if (list) out.push(html`<ul key="lend">${list}</ul>`);
  return out;
}
