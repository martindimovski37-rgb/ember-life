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
const FLAG = 'ember-kokoro', NOGPU = 'ember-kokoro-nogpu';
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e){ return null; } };
/* which version this phone can run: the fast one on the graphics chip, or the small one */
export const bestKind = () => ('gpu' in navigator) && ls(NOGPU) !== 'yes' ? 'gpu' : 'cpu';
export const downloadSize = kind => (kind || bestKind()) === 'gpu' ? '326 MB' : '92 MB';
/* which version is downloaded ('gpu' or 'cpu'), or '' for none; older downloads were the small one */
export const downloadedKind = () => { const v = ls(FLAG); return v === 'gpu' ? 'gpu' : v === 'cpu' || v === 'yes' ? 'cpu' : ''; };
export const voiceDownloaded = () => !!downloadedKind();

let worker = null, ready = false, loading = null, nextId = 1, kind = '';
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

/* if the graphics chip version fails here, never try it again on this phone and use the small one */
function dropGpu(){ ls(NOGPU, 'yes'); try { worker && worker.terminate(); } catch (e){} worker = null; ready = false; loading = null; if (downloadedKind() === 'gpu') ls(FLAG, null); }

/* download (first time) or load from the phone (later); want: 'gpu' or 'cpu' (default: what's downloaded, or the best);
   onProgress gets 0..1 while downloading */
export function loadVoice(onProgress, want){
  if (onProgress) watchers.add(onProgress);
  const k = want || downloadedKind() || bestKind();
  if (ready && k === kind) return Promise.resolve();
  if (ready || (loading && k !== kind)){ try { worker && worker.terminate(); } catch (e){} worker = null; ready = false; loading = null; }
  kind = k;
  return loading || (loading = ask({ type: 'load', kind: k }).then(() => { ready = true; ls(FLAG, k); },
    e => {
      loading = null;
      if (k === 'gpu'){ dropGpu(); return loadVoice(onProgress, 'cpu'); }   // no graphics chip support: fall back to the small version
      throw new Error(/fetch|network|Failed/i.test(e.message) ? 'The voice couldn’t be downloaded. Check your connection and try again.' : 'The voice couldn’t start: ' + e.message);
    })
    .finally(() => { if (onProgress) watchers.delete(onProgress); }));
}
/* text to sound: resolves with { audio: Float32Array, rate } */
export const kokoroSpeak = (text, voice) => loadVoice().then(() => ask({ type: 'speak', text, voice, kind }))
  .catch(e => { if (kind === 'gpu' && /bad-audio|webgpu|GPU/i.test(e.message)){ dropGpu(); return loadVoice(null, 'cpu').then(() => ask({ type: 'speak', text, voice, kind })); } throw e; });
/* drop every sentence still waiting to be made (the answer they belonged to was dropped) */
export function cancelSpeech(){ if (worker) worker.postMessage({ type: 'cancel', upTo: nextId - 1 }); }
export const voiceLoaded = () => ready;
export const voiceKind = () => kind;

/* free the space again */
export async function removeVoice(){
  try { worker && worker.terminate(); } catch (e){}
  worker = null; ready = false; loading = null; kind = '';
  ls(FLAG, null);
  try { await caches.delete('transformers-cache'); } catch (e){}
}
