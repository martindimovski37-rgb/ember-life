/* The Ember tab: the glowing orb you talk to, with subtitles, and a chat panel that keeps the whole conversation. */
import { html, useState, useEffect, useRef, Ico, UI } from './lib.js';
import { askEmber, emberChat, actionLine, md, photoData } from './assistant.js';
import { createMouth, createEars, unlockAudio, canListen } from './voice.js';
import { loadThree, createOrb } from './orb.js';

const CHAT = 'M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 19.5l1.3-4.6A7.5 7.5 0 1 1 20 11.5z';
const MIC = 'M9 3h6v11H9z M5 11a7 7 0 0 0 14 0 M12 18v3';
const DOWN = 'M6 9l6 6 6-6';
const short = t => t.length > 150 ? t.slice(0, 147).replace(/\s+\S*$/, '') + '…' : t;

export function EmberView(){
  const [phase, setPhase] = useState('idle');          // idle, listen, think, speak
  const [listening, setListening] = useState(false);   // the mic is unpaused
  const [chatOpen, setChatOpen] = useState(false);
  const [sub, setSub] = useState({ who: '', text: '' });
  const [chat, setChat] = useState(emberChat.load);
  const [live, setLive] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState([]);
  const [noGL, setNoGL] = useState(false);
  const cv = useRef(null), orb = useRef(null), mouth = useRef(null), ears = useRef(null), stopAsk = useRef(null), logEnd = useRef(null), fileRef = useRef(null);
  const st = useRef({ listening: false, busy: false });
  st.current.listening = listening; st.current.busy = busy;

  /* after Ember finishes talking: back to listening if the mic is on, otherwise rest */
  const settle = () => {
    if (st.current.busy || (mouth.current && mouth.current.busy())) return;
    if (st.current.listening){ ears.current && ears.current.hold(false); setPhase('listen'); } else setPhase('idle');
  };

  useEffect(() => {
    let dead = false;
    mouth.current = createMouth({
      onSpeaking: on => { if (on){ ears.current && ears.current.hold(true); setPhase('speak'); } else settle(); },
      onError: m => setErr(m)
    });
    ears.current = createEars({
      onWords: w => { if (w) setSub({ who: 'you', text: w }); },
      onHeard: w => ask(w, true),
      onError: m => { setErr(m); setListening(false); setPhase('idle'); }
    });
    loadThree().then(() => {
      if (dead) return;
      try { orb.current = createOrb(cv.current, () => phase0() === 'speak' ? mouth.current.level() : phase0() === 'listen' ? ears.current.level() : null); }
      catch (e){ setNoGL(true); }
    }).catch(() => setNoGL(true));
    return () => { dead = true; orb.current && orb.current.destroy(); mouth.current.stop(); ears.current.stop(); stopAsk.current && stopAsk.current(); };
  }, []);
  /* the orb reads the phase every frame, so keep the latest one where it can see it */
  const phaseRef = useRef(phase); phaseRef.current = phase; const phase0 = () => phaseRef.current;
  useEffect(() => { orb.current && orb.current.setState(phase); }, [phase]);
  useEffect(() => { orb.current && orb.current.setChat(chatOpen); if (chatOpen) setTimeout(() => logEnd.current && logEnd.current.scrollIntoView({ block: 'end' }), 60); }, [chatOpen]);
  useEffect(() => { chatOpen && logEnd.current && logEnd.current.scrollIntoView({ block: 'end' }); }, [chat, live]);

  const ask = async (q, spoken) => {
    if (st.current.busy) return;
    setErr(''); setBusy(true); st.current.busy = true;
    ears.current.hold(true); setPhase('think');
    if (spoken) setSub({ who: 'you', text: q });
    const pics = photos; setPhotos([]);
    try {
      await askEmber({
        text: q, photos: pics, spoken,
        say: words => { setSub({ who: 'ember', text: short(words) }); if (spoken) mouth.current.say(words); },
        live: setLive, changed: setChat, onStop: f => { stopAsk.current = f; }
      });
    } catch (e){ setErr(e.message); if (spoken) mouth.current.say(e.message); }
    finally { setBusy(false); st.current.busy = false; setLive(''); stopAsk.current = null; settle(); }
  };

  const toggleMic = () => {
    unlockAudio();
    if (listening){ setListening(false); ears.current.stop(); if (!busy && !mouth.current.busy()) setPhase('idle'); setSub({ who: '', text: '' }); return; }
    if (!canListen()){ setErr('Talking isn’t available in this browser. Add an ElevenLabs key in Settings so Ember can listen, or type in the chat.'); setChatOpen(true); return; }
    setErr(''); setListening(true); ears.current.start(); if (!busy && !mouth.current.busy()) setPhase('listen');
  };
  const hush = () => { mouth.current.stop(); stopAsk.current && stopAsk.current(); setSub({ who: '', text: '' }); settle(); };
  const send = () => { const q = text.trim(); if ((!q && !photos.length) || busy) return; setText(''); ask(q, false); };
  const addPhotos = async e => { const files = Array.from(e.target.files || []).slice(0, 3 - photos.length); e.target.value = ''; try { const d = await Promise.all(files.map(photoData)); setPhotos(photos.concat(d)); } catch (er){ setErr(er.message); } };
  const undo = id => setChat(emberChat.undo(id));

  /* the conversation, with a line for each day */
  const items = []; let lastDay = '';
  const failed = {};
  chat.messages.forEach(m => { if (m.role === 'user' && Array.isArray(m.content)) m.content.forEach(b => { if (b.type === 'tool_result' && b.is_error) failed[b.tool_use_id] = true; }); });
  chat.messages.forEach((m, i) => {
    if (!Array.isArray(m.content)) return;
    if (m.role === 'user'){
      const t = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n'), pics = m.content.filter(b => b.type === 'image');
      if (!t && !pics.length) return;
      const stamp = (t.match(/^\[([^\]]*)\]/) || [])[1] || '', day = stamp.split(',')[0];
      if (day && day !== lastDay){ lastDay = day; items.push(html`<div key=${'d' + i} class="em-day">${day}</div>`); }
      items.push(html`<div key=${'u' + i} class="em-me">${pics.map((p, j) => html`<img key=${j} src=${'data:image/jpeg;base64,' + p.source.data} alt="Your photo"/>`)}<span>${t.replace(/^\[[^\]]*\]\s*(\(spoken\)\s*)?/, '')}</span></div>`);
      return;
    }
    m.content.forEach((b, j) => {
      if (b.type === 'text' && b.text.trim()) items.push(html`<div key=${'a' + i + '-' + j} class="em-ai"><b>Ember</b>${md(b.text)}</div>`);
      else if (b.type === 'tool_use' && b.name.startsWith('propose_') && !failed[b.id]){
        const a = actionLine(b), s = chat.cards[b.id]; if (!a) return;
        items.push(html`<div key=${'c' + b.id} class=${'em-act' + (s === 'undone' ? ' undone' : '')}><i></i><span>${a.title}<small>${s === 'undone' ? 'Undone' : a.detail}</small></span>
          ${s === 'saved' && chat.undo && chat.undo[b.id] && html`<button onClick=${() => undo(b.id)}>Undo</button>`}</div>`);
      }
    });
  });

  return html`<div class=${'ember-page' + (chatOpen ? ' chatting' : '')}>
    <canvas ref=${cv} class="em-gl" aria-hidden="true"></canvas>
    ${noGL && html`<div class="em-fallback" aria-hidden="true"></div>`}
    <div class=${'em-sub ' + sub.who} aria-live="polite">${sub.text}</div>
    ${err && !chatOpen && html`<p class="em-err">${err}</p>`}
    <div class="em-bar">
      <button class="em-side" aria-label="Open chat" onClick=${() => setChatOpen(true)}><${Ico} d=${CHAT} size=${18}/></button>
      <button class=${'em-mic' + (listening ? '' : ' paused')} aria-label=${listening ? 'Pause listening' : 'Talk to Ember'} aria-pressed=${String(listening)} onClick=${toggleMic}><${Ico} d=${MIC} size=${22}/></button>
      <button class="em-side" aria-label="Stop talking" onClick=${hush}><${Ico} d=${UI.x} size=${17}/></button>
    </div>
    <section class="em-chat" aria-label="Chat with Ember" aria-hidden=${String(!chatOpen)}>
      <div class="em-chat-head"><span>Ember · chat</span>
        ${chat.messages.length > 0 && html`<button class="em-link" disabled=${busy} onClick=${() => setChat(emberChat.clear())}>Clear</button>`}
        <button class="em-close" aria-label="Close chat" onClick=${() => setChatOpen(false)}><${Ico} d=${DOWN} size=${16}/></button></div>
      <div class="em-log">
        ${items.length === 0 && !busy && html`<p class="em-empty">Ask about your food, targets, weight or workouts, or tell Ember what you ate. It adds things straight away, and you can undo anything here.</p>`}
        ${items}
        ${busy && html`<div class="em-ai"><b>Ember</b>${live ? md(live) : html`<span class="typing"><i></i><i></i><i></i></span>`}</div>`}
        ${err && html`<p class="em-err in">${err}</p>`}
        <div ref=${logEnd}></div>
      </div>
      ${photos.length > 0 && html`<div class="em-photos">${photos.map((p, i) => html`<span key=${i}><img src=${'data:image/jpeg;base64,' + p} alt="Photo to send"/><button aria-label="Remove photo" onClick=${() => setPhotos(photos.filter((_, j) => j !== i))}><${Ico} d=${UI.x} size=${12} sw=${3}/></button></span>`)}</div>`}
      <form class="em-compose" onSubmit=${e => { e.preventDefault(); send(); }}>
        <button type="button" class="em-cbtn" aria-label="Add a photo" disabled=${busy || photos.length >= 3} onClick=${() => fileRef.current && fileRef.current.click()}><${Ico} d=${UI.camera} size=${17}/></button>
        <input value=${text} placeholder=${listening ? 'Listening… or type here' : 'Message Ember'} enterkeyhint="send" onInput=${e => setText(e.target.value)}/>
        <button type="button" class=${'em-cbtn' + (listening ? ' on' : '')} aria-label=${listening ? 'Pause listening' : 'Talk instead'} aria-pressed=${String(listening)} onClick=${toggleMic}><${Ico} d=${MIC} size=${17}/></button>
        <button type="submit" class="em-cbtn send" aria-label="Send" disabled=${busy || (!text.trim() && !photos.length)}><${Ico} d=${UI.up} size=${17} sw=${3}/></button>
        <input ref=${fileRef} type="file" accept="image/*" multiple hidden onChange=${addPhotos}/>
      </form>
    </section>
  </div>`;
}
