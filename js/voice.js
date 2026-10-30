/* Ember's voice and ears.
   Speaking: Kokoro, a natural voice that runs on the iPhone itself once it's downloaded (Settings → Ember's voice);
   until then, or if it fails, the built-in iPhone voice. The orb follows the loudness of whatever is playing.
   Listening: the iPhone's own speech recognition. */
import { store } from './store.js';
import { KOKORO_VOICES, voiceDownloaded, kokoroSpeak } from './kokoro.js';

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

/* ---------- speaking: each piece is fetched as soon as it's ready and played in order, without gaps ---------- */
export function createMouth({ onSpeaking, onPiece, onError, onBlocked, onEngine } = {}){
  const queue = []; let playing = false, current = null, gen = 0, deviceTalking = false, wordAt = 0, warned = false, blocked = false;
  const useKokoro = () => emberVoice() !== 'device' && voiceDownloaded() && !!ctx;
  // Kokoro makes the sound in the background; it comes back as raw audio that the shared player plays
  const makeAudio = text => kokoroSpeak(text, emberVoice()).then(({ audio, rate }) => { const b = ctx.createBuffer(1, audio.length, rate); b.copyToChannel(audio, 0); return b; });
  // the iPhone voice; if iPhone blocks it, it never starts and never reports back, so give up after a moment instead of freezing
  const viaDevice = text => new Promise(res => {
    if (!('speechSynthesis' in window)) return res();
    if (blocked) return setTimeout(res, 600 + text.length * 45);   // still blocked: just give time to read the subtitle
    let started = false, over = false;
    const fin = () => { if (over) return; over = true; deviceTalking = false; res(); };
    const u = new SpeechSynthesisUtterance(text); u.rate = 1.04; u.pitch = .9;
    const en = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
    u.voice = en.find(v => /Daniel|Arthur|Oliver/i.test(v.name)) || en[0] || null;
    u.onstart = () => { started = true; wordAt = performance.now(); };
    u.onboundary = () => { wordAt = performance.now(); };
    u.onend = u.onerror = fin;
    deviceTalking = true; wordAt = performance.now();
    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(u);
    setTimeout(() => { if (!started && !over){ try { speechSynthesis.cancel(); } catch (e){} blocked = true; onBlocked && onBlocked(); fin(); } }, 2500);
    setTimeout(fin, 5000 + text.length * 110);
  });
  // play one piece; never wait forever, even if the player was paused by iPhone (it then reports that a tap is needed)
  const playBuffer = (audio, my) => new Promise(res => {
    if (my !== gen) return res();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    let over = false; const fin = () => { if (!over){ over = true; res(); } };
    const s = ctx.createBufferSource(); s.buffer = audio; s.connect(analyser); s.onended = fin; current = s; s.start(0);
    setTimeout(() => { if (!over && ctx.state !== 'running'){ blocked = true; onBlocked && onBlocked(); try { s.stop(); } catch (e){} fin(); } }, 1500);
    setTimeout(fin, audio.duration * 1000 + 1500);
  });
  const next = async () => {
    if (playing) return;
    if (!queue.length){ onSpeaking && onSpeaking(false); return; }
    playing = true; onSpeaking && onSpeaking(true);
    const item = queue.shift(), my = gen;
    try {
      if (item.audio && blocked){ onPiece && onPiece(item.text); await new Promise(r => setTimeout(r, 600 + item.text.length * 45)); }
      else if (item.audio){ const a = await item.audio; if (my !== gen) return; onPiece && onPiece(item.text); onEngine && onEngine('Kokoro'); await playBuffer(a, my); }
      else { onPiece && onPiece(item.text); onEngine && onEngine(emberVoice() === 'device' ? 'iPhone voice' : !voiceDownloaded() ? 'iPhone voice (download Ember’s voice first)' : 'iPhone voice (the audio player wasn’t started)'); await viaDevice(item.text); }
    } catch (e){
      if (!warned){ warned = true; onError && onError(e.message + ' Using the iPhone voice for now.'); }   // Kokoro failed: say it with the iPhone voice instead
      onEngine && onEngine('iPhone voice, because: ' + e.message);
      if (my === gen){ onPiece && onPiece(item.text); await viaDevice(item.text); }
    }
    current = null;
    if (my !== gen) return;
    playing = false; next();
  };
  return {
    say(text){
      const ps = pieces(text);
      // the very first piece is made shorter when it can be, so Ember starts talking sooner
      if (!playing && !queue.length && ps[0] && ps[0].length > 70){ const c = ps[0].indexOf(', ', 25); if (c > 0 && c < 70) ps.splice(0, 1, ps[0].slice(0, c + 1), ps[0].slice(c + 2)); }
      ps.forEach(t => { const item = { text: t, audio: useKokoro() ? makeAudio(t) : null }; if (item.audio) item.audio.catch(() => {}); queue.push(item); });
      next();
    },
    stop(){ gen++; queue.length = 0; try { current && current.stop(); } catch (e){} try { speechSynthesis.cancel(); } catch (e){} playing = false; current = null; deviceTalking = false; onSpeaking && onSpeaking(false); },
    busy: () => playing || queue.length > 0,
    unblock(){ blocked = false; },
    /* how loud Ember is right now: the real sound with Kokoro; with the iPhone voice, a pulse on every word */
    level: () => current && analyser ? Math.min(1, rms(analyser, buf) * 4.5) : deviceTalking ? .3 + .7 * Math.max(0, 1 - (performance.now() - wordAt) / 260) : 0
  };
}

/* ---------- listening ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = () => !!SR;

/* onWords(text) while you talk, onHeard(text) when you've finished a sentence, onError(message),
   onStuck() when iPhone didn't let listening restart by itself: a tap brings it back */
export function createEars({ onWords, onHeard, onError, onStuck }){
  let on = false, held = false, rec = null, heard = '', timer = 0, bump = 0, ever = false, check = 0;
  const finish = t => { clearTimeout(timer); heard = ''; const s = t.trim(); if (s) onHeard(s); };
  const start = () => {
    const me = rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
    let started = false;
    rec.onstart = () => { started = true; ever = true; };
    clearTimeout(check); check = setTimeout(() => { if (on && !held && rec === me && !started) onStuck && onStuck(); }, 2500);
    rec.onresult = e => {
      bump = performance.now(); let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++){ const r = e.results[i]; if (r.isFinal) heard += r[0].transcript + ' '; else interim += r[0].transcript; }
      onWords((heard + interim).trim());
      clearTimeout(timer); timer = setTimeout(() => finish(heard + interim), interim ? 900 : 550);
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if ((e.error === 'not-allowed' || e.error === 'service-not-allowed') && ever && on){ onStuck && onStuck(); return; }   // worked before: iPhone just wants a tap to carry on
      on = false; onError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Ember isn’t allowed to listen. Allow the microphone and speech recognition for Ember Life in your iPhone settings, then tap the mic again.' : 'Listening stopped (' + e.error + '). Tap the mic to try again.');
    };
    rec.onend = () => { if (on && !held && rec === me) setTimeout(() => { if (on && !held && rec === me) start(); }, 200); };
    try { rec.start(); } catch (e){}
  };
  return {
    start(){ if (on) return; on = true; held = false; start(); },
    /* after a tap, when iPhone wanted one */
    resume(){ if (!on) return; held = false; try { rec && rec.abort(); } catch (e){} start(); },
    stop(){ on = false; clearTimeout(timer); clearTimeout(check); heard = ''; try { rec && rec.abort(); } catch (e){} rec = null; },
    /* while Ember is talking it stops listening, so it doesn't hear itself */
    hold(h){ if (!on || held === h) return; held = h; if (h){ try { rec && rec.abort(); } catch (e){} } else start(); },
    level: () => Math.max(0, 1 - (performance.now() - bump) / 500) * .7,
    get on(){ return on; }
  };
}
