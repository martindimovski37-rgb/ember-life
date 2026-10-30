/* Ember's natural voice: Kokoro, an open-source voice model that runs on the iPhone itself. Free, works offline.
   This talks to the background worker in kokoro-worker.js. */

/* the better-sounding Kokoro voices, with Kokoro's own quality grades */
export const KOKORO_VOICES = [
  ['am_michael', 'Michael', 'American man, clear and calm'],
  ['am_fenrir', 'Fenrir', 'American man, deeper'],
  ['am_puck', 'Puck', 'American man, lively'],
  ['bm_george', 'George', 'British man, steady'],
  ['bm_fable', 'Fable', 'British man, warm'],
  ['af_heart', 'Heart', 'American woman, the most natural voice'],
  ['af_bella', 'Bella', 'American woman, bright'],
  ['af_nicole', 'Nicole', 'American woman, soft'],
  ['bf_emma', 'Emma', 'British woman, gentle']
];
const FLAG = 'ember-kokoro';
export const voiceDownloaded = () => { try { return localStorage.getItem(FLAG) === 'yes'; } catch (e){ return false; } };

let worker = null, ready = false, loading = null, nextId = 1;
const waiting = new Map(), watchers = new Set();
const files = {};   // download progress per file
const getWorker = () => {
  if (worker) return worker;
  worker = new Worker(new URL('./kokoro-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'progress'){ files[m.file] = [m.loaded, m.total]; const t = Object.values(files).reduce((a, [l, n]) => [a[0] + l, a[1] + n], [0, 0]); watchers.forEach(f => f(t[1] ? t[0] / t[1] : 0)); return; }
    const w = waiting.get(m.id); if (!w) return; waiting.delete(m.id);
    m.type === 'error' ? w.no(new Error(m.error)) : w.ok(m);
  };
  worker.onerror = e => { waiting.forEach(w => w.no(new Error(e.message || 'The voice stopped working.'))); waiting.clear(); worker = null; loading = null; ready = false; };
  return worker;
};
const ask = msg => new Promise((ok, no) => { const id = nextId++; waiting.set(id, { ok, no }); getWorker().postMessage(Object.assign({ id }, msg)); });

/* download (first time) or load from the phone (later); onProgress gets 0..1 while downloading */
export function loadVoice(onProgress){
  if (onProgress) watchers.add(onProgress);
  if (ready) return Promise.resolve();
  return loading || (loading = ask({ type: 'load' }).then(() => { ready = true; try { localStorage.setItem(FLAG, 'yes'); } catch (e){} },
    e => { loading = null; throw new Error(/fetch|network|Failed/i.test(e.message) ? 'The voice couldn’t be downloaded. Check your connection and try again.' : 'The voice couldn’t start: ' + e.message); })
    .finally(() => { if (onProgress) watchers.delete(onProgress); }));
}
/* text to sound: resolves with { audio: Float32Array, rate } */
export const kokoroSpeak = (text, voice) => loadVoice().then(() => ask({ type: 'speak', text, voice }));
export const voiceLoaded = () => ready;

/* free the space again */
export async function removeVoice(){
  try { worker && worker.terminate(); } catch (e){}
  worker = null; ready = false; loading = null;
  try { localStorage.removeItem(FLAG); } catch (e){}
  try { await caches.delete('transformers-cache'); } catch (e){}
}
