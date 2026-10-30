/* Ember, the assistant: reads your Ember Life data and adds foods, meals, log entries and routines.
   It says what it is about to do, saves it straight away, and every change can be undone from the chat.
   The conversation lives on this device only (it can hold photos), and is only ever appended to. */
import { html, uid, dayKey, fmtShort, plural } from './lib.js';
import { store } from './store.js';
import { claude, aiModel, fallbackParams, aiError } from './claude.js';
import { foodMap, mealTotals, entryMacros, addUp, getTargets, targetsFor, goalFor, maintenance, latestWeight, dayTotals, usdaSearch, MEAL_TAGS, kc, g1 } from './diet.js';
import { loadLib, allExercises, rank, exById, workoutsList, workedOutOn, normRoutine } from './gym.js';

const CHAT_KEY = 'ember-life-chat';
const MAX_STEPS = 10;

const SYSTEM = `You are Ember, the assistant inside Ember Life, a personal app that combines a day planner, a diet tracker (food library per 100 g, saved meals, a daily log, calorie and macro targets, weigh-ins) and a gym tracker (exercise library, routines, workout history).

How to work:
- Look things up with the tools before answering questions about the user's data. Never guess their targets, foods, meals, weight or workouts.
- Units are metric: grams, kg, kcal. Food values are per 100 g.
- For nutrition values, use the user's own foods first, then usda_lookup. Only estimate when neither has it, and say clearly that it is an estimate.
- To create anything (a food, a meal, a log entry, a routine), call the matching propose_ tool. It is saved straight away and the user can undo it from the chat.
- Before calling a propose_ tool, first write one short sentence saying what you are about to do, like "Adding four eggs to your breakfast now." After it is saved, confirm in a sentence or two with the key numbers (calories, protein, what is left today).
- If you are unsure what the user means (which meal, how much), ask before adding anything.
- When recommending portions of meat, fish, rice, pasta, potatoes or similar, give the weight the way their food is stored (raw or cooked, per the food library), and also give the other one when it helps (for example "200 g raw chicken, about 150 g cooked").
- Photos: if it's a nutrition label, read the exact values and convert them to per 100 g. If it's a plate of food, identify the foods, look them up, estimate the portions and say the portions are estimates. If it's a package front without a label, ask for a photo of the nutrition table or suggest the barcode scanner in Diet → Foods.
- When proposing a meal or a day of eating, keep the totals close to the user's targets and mention how they compare.
- For routines, use search_exercises to find real exercise ids.
- When the user is talking to you out loud, your reply is read aloud: answer in one to three short sentences, no lists, no markdown, numbers written plainly, no emoji. Never mention how the message arrived.
- When the user typed instead, keep answers short and easy to read on a phone: plain sentences and short "- " bullet lists, no tables, no headings.`;

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
  T('propose_food', 'Add a food to the user\'s library (saved straight away, can be undone). Values per 100 g.', {
    name: { type: 'string' }, brand: { type: 'string' }, state: { type: 'string', enum: ['raw', 'cooked', ''] },
    kcal: NUTR.kcal, protein: NUTR.protein, carbs: NUTR.carbs, fat: NUTR.fat,
    source: { type: 'string', enum: ['usda', 'label', 'estimate'], description: 'usda = from usda_lookup, label = read from a nutrition label, estimate = your estimate' }
  }, ['name', 'state', 'kcal', 'protein', 'carbs', 'fat', 'source']),
  T('propose_meal', 'Save a meal (foods with weights; saved straight away, can be undone). Use food_id for foods already in the library; give new_food for foods that are not.', {
    name: { type: 'string' }, tag: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
    items: { type: 'array', items: { type: 'object', properties: { food_id: { type: 'string' }, name: { type: 'string' }, grams: { type: 'number' },
      new_food: { type: 'object', properties: { state: { type: 'string', enum: ['raw', 'cooked', ''] }, kcal: NUTR.kcal, protein: NUTR.protein, carbs: NUTR.carbs, fat: NUTR.fat, source: { type: 'string', enum: ['usda', 'label', 'estimate'] } } } }, required: ['name', 'grams'] } }
  }, ['name', 'tag', 'items']),
  T('propose_log', 'Add items to the daily log (saved straight away, can be undone). Each item is a saved meal (meal_id + portions) or a food (food_id or new_food + grams).', {
    date: { type: 'string', description: 'YYYY-MM-DD, default today' }, slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
    items: { type: 'array', items: { type: 'object', properties: { meal_id: { type: 'string' }, portions: { type: 'number' }, food_id: { type: 'string' }, name: { type: 'string' }, grams: { type: 'number' },
      new_food: { type: 'object', properties: { state: { type: 'string', enum: ['raw', 'cooked', ''] }, kcal: NUTR.kcal, protein: NUTR.protein, carbs: NUTR.carbs, fat: NUTR.fat, source: { type: 'string', enum: ['usda', 'label', 'estimate'] } } } }, required: ['name'] } }
  }, ['slot', 'items']),
  T('propose_routine', 'Save a gym routine (saved straight away, can be undone). exercise_id must come from search_exercises.', {
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
  return 'ok';
}

/* Saving a proposal. Returns a message for Claude and what was created, so it can be undone. */
const SRC = { usda: 'usda', label: 'manual', estimate: 'ai' };
function applyCard(name, x){
  const made = { foods: [], meals: [], routines: [], log: null };
  const makeFood = (fname, f) => {
    const id = uid(); made.foods.push(id);
    store.set('foods/' + id, { id, name: fname.trim(), brand: (f.brand || '').trim(), state: f.state || '', kcal: r1(f.kcal), p: r1(f.protein), c: r1(f.carbs), fat: r1(f.fat), source: SRC[f.source] || 'ai', ref: '', barcode: '', createdAt: Date.now() });
    return store.get('foods/' + id);
  };
  let msg = '';
  if (name === 'propose_food') msg = makeFood(x.name, x).name + ' added to your foods.';
  if (name === 'propose_meal'){
    const items = x.items.map(it => ({ id: uid(), foodId: it.food_id || makeFood(it.name, it.new_food).id, g: it.grams }));
    const id = uid(); made.meals.push(id); store.set('meals/' + id, { id, name: x.name.trim(), tag: x.tag, items, createdAt: Date.now() });
    msg = x.name + ' saved to your meals.';
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
    made.log = { date, ids: entries.map(e => e.id) };
    const t = dayTotals(date), tg = targetsFor(date);
    msg = plural(entries.length, 'item', 'items') + ' added to ' + (date === dayKey() ? 'today' : fmtShort(date)) + '. Day total now ' + Math.round(t.kcal) + ' kcal, ' + r1(t.p) + ' g protein' + (tg.kcal ? '; ' + Math.round(tg.kcal - t.kcal) + ' kcal and ' + r1(tg.p - t.p) + ' g protein left.' : '.');
  }
  if (name === 'propose_routine'){
    const id = uid(); made.routines.push(id);
    store.set('routines/' + id, normRoutine({ id, name: x.name.trim(), items: x.exercises.map(e => ({ ex: e.exercise_id, warm: Math.max(0, e.warmup_sets || 0), sets: Math.max(1, e.working_sets || 3), rest: isNum(e.rest_seconds) ? e.rest_seconds : 90 })) }));
    msg = x.name + ' saved to your routines.';
  }
  return { msg, made };
}
/* Undo removes exactly what that change created */
function undoCard(made){
  if (!made) return;
  if (made.log){ const log = store.get('log/' + made.log.date); if (log) store.set('log/' + made.log.date, Object.assign({}, log, { entries: log.entries.filter(e => !made.log.ids.includes(e.id)) })); }
  made.meals.forEach(id => store.del('meals/' + id));
  made.routines.forEach(id => store.del('routines/' + id));
  made.foods.forEach(id => store.del('foods/' + id));
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
function loadChat(){ try { return JSON.parse(localStorage.getItem(CHAT_KEY)) || { messages: [], cards: {}, undo: {} }; } catch (e){ return { messages: [], cards: {}, undo: {} }; } }
function saveChat(c){ try { localStorage.setItem(CHAT_KEY, JSON.stringify(c)); return true; } catch (e){ return false; } }

/* Photos are shrunk before sending: smaller is cheaper and still sharp enough for labels */
export function photoData(file){
  return new Promise((ok, fail) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(1, 1400 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.82).split(',')[1]); };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('That photo couldn’t be read.')); };
    img.src = url;
  });
}

/* ---------- The engine: one request, with Claude calling tools until it has answered ---------- */
export const emberChat = {
  load: loadChat,
  undo(id){ const c = loadChat(); undoCard((c.undo || {})[id]); c.cards = Object.assign({}, c.cards, { [id]: 'undone' }); saveChat(c); return c; },
  clear(){ const c = { messages: [], cards: {}, undo: {} }; saveChat(c); return c; }
};
/* What to show for a change in the chat: a short title and the totals */
export function actionLine(u){
  const v = cardView(u.name, u.input || {});
  return v ? { title: v.kind === 'Daily log' ? v.title.replace(/^Log to /, 'Added to ') : v.kind + ': ' + v.title, detail: v.total ? v.total.replace(/^Total: /, '') : v.lines.filter(Boolean)[0] || '' } : null;
}
/* text: what the user said or typed. spoken: true when it came from the voice.
   say(text) is called with each finished sentence of Ember's reply as soon as it's written, so speaking starts right away.
   live(text) streams the reply as it is written. changed(chat) after every step. Returns a stop function via onStop. */
export async function askEmber({ text, photos = [], spoken, say, live, changed, onStop, test }){
  const now = new Date().toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const content = photos.map(d => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d } }))
    .concat([{ type: 'text', text: '[' + now + '] ' + (text || 'Here is a photo.') }]);
  // test: a one-off question for the voice test, with no history and nothing saved
  let chat = test ? { messages: [], cards: {}, undo: {} } : loadChat(); chat.undo = chat.undo || {};
  const commit = () => { if (!test) saveChat(chat); changed && changed(chat); };
  let msgs = chat.messages.concat([{ role: 'user', content }]);
  chat = Object.assign({}, chat, { messages: msgs }); commit();
  const c = await claude(), Anthropic = c.Anthropic;
  // talking needs quick answers: Opus is swapped for the faster Sonnet when the request was spoken
  const model = spoken && aiModel() === 'claude-opus-5-5' ? 'claude-sonnet-5-5' : aiModel();
  // whether the message was spoken goes in a second system block, so the main one stays cached and nothing leaks into the chat
  const system = [{ type: 'text', text: SYSTEM }, { type: 'text', text: spoken ? 'The user is talking to you out loud right now. Reply for listening: one to three short spoken sentences.' : 'The user typed this message.' }];
  let stopped = false, stream = null;
  onStop && onStop(() => { stopped = true; try { stream && stream.abort(); } catch (e){} });
  try {
    for (let step = 0; step < MAX_STEPS && !stopped; step++){
      stream = c.client.beta.messages.stream(Object.assign({ model, max_tokens: 16000, system, tools: TOOLS, messages: msgs, cache_control: { type: 'ephemeral' } }, fallbackParams(model)));
      // hand over each sentence the moment it's complete
      let acc = '', said = 0;
      const flush = all => {
        const rest = acc.slice(said); let end = -1;
        if (all) end = rest.length; else { const m = [...rest.matchAll(/[.!?…]["')\]]?(?=\s)|\n/g)].pop(); if (m) end = m.index + m[0].length; }
        if (end > 0){ const piece = rest.slice(0, end).trim(); said += end; if (piece && say) say(piece); }
      };
      stream.on('text', (delta, snapshot) => { live && live(snapshot); acc += delta; flush(false); });
      let msg;
      try { msg = await stream.finalMessage(); }
      catch (e){ if (e instanceof Anthropic.APIError || stream.aborted || stopped) throw e; continue; }   /* a tool input that didn't parse: ask again */
      live && live('');
      msgs = msgs.concat([{ role: 'assistant', content: msg.content }]);
      chat = Object.assign({}, chat, { messages: msgs }); commit();
      flush(true);
      if (msg.stop_reason === 'refusal') throw new Error('Ember declined to answer that one. Try asking another way.');
      if (msg.stop_reason === 'pause_turn') continue;
      if (msg.stop_reason === 'max_tokens') throw new Error('The answer got too long. Ask for something smaller.');
      const uses = msg.content.filter(b => b.type === 'tool_use');
      if (msg.stop_reason !== 'tool_use' || !uses.length) break;
      const results = [];
      for (const u of uses){
        try {
          let out = await runTool(u.name, u.input || {});
          if (u.name.startsWith('propose_') && test) out = 'This is only a test, so nothing was saved. Tell the user it would have been added.';
          else if (u.name.startsWith('propose_')){
            const r = applyCard(u.name, u.input);
            chat.cards = Object.assign({}, chat.cards, { [u.id]: 'saved' }); chat.undo = Object.assign({}, chat.undo, { [u.id]: r.made });
            out = 'Saved. ' + r.msg + ' It shows in the chat with an Undo button.';
          }
          results.push({ type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : JSON.stringify(out) });
        }
        catch (e){ results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: e.message || 'Tool failed' }); }
      }
      msgs = msgs.concat([{ role: 'user', content: results }]);
      chat = Object.assign({}, chat, { messages: msgs }); commit();
    }
  } catch (e){
    if (stopped) return;
    throw new Error(e && e.message && !(e instanceof Anthropic.APIError) ? e.message : aiError(Anthropic, e));
  }
}

/* Light formatting: paragraphs, "- " bullets and **bold** */
export function md(t){
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
