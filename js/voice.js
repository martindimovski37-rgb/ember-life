/* Ember's voice and ears, for a hands-free conversation like voice mode in the Claude app:
   you talk, Ember waits until you've finished, answers out loud, and goes back to listening by itself.
   You can cut Ember off by talking (or tapping); it never cuts you off.
   Speaking: Kokoro on the iPhone when it's fast enough there, otherwise the best built-in iPhone voice.
   Listening: the iPhone's own speech recognition. Everything is written to a log (Ember chat → Log). */
import { store } from './store.js';
import { KOKORO_VOICES, voiceDownloaded, kokoroSpeak, voiceLoaded, loadVoice, voiceKind, cancelSpeech } from './kokoro.js';

export const VOICES = KOKORO_VOICES.concat([['device', 'iPhone voice', 'Built in, works without the download, but robotic']]);
export const emberVoice = () => { const v = (store.get('settings/app') || {}).emberVoice; return VOICES.some(x => x[0] === v) ? v : 'am_michael'; };

/* iPhone only lets a page make sound after a tap. Every tap on the mic (or the orb) calls this,
   which wakes the audio player and speaks a silent word, so Ember's voice is allowed later on. */
let ctx = null, analyser = null, buf = null;
export function unlockAudio(){
  try { if ('speechSynthesis' in window && !speechSynthesis.speaking){ const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e){}
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

/* the iPhone voice: the best English voice installed, preferring the high-quality ("Premium"/"Enhanced") downloads */
export function bestDeviceVoice(){
  if (!('speechSynthesis' in window)) return null;
  const en = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
  const score = v => (/premium/i.test(v.name) ? 40 : /enhanced/i.test(v.name) ? 30 : 0) + (/Daniel|Arthur|Jamie|Oliver|Malcolm/i.test(v.name) ? 10 : 0) + (/en-GB/i.test(v.lang) ? 3 : 0) + (v.localService ? 1 : 0);
  return en.sort((a, b) => score(b) - score(a))[0] || null;
}

/* ---------- the diagnostic log: what happened, with times, so problems on the phone can be seen ---------- */
const LOG = [], logSubs = new Set();
export function elog(msg){
  const d = new Date();
  LOG.push(d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0').slice(0, 1) + '  ' + msg);
  if (LOG.length > 400) LOG.shift();
  logSubs.forEach(f => f());
}
export const emberLog = () => LOG.join('\n');
export const watchLog = f => { logSubs.add(f); return () => logSubs.delete(f); };
const short = t => { t = String(t || ''); return t.length > 60 ? t.slice(0, 57) + '…' : t; };

/* how fast Kokoro makes speech on this phone: seconds of work per second of speech (below 1 = faster than talking) */
const RTF = 'ember-kokoro-speed';
export const kokoroSpeed = () => { try { const v = JSON.parse(localStorage.getItem(RTF) || 'null'); return v && v.kind === voiceKind() ? v.rtf : null; } catch (e){ return null; } };
const noteSpeed = rtf => { const old = kokoroSpeed(), v = old == null ? rtf : old * .6 + rtf * .4; try { localStorage.setItem(RTF, JSON.stringify({ kind: voiceKind(), rtf: v })); } catch (e){} return v; };
/* Kokoro is used in conversations only when it keeps up with talking; otherwise the iPhone voice, so Ember is never late */
export const kokoroKeepsUp = () => { const r = kokoroSpeed(); return r == null || r < .85; };

/* ---------- speaking ----------
   One answer is one "turn": each sentence is made and played in order. A new turn throws away whatever was left of the
   last one, so Ember is never a question behind. Nothing can wait forever: slow sentences switch to the iPhone voice. */
export function createMouth({ onSpeaking, onPiece, onError, onBlocked, onEngine, onTrace, gate, preview } = {}){
  const trace = (ev, d) => { onTrace && onTrace(ev, d); };
  let queue = [], playing = false, current = null, gen = 0, deviceTalking = false, wordAt = 0, blocked = false, engine = '', gated = false;
  // which voice this turn uses: Kokoro if it's running and keeps up here (always, for a preview in Settings), else the iPhone voice
  const pick = () => {
    if (emberVoice() === 'device' || !voiceDownloaded() || !ctx){ engine = 'device'; return; }
    if (!voiceLoaded()){ loadVoice().catch(() => {}); engine = 'device'; elog('voice: Kokoro still starting up, using the iPhone voice'); return; }
    engine = preview || kokoroKeepsUp() ? 'kokoro' : 'device';
    if (engine === 'device') elog('voice: Kokoro is too slow on this phone (' + kokoroSpeed().toFixed(2) + '× real time), using the iPhone voice');
  };
  const makeAudio = text => {
    const t0 = performance.now();
    return kokoroSpeak(text, emberVoice()).then(({ audio, rate, work }) => {
      const b = ctx.createBuffer(1, audio.length, rate); b.copyToChannel(audio, 0);
      // speed is measured on the work itself, not the time spent waiting behind other sentences
      const ms = performance.now() - t0, r = noteSpeed((work || ms) / 1000 / b.duration);
      trace('made', { text, ms, sec: b.duration }); elog(`kokoro made ${b.duration.toFixed(1)}s in ${((work || ms) / 1000).toFixed(1)}s of work (speed now ${r.toFixed(2)}×)`);
      return b;
    });
  };
  // the iPhone voice; if iPhone blocks it, it never starts and never reports back, so give up after a moment instead of freezing
  const viaDevice = text => new Promise(res => {
    if (!('speechSynthesis' in window)) return res();
    if (blocked) return setTimeout(res, 600 + text.length * 45);   // blocked this turn: just give time to read the subtitle
    let started = false, over = false;
    const fin = () => { if (over) return; over = true; deviceTalking = false; trace('device-end', { started }); res(); };
    const u = new SpeechSynthesisUtterance(text); u.rate = 1.04; u.pitch = .9;
    u.voice = bestDeviceVoice();
    const t0 = performance.now();
    u.onstart = () => { started = true; wordAt = performance.now(); trace('device-start', { ms: performance.now() - t0 }); };
    u.onboundary = () => { wordAt = performance.now(); };
    u.onend = u.onerror = fin;
    deviceTalking = true; wordAt = performance.now();
    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(u);
    setTimeout(() => { if (!started && !over){ try { speechSynthesis.cancel(); } catch (e){} blocked = true; elog('voice: iPhone blocked the iPhone voice (needs a tap)'); onBlocked && onBlocked(); fin(); } }, 2500);
    setTimeout(fin, 5000 + text.length * 110);
  });
  // play one Kokoro piece; if the player doesn't actually move (iPhone paused it), stop at once and say it another way
  const playBuffer = (audio, my) => new Promise(res => {
    if (my !== gen) return res('gone');
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    const t0 = performance.now(), c0 = ctx.currentTime;
    let over = false; const fin = how => { if (over) return; over = true; if (how !== 'ended'){ try { s.stop(); } catch (e){} } trace('played', { sec: audio.duration, ms: performance.now() - t0, how, state: ctx.state }); res(how); };
    const s = ctx.createBufferSource(); s.buffer = audio; s.connect(analyser); s.onended = () => fin('ended'); current = s; s.start(0);
    setTimeout(() => { if (!over && ctx.currentTime - c0 < .1){ elog('voice: the audio player is not moving (' + ctx.state + '), switching to the iPhone voice'); fin('stalled'); } }, 450);
    setTimeout(() => fin('timer'), audio.duration * 1000 + 2000);
  });
  const sayDevice = async (item, my, why) => { onEngine && onEngine('iPhone voice' + (why ? ' (' + why + ')' : '')); if (my === gen) await viaDevice(item.text); };
  const next = async () => {
    if (playing) return;
    if (!queue.length){ onSpeaking && onSpeaking(false); return; }
    playing = true; onSpeaking && onSpeaking(true);
    const item = queue.shift(), my = gen;
    if (gate && !gated){ gated = true; await gate(); if (my !== gen) return; }   // the microphone is fully off before Ember speaks
    onPiece && onPiece(item.text); trace('start', { text: item.text, device: !item.audio });
    elog('says: “' + short(item.text) + '”' + (item.audio ? '' : ' (iPhone voice)'));
    try {
      if (item.audio){
        // wait for Kokoro, but not forever: if this sentence isn't ready soon, the rest of the answer uses the iPhone voice
        const sp = kokoroSpeed(), limit = new Promise(r => setTimeout(() => r(null), sp != null && sp < .6 ? 2500 : 1200));
        const a = await Promise.race([item.audio, limit]); if (my !== gen) return;
        if (!a){ elog('voice: Kokoro too slow for this sentence, switching to the iPhone voice'); engine = 'device'; queue.forEach(q => { q.audio = null; }); cancelSpeech(); await sayDevice(item, my, 'Kokoro too slow'); }
        else { onEngine && onEngine('Kokoro'); const how = await playBuffer(a, my); if (how === 'stalled'){ engine = 'device'; queue.forEach(q => { q.audio = null; }); cancelSpeech(); await sayDevice(item, my, 'the audio player was paused'); } }
      } else await sayDevice(item, my, emberVoice() === 'device' ? '' : !voiceDownloaded() ? 'download Ember’s voice first' : !voiceLoaded() ? 'Ember’s voice is still starting up' : 'Kokoro too slow here');
    } catch (e){
      if (my !== gen) return;
      elog('voice error: ' + e.message); trace('error', { message: e.message });
      onError && onError(e.message + ' Using the iPhone voice.');
      engine = 'device'; queue.forEach(q => { q.audio = null; }); cancelSpeech();
      await sayDevice(item, my, e.message);
    }
    current = null;
    if (my !== gen) return;
    playing = false; next();
  };
  const mouth = {
    /* a new answer: whatever was left of the previous one is dropped */
    turn(){ mouth.stop(); blocked = false; gated = false; pick(); elog('— new answer, voice: ' + (engine === 'kokoro' ? 'Kokoro (' + voiceKind() + ')' : 'iPhone')); },
    say(text){
      if (!engine) pick();
      const ps = pieces(text);
      // the very first piece is made shorter when it can be, so Ember starts talking sooner
      if (!playing && !queue.length && ps[0] && ps[0].length > 70){ const c = ps[0].indexOf(', ', 25); if (c > 0 && c < 70) ps.splice(0, 1, ps[0].slice(0, c + 1), ps[0].slice(c + 2)); }
      ps.forEach(t => { const item = { text: t, audio: engine === 'kokoro' ? makeAudio(t) : null }; if (item.audio) item.audio.catch(() => {}); queue.push(item); trace('queued', { text: t, kokoro: !!item.audio }); });
      next();
    },
    stop(){ gen++; if (queue.some(q => q.audio)) cancelSpeech(); queue = []; try { current && current.stop(); } catch (e){} try { speechSynthesis.cancel(); } catch (e){} const was = playing; playing = false; current = null; deviceTalking = false; engine = ''; if (was) onSpeaking && onSpeaking(false); },
    busy: () => playing || queue.length > 0,
    unblock(){ blocked = false; },
    /* how loud Ember is right now: the real sound with Kokoro; with the iPhone voice, a pulse on every word */
    level: () => current && analyser ? Math.min(1, rms(analyser, buf) * 4.5) : deviceTalking ? .3 + .7 * Math.max(0, 1 - (performance.now() - wordAt) / 260) : 0
  };
  return mouth;
}

/* ---------- listening ----------
   One long listening session. Ember decides you've finished when you've been quiet for a moment, then stops the session
   itself (so the microphone is fully off before it answers) and hands over everything you said. */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = () => !!SR;
const QUIET = 1100;   // how long a pause means you've finished talking

/* onWords(text) while you talk, onHeard(text) when you've finished, onError(message),
   onStuck() when iPhone didn't let listening restart by itself: a tap brings it back */
export function createEars({ onWords, onHeard, onError, onStuck, onTrace }){
  const trace = (ev, d) => onTrace && onTrace(ev, d);
  let on = false, held = false, rec = null, active = false, finals = '', interim = '', quiet = 0, bump = 0, ever = false, check = 0, again = 0;
  const waiters = [];
  const ended = () => { active = false; waiters.splice(0).forEach(f => f()); };
  const start = () => {
    clearTimeout(again);
    if (!on || held || active) return;
    const me = rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
    finals = ''; interim = ''; active = true; let started = false;
    rec.onstart = () => { started = true; ever = true; trace('mic-on'); elog('mic: listening'); };
    clearTimeout(check); check = setTimeout(() => { if (on && !held && rec === me && !started){ elog('mic: iPhone did not start listening (needs a tap)'); onStuck && onStuck(); } }, 2500);
    rec.onresult = e => {
      if (rec !== me) return;
      bump = performance.now(); let f = '', i2 = '';
      for (let i = 0; i < e.results.length; i++){ const r = e.results[i]; if (r.isFinal) f += r[0].transcript + ' '; else i2 += r[0].transcript; }
      finals = f; interim = i2;
      const all = (f + i2).trim(); trace('words', { final: f.trim(), interim: i2 }); onWords(all);
      // still talking? wait. Quiet for a moment: you've finished, so end the session and use what you said
      clearTimeout(quiet); quiet = setTimeout(() => { if (rec === me){ elog('mic: you stopped talking'); try { me.stop(); } catch (er){} } }, QUIET);
    };
    rec.onerror = e => {
      trace('mic-error', { error: e.error });
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      elog('mic error: ' + e.error);
      if ((e.error === 'not-allowed' || e.error === 'service-not-allowed') && ever && on){ onStuck && onStuck(); return; }
      on = false; onError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Ember isn’t allowed to listen. Allow the microphone and speech recognition for Ember Life in your iPhone settings, then tap the mic again.' : 'Listening stopped (' + e.error + '). Tap the mic to try again.');
    };
    rec.onend = () => {
      if (rec !== me) return;
      clearTimeout(quiet); ended(); trace('mic-off', { held });
      const said = (finals + interim).trim(); finals = ''; interim = '';
      if (said && on && !held){ elog('heard: “' + short(said) + '”'); trace('heard', { text: said }); onHeard(said); }
      else if (on && !held) again = setTimeout(start, 250);   // the session ended by itself with nothing said: listen again
    };
    try { rec.start(); } catch (e){ active = false; }
  };
  return {
    start(){ if (on) return; on = true; held = false; elog('mic: conversation on'); start(); },
    /* after a tap, when iPhone wanted one */
    resume(){ if (!on) return; held = false; try { rec && rec.abort(); } catch (e){} active = false; rec = null; start(); },
    stop(){ on = false; clearTimeout(quiet); clearTimeout(check); clearTimeout(again); try { rec && rec.abort(); } catch (e){} rec = null; ended(); elog('mic: conversation off'); },
    /* while Ember answers, listening is off (so it doesn't hear itself); it comes back on when Ember is done */
    hold(h){ if (!on || held === h) return; held = h; if (h){ clearTimeout(quiet); clearTimeout(again); if (active){ try { rec.abort(); } catch (e){} } } else start(); },
    /* resolves once the microphone is really off, so iPhone lets Ember's voice play */
    released: () => active ? new Promise(r => { waiters.push(r); setTimeout(r, 900); }) : Promise.resolve(),
    level: () => Math.max(0, 1 - (performance.now() - bump) / 500) * .7,
    get on(){ return on; }
  };
}

/* ---------- interrupting Ember by talking ----------
   While Ember speaks, the microphone is watched with the iPhone's echo cancellation (so Ember's own voice is filtered out).
   If you start talking over it, Ember stops and listens. Tapping anywhere does the same and always works. */
export function createBargeIn({ onVoice }){
  let stream = null, an = null, data = null, poll = 0, armed = false, loudSince = 0, floor = .01, t0 = 0, opening = null;
  const open = async () => {
    if (stream) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !ctx) return false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
      an = ctx.createAnalyser(); an.fftSize = 1024; data = new Uint8Array(an.fftSize);
      ctx.createMediaStreamSource(stream).connect(an);
      return true;
    } catch (e){ elog('interrupt by voice unavailable: ' + e.message); stream = null; return false; }
  };
  const close = () => { clearInterval(poll); poll = 0; if (stream){ stream.getTracks().forEach(t => t.stop()); stream = null; } an = null; };
  return {
    async arm(){
      if (armed) return; armed = true;
      opening = open(); if (!(await opening) || !armed){ if (!armed) close(); return; }
      t0 = performance.now(); loudSince = 0; floor = .01;
      clearInterval(poll);
      poll = setInterval(() => {
        if (!armed || !an) return;
        const v = rms(an, data), now = performance.now();
        if (now - t0 < 500){ floor = Math.max(floor, v); return; }   // first half second: learn how loud the leftover echo and room are
        const thr = Math.max(.045, floor * 3);
        if (v > thr){ if (!loudSince) loudSince = now; else if (now - loudSince > 280){ elog('interrupt: you talked over Ember'); armed = false; close(); onVoice(); } }
        else loudSince = 0;
      }, 40);
    },
    disarm(){ armed = false; close(); }
  };
}
