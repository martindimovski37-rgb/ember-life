/* Kokoro runs here, in the background, so making speech never freezes the screen.
   The library and its speech engine ship with the app; the voice model (about 90 MB) is downloaded once from
   Hugging Face and kept on the phone by the library's own cache. */
import { KokoroTTS, env } from '../vendor/kokoro/kokoro.web.js';

env.wasmPaths = new URL('../vendor/kokoro/', import.meta.url).href;
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let tts = null, loading = null;

const load = () => loading || (loading = KokoroTTS.from_pretrained(MODEL, {
  dtype: 'q8', device: 'wasm',
  progress_callback: p => { if (p.status === 'progress' && p.total > 1e6) postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total }); }
}).then(t => { tts = t; return t; }, e => { loading = null; throw e; }));

/* one message at a time, in order, so sentences come back in the order they were asked for */
let chain = Promise.resolve();
onmessage = e => {
  const m = e.data;
  chain = chain.then(async () => {
    try {
      if (m.type === 'load'){ await load(); postMessage({ type: 'ready', id: m.id }); }
      if (m.type === 'speak'){
        await load();
        const out = await tts.generate(m.text, { voice: m.voice, speed: m.speed || 1 });
        postMessage({ type: 'audio', id: m.id, audio: out.audio, rate: out.sampling_rate }, [out.audio.buffer]);
      }
    } catch (err){ postMessage({ type: 'error', id: m.id, error: String(err && err.message || err) }); }
  });
};
