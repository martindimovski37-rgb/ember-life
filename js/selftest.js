/* Ember voice test (Settings → Ember's voice → Run the voice test).
   Times every step of a conversation on this device and writes a report that can be copied and sent.
   Nothing it does is saved: the questions use a fresh conversation, and anything Ember would add is not added. */
import { createMouth, unlockAudio, canListen, createEars, emberVoice } from './voice.js';
import { voiceDownloaded, loadVoice, kokoroSpeak, voiceLoaded, voiceKind, downloadedKind, bestKind } from './kokoro.js';
import { bestDeviceVoice } from './voice.js';
import { askEmber } from './assistant.js';
import { deviceGet } from './store.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const s1 = ms => (ms / 1000).toFixed(1) + ' s';

/* speak some text and record when each piece started and ended; resolves when Ember is quiet again */
function speakTimed(text, log, t0){
  return new Promise(done => {
    let quietTimer = 0;
    const m = createMouth({
      preview: true,
      onTrace: (ev, d) => {
        const at = s1(performance.now() - t0);
        if (ev === 'made') log(`  ${at}  made ${d.sec.toFixed(1)} s of speech in ${s1(d.ms)}`);
        if (ev === 'start') log(`  ${at}  starts: “${d.text}”${d.device ? ' (iPhone voice)' : ''}`);
        if (ev === 'played') log(`  ${at}  finished (${d.how === 'ended' ? 'played to the end' : 'STOPPED BY SAFETY TIMER'}, ${s1(d.ms)} for ${d.sec.toFixed(1)} s, player ${d.state})`);
        if (ev === 'player') log(`  ${at}  audio player was paused, now ${d.state}`);
        if (ev === 'device-start') log(`  ${at}  iPhone voice started after ${s1(d.ms)}`);
        if (ev === 'device-end' && !d.started) log(`  ${at}  iPhone voice NEVER STARTED`);
        if (ev === 'error') log(`  ${at}  ERROR ${d.message}`);
      },
      onSpeaking: on => { clearTimeout(quietTimer); if (!on) quietTimer = setTimeout(() => done(m), 300); }
    });
    m.say(text);
  });
}

export async function runVoiceTest(log, { askReal }){
  const t0 = performance.now();
  unlockAudio();
  log('EMBER VOICE TEST');
  log('Device: ' + navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 120));
  log('Voice: ' + emberVoice() + (voiceDownloaded() ? ' (Kokoro downloaded)' : ' (Kokoro NOT downloaded, using the iPhone voice)'));
  log('Listening available: ' + canListen() + ' · cores: ' + (navigator.hardwareConcurrency || '?'));
  log('Graphics chip (WebGPU): ' + ('gpu' in navigator ? 'yes' : 'no') + ' · downloaded: ' + (downloadedKind() || 'none') + ' · best for this phone: ' + bestKind());
  const dv = bestDeviceVoice(), all = ('speechSynthesis' in window) ? speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)) : [];
  log('iPhone voice used: ' + (dv ? dv.name + ' (' + dv.lang + ')' : 'default') + ' · English voices installed: ' + all.length + (all.length ? ' — ' + all.map(v => v.name).slice(0, 25).join(', ') : ''));

  // 1. starting Kokoro
  if (voiceDownloaded() && emberVoice() !== 'device'){
    log('\n1. Starting the voice');
    const a = performance.now(); const was = voiceLoaded();
    try { await loadVoice(); log(`  ${voiceKind() === 'gpu' ? 'fast version (graphics chip)' : 'small version'} ready in ${s1(performance.now() - a)}${was ? ' (was already running)' : ''}`); }
    catch (e){ log('  FAILED: ' + e.message); }

    // 2. how fast it makes speech
    log('\n2. Making speech (should be faster than the speech itself)');
    for (const t of ['Adding four eggs to your breakfast now.', 'Done. That’s 286 calories and 25 grams of protein, and you have 1,169 left today.']){
      const b = performance.now();
      try { const r = await kokoroSpeak(t, emberVoice()); const sec = r.audio.length / r.rate, ms = performance.now() - b;
        log(`  ${sec.toFixed(1)} s of speech made in ${s1(ms)} → ${(ms / 1000 / sec).toFixed(2)}× real time ${ms / 1000 > sec ? '(SLOWER than real time)' : '(ok)'}`); }
      catch (e){ log('  FAILED: ' + e.message); }
    }
  }

  // 3. a reply arriving sentence by sentence, the way Ember's answers stream in
  log('\n3. Speaking a two-sentence reply');
  const c = performance.now();
  await speakTimed('Adding four eggs to your breakfast now. Done, that’s 286 calories and 25 grams of protein, and you have 1,169 left today.', log, c);
  log(`  total ${s1(performance.now() - c)}`);

  // 4. real questions to Ember (needs the Claude key; nothing is saved)
  if (askReal && deviceGet().claudeKey){
    log('\n4. Real questions (nothing is saved)');
    for (const q of ['How much protein do I have left today?', 'What did I eat today?', 'I just ate two bananas, add them to my snacks.']){
      log(`\n  You: “${q}”`);
      const d = performance.now(); let first = 0, words = '';
      const said = [];
      try {
        await askEmber({ text: q, spoken: true, test: true, say: w => { if (!first) first = performance.now(); said.push(w); words += (words ? ' ' : '') + w; } });
        log(`  first sentence after ${first ? s1(first - d) : '—'}, whole answer after ${s1(performance.now() - d)}`);
        log(`  Ember: “${words}”`);
        const e = performance.now();
        await speakTimed(said.join(' '), log, e);
        log(`  spoken in ${s1(performance.now() - e)}`);
      } catch (er){ log('  FAILED: ' + er.message); }
    }
  } else if (askReal) log('\n4. Real questions: skipped (no Claude key on this device)');

  log(`\nDone in ${s1(performance.now() - t0)}.`);
}

/* listening: you talk once, then stay quiet; it records when the microphone switched on and off and what it heard */
export function runListenTest(log, seconds = 15){
  return new Promise(done => {
    if (!canListen()){ log('Listening is not available here.'); return done(); }
    unlockAudio();
    const t0 = performance.now(), at = () => s1(performance.now() - t0);
    let ears = null;
    ears = createEars({
      onWords: () => {}, onHeard: t => log(`  ${at()}  HEARD: “${t}”`), onError: m => log(`  ${at()}  ERROR ${m}`), onStuck: () => log(`  ${at()}  iPhone did not restart listening by itself (would ask for a tap)`),
      onTrace: (ev, d) => {
        if (ev === 'mic-on') log(`  ${at()}  microphone on`);
        if (ev === 'mic-off') log(`  ${at()}  microphone off`);
        if (ev === 'mic-error') log(`  ${at()}  microphone error: ${d.error}`);
        if (ev === 'words') log(`  ${at()}  words so far: “${(d.final + ' ' + d.interim).trim()}”`);
      }
    });
    log(`LISTENING TEST: say “I just ate two bananas”, then stay quiet. Runs ${seconds} s.`);
    ears.start();
    setTimeout(() => { ears.stop(); log(`  ${at()}  test over`); done(); }, seconds * 1000);
  });
}
