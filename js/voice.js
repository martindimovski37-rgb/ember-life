/* Ember's voice and ears.
   Speaking: ElevenLabs when a key is saved (natural voice, and its loudness drives the orb), otherwise the built-in iPhone voice.
   Listening: the browser's own speech recognition when it works; otherwise the mic is recorded whenever you speak
   and ElevenLabs turns it into text (this also works in the home-screen app, where speech recognition is often blocked). */
import { store, deviceGet } from './store.js';

export const VOICES = [
  ['onwK4e9ZLuTAKqWW03F9', 'Daniel', 'British, calm and steady'],
  ['nPczCjzI2devNBz1zQrb', 'Brian', 'Deep and warm'],
  ['JBFqnCBsd6RMkjVDRZzb', 'George', 'British, warm storyteller'],
  ['device', 'iPhone voice', 'Free and offline, but robotic']
];
export const emberVoice = () => (store.get('settings/app') || {}).emberVoice || VOICES[0][0];
const elevenKey = () => String(deviceGet().elevenKey || '').replace(/[\s​-‍﻿]+/g, '');

/* one shared audio context: it has to be started from a tap on iPhone */
let ctx = null, analyser = null, buf = null;
export function unlockAudio(){
  try {
    if (!ctx){ ctx = new (window.AudioContext || window.webkitAudioContext)(); analyser = ctx.createAnalyser(); analyser.fftSize = 512; analyser.connect(ctx.destination); buf = new Uint8Array(analyser.fftSize); }
    if (ctx.state !== 'running') ctx.resume();
    const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0);
  } catch (e){}
}
const rms = (an, b) => { an.getByteTimeDomainData(b); let sum = 0; for (let i = 0; i < b.length; i++){ const v = (b[i] - 128) / 128; sum += v * v; } return Math.sqrt(sum / b.length); };

/* text read aloud: no markdown, lists become sentences, never the "(spoken)" tag or a timestamp */
export const speakable = t => String(t || '').replace(/\*\*/g, '').replace(/\[[^\]]*\]/g, '').replace(/\((spoken|typed)\)/gi, '').replace(/^\s*[-•*]\s+/gm, '').replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
/* split into pieces short enough to show as one subtitle: sentences, and long sentences at commas */
export function pieces(t){
  const out = [];
  speakable(t).split(/(?<=[.!?…]["')\]]?)\s+/).forEach(sn => {
    let x = sn.trim();
    while (x.length > 110){ const soft = Math.max(x.lastIndexOf(', ', 100), x.lastIndexOf('; ', 100)), cut = soft > 40 ? soft : x.lastIndexOf(' ', 100); out.push(x.slice(0, cut + 1).trim()); x = x.slice(cut + 1).trim(); }
    if (x) out.push(x);
  });
  return out;
}

/* ---------- speaking: each piece is fetched as soon as it's ready and played in order, without gaps ---------- */
export function createMouth({ onSpeaking, onPiece, onError } = {}){
  const queue = []; let playing = false, current = null, gen = 0, deviceTalking = false, wordAt = 0, warned = false;
  const useEleven = () => emberVoice() !== 'device' && !!elevenKey() && !!ctx;
  const fetchAudio = text => fetch('https://api.elevenlabs.io/v1/text-to-speech/' + emberVoice() + '?output_format=mp3_44100_128', {
    method: 'POST', headers: { 'xi-api-key': elevenKey(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', voice_settings: { stability: .5, similarity_boost: .75 } })
  }).then(r => { if (!r.ok) throw new Error(r.status === 401 ? 'ElevenLabs rejected the key.' : r.status === 402 || r.status === 429 ? 'ElevenLabs credits or limit reached.' : 'ElevenLabs had a problem (' + r.status + ').'); return r.arrayBuffer(); })
    .then(b => ctx.decodeAudioData(b));
  const viaDevice = text => new Promise(res => {
    if (!('speechSynthesis' in window)) return res();
    const u = new SpeechSynthesisUtterance(text); u.rate = 1.04; u.pitch = .9;
    const en = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
    u.voice = en.find(v => /Daniel|Arthur|Oliver/i.test(v.name)) || en[0] || null;
    u.onboundary = () => { wordAt = performance.now(); };
    deviceTalking = true; wordAt = performance.now(); u.onend = u.onerror = () => { deviceTalking = false; res(); };
    speechSynthesis.speak(u);
  });
  const playBuffer = (audio, my) => new Promise(res => { if (my !== gen) return res(); const s = ctx.createBufferSource(); s.buffer = audio; s.connect(analyser); s.onended = res; current = s; s.start(0); });
  const next = async () => {
    if (playing) return;
    if (!queue.length){ onSpeaking && onSpeaking(false); return; }
    playing = true; onSpeaking && onSpeaking(true);
    const item = queue.shift(), my = gen;
    onPiece && onPiece(item.text);
    try {
      if (item.audio) await playBuffer(await item.audio, my);
      else await viaDevice(item.text);
    } catch (e){
      if (!warned){ warned = true; onError && onError(e.message + ' Using the iPhone voice for now.'); }
      if (my === gen) await viaDevice(item.text);
    }
    current = null;
    if (my !== gen) return;
    playing = false; next();
  };
  return {
    say(text){ pieces(text).forEach(t => { const item = { text: t, audio: useEleven() ? fetchAudio(t) : null }; if (item.audio) item.audio.catch(() => {}); queue.push(item); }); next(); },
    stop(){ gen++; queue.length = 0; try { current && current.stop(); } catch (e){} try { speechSynthesis.cancel(); } catch (e){} playing = false; current = null; deviceTalking = false; onSpeaking && onSpeaking(false); },
    busy: () => playing || queue.length > 0,
    /* how loud Ember is right now: the real sound with ElevenLabs; with the iPhone voice, a pulse on every word */
    level: () => current && analyser ? Math.min(1, rms(analyser, buf) * 4.5) : deviceTalking ? .3 + .7 * Math.max(0, 1 - (performance.now() - wordAt) / 260) : 0
  };
}

/* ---------- listening ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = () => !!SR || (!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && !!window.MediaRecorder && !!elevenKey());

/* onWords(text) while you talk, onHeard(text) when you've finished a sentence, onError(message) */
export function createEars({ onWords, onHeard, onError }){
  let on = false, held = false, mode = SR ? 'native' : 'record', rec = null, heard = '', timer = 0, bump = 0;
  // the recorder fallback
  let stream = null, micAn = null, micBuf = null, mr = null, chunks = [], loud = 0, quietSince = 0, poll = 0, startedAt = 0;

  const finish = t => { clearTimeout(timer); heard = ''; const s = t.trim(); if (s) onHeard(s); };
  const startNative = () => {
    rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
    rec.onresult = e => {
      bump = performance.now(); let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++){ const r = e.results[i]; if (r.isFinal) heard += r[0].transcript + ' '; else interim += r[0].transcript; }
      onWords((heard + interim).trim());
      clearTimeout(timer); timer = setTimeout(() => finish(heard + interim), interim ? 1100 : 650);
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if ((e.error === 'service-not-allowed' || e.error === 'not-allowed' || e.error === 'network') && navigator.mediaDevices && window.MediaRecorder && elevenKey()){ mode = 'record'; rec = null; startRecord(); return; }
      on = false; onError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Ember isn’t allowed to listen here. Allow the microphone, or add an ElevenLabs key in Settings so Ember can listen another way.' : 'Listening stopped (' + e.error + '). Tap the mic to try again.');
    };
    rec.onend = () => { if (on && !held && mode === 'native') setTimeout(() => { if (on && !held && mode === 'native') try { rec.start(); } catch (er){} }, 250); };
    try { rec.start(); } catch (e){}
  };
  const transcribe = async blob => {
    const fd = new FormData(); fd.append('file', blob, 'speech.' + (blob.type.includes('mp4') ? 'm4a' : 'webm')); fd.append('model_id', 'scribe_v1');
    const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': elevenKey() }, body: fd });
    if (!r.ok) throw new Error('Couldn’t understand that (' + r.status + ').');
    return ((await r.json()).text || '').replace(/\(.*?\)/g, '').trim();
  };
  const startRecord = async () => {
    try {
      if (!stream){
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        unlockAudio(); micAn = ctx.createAnalyser(); micAn.fftSize = 512; micBuf = new Uint8Array(512); ctx.createMediaStreamSource(stream).connect(micAn);
      }
    } catch (e){ on = false; onError('Ember can’t use the microphone. Allow it in your iPhone settings and try again.'); return; }
    clearInterval(poll);
    poll = setInterval(() => {
      if (!on || held) return;
      loud = rms(micAn, micBuf); const now = performance.now();
      if (loud > .035){ quietSince = 0; bump = now;
        if (!mr){ chunks = []; mr = new MediaRecorder(stream); mr.ondataavailable = e => e.data.size && chunks.push(e.data); startedAt = now;
          mr.onstop = async () => { const long = performance.now() - startedAt > 600, blob = new Blob(chunks, { type: mr.mimeType || 'audio/mp4' }); mr = null;
            if (!long || !on) return; onWords('…'); try { finish(await transcribe(blob)); } catch (er){ onWords(''); onError(er.message); } };
          mr.start(); onWords('…'); }
      } else if (mr){ if (!quietSince) quietSince = now; else if (now - quietSince > 700) mr.stop(); }
    }, 60);
  };
  return {
    start(){ if (on) return; on = true; held = false; if (mode === 'native') startNative(); else startRecord(); },
    stop(){ on = false; clearTimeout(timer); heard = ''; clearInterval(poll); try { rec && rec.abort(); } catch (e){} rec = null; try { mr && mr.state !== 'inactive' && mr.stop(); } catch (e){} mr = null; if (stream){ stream.getTracks().forEach(t => t.stop()); stream = null; } },
    /* while Ember is talking it stops listening, so it doesn't hear itself */
    hold(h){ if (!on || held === h) return; held = h; if (mode === 'native'){ if (h){ try { rec && rec.abort(); } catch (e){} } else startNative(); } else if (h && mr){ try { mr.stop(); } catch (e){} } },
    level: () => mode === 'record' && micAn && on ? Math.min(1, loud * 6) : Math.max(0, 1 - (performance.now() - bump) / 500) * .7,
    get on(){ return on; }
  };
}
