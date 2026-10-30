/* Kokoro runs here, in the background, so making speech never freezes the screen.
   The library and its speech engine ship with the app; the voice model is downloaded once from Hugging Face and kept
   on the phone by the library's own cache. On the graphics chip ('gpu') it uses the full model (about 326 MB), which is
   several times faster than real time; otherwise ('cpu') the small 92 MB model, which is slower. */
import { KokoroTTS, env } from '../vendor/kokoro/kokoro.web.js';

env.wasmPaths = new URL('../vendor/kokoro/', import.meta.url).href;
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let tts = null, loading = null;

const load = kind => loading || (loading = KokoroTTS.from_pretrained(MODEL, {
  dtype: kind === 'gpu' ? 'fp32' : 'q8', device: kind === 'gpu' ? 'webgpu' : 'wasm',
  progress_callback: p => { if (p.status === 'progress' && p.total > 1e6) postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total }); }
}).then(t => { tts = t; return t; }, e => { loading = null; throw e; }));

/* one message at a time, in order, so sentences come back in the order they were asked for */
let chain = Promise.resolve();
onmessage = e => {
  const m = e.data;
  chain = chain.then(async () => {
    try {
      if (m.type === 'load'){ await load(m.kind); postMessage({ type: 'ready', id: m.id }); }
      if (m.type === 'speak'){
        await load(m.kind);
        const out = await tts.generate(m.text, { voice: m.voice, speed: m.speed || 1 });
        if (Number.isNaN(out.audio[out.audio.length >> 1]) || Number.isNaN(out.audio[0])) throw new Error('bad-audio');
        postMessage({ type: 'audio', id: m.id, audio: out.audio, rate: out.sampling_rate }, [out.audio.buffer]);
      }
    } catch (err){ postMessage({ type: 'error', id: m.id, error: String(err && err.message || err) }); }
  });
};
