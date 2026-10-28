/* App shell: tabs, Today, Settings, toasts. */
import { html, useState, useEffect, useRef, Ico, UI, Ring, dayKey, fmtLong, plural, scrollTop } from './lib.js';
import { store, sync, deviceGet, deviceSet } from './store.js';
import { plannerCtx, PlannerTab, PlanItems, RequiredSheet } from './planner.js';
import { DietTab, TargetsForm, dayTotals, targetsFor, kc, g1 } from './diet.js';
import { GymTab, WorkoutBar, workedOutOn, SOUNDS, playSound } from './gym.js';
import { AssistantButton, AssistantChat } from './assistant.js';
import { AI_MODELS, aiModel, claude, aiError } from './claude.js';

export const VERSION = '1.14';
const TABS = [['today', 'Today', UI.sun], ['planner', 'Planner', UI.grid], ['diet', 'Diet', UI.diet], ['gym', 'Gym', UI.gym]];
const ALL_TABS = TABS.map(t => t[0]).concat(['settings']);

export function App(){
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState(() => { const h = (location.hash || '').slice(1); return ALL_TABS.includes(h) ? h : 'today'; });
  const [ui, setUiState] = useState({ sub: 'plan', edit: null, energy: null, focusAct: null, dsub: 'log', dedit: null, ddate: null, gview: null });
  const [toast, setToast] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [today, setToday] = useState(dayKey());
  const toastTimer = useRef(null);

  useEffect(() => store.subscribe(() => setVersion(v => v + 1)), []);
  useEffect(() => { const t = setInterval(() => setToday(dayKey()), 60000); return () => clearInterval(t); }, []);
  useEffect(() => { if (sync.configured()) sync.now(); }, []);

  const settings = Object.assign({ theme: 'auto' }, store.get('settings/app') || {});
  useEffect(() => {
    const r = document.documentElement;
    if (settings.theme === 'light' || settings.theme === 'dark') r.setAttribute('data-theme', settings.theme);
    else r.removeAttribute('data-theme');
  }, [settings.theme]);

  const showToast = (text, action) => {
    clearTimeout(toastTimer.current);
    setToast({ text, action });
    toastTimer.current = setTimeout(() => setToast(null), action ? 6000 : 3000);
  };
  const setUi = patch => setUiState(s => Object.assign({}, s, patch));
  const go = t => {
    setTab(t);
    if (t === 'planner') setUi({ edit: null });
    if (t === 'diet') setUi({ dedit: null });
    if (t === 'gym') setUi({ gview: store.get('gym/active') ? { type: 'workout' } : null });
    try { history.replaceState(null, '', '#' + t); } catch (e){}
    scrollTop();
  };

  const p = plannerCtx({ today, ui, setUi, showToast, setSheet });
  const app = { tab, go, today, settings, showToast, setSheet, p };

  let body;
  if (tab === 'planner') body = html`<${PlannerTab} ctx=${p}/>`;
  else if (tab === 'diet') body = html`<${DietTab} app=${app} ui=${ui} setUi=${setUi}/>`;
  else if (tab === 'gym') body = html`<${GymTab} app=${app} ui=${ui} setUi=${setUi}/>`;
  else if (tab === 'settings') body = html`<${SettingsView} app=${app}/>`;
  else body = html`<${TodayView} app=${app}/>`;

  const showSetbar = tab === 'planner' && !ui.edit && (ui.sub || 'plan') === 'plan' && !p.cur.set && p.picks.length > 0;
  return html`
    <div class="shell">
      <nav class="rail" aria-label="Sections">
        <div class="brand"><img src="icons/icon.svg" alt=""/>Ember Life</div>
        ${TABS.concat([['settings', 'Settings', UI.gear]]).map(t => html`<button key=${t[0]} aria-current=${tab === t[0] ? 'page' : null} onClick=${() => go(t[0])}><${Ico} d=${t[2]} size=${19}/>${t[1]}</button>`)}
      </nav>
      <main class="main">${body}</main>
    </div>
    ${!(tab === 'gym' && ui.gview && ui.gview.type === 'workout') && html`<${WorkoutBar} onOpen=${() => { setTab('gym'); setUi({ gview: { type: 'workout' } }); try { history.replaceState(null, '', '#gym'); } catch (e){} scrollTop(); }}/>`}
    ${!aiOpen && !showSetbar && html`<${AssistantButton} raised=${!!store.get('gym/active')} onOpen=${() => setAiOpen(true)}/>`}
    ${aiOpen && html`<${AssistantChat} app=${app} close=${() => setAiOpen(false)}/>`}
    ${showSetbar && html`<div class="setbar"><button class="btn btn-pop" onClick=${() => p.setPlan(false)}>${'Set today’s plan · ' + p.picks.length}</button></div>`}
    <nav class="tabbar" aria-label="Main">
      <div class="tabbar-inner">
        ${TABS.map(t => html`<button key=${t[0]} class="tab" aria-current=${tab === t[0] ? 'page' : null} onClick=${() => go(t[0])}><${Ico} d=${t[2]} size=${22}/>${t[1]}</button>`)}
      </div>
    </nav>
    ${toast && html`
      <div class="toast" role="status">
        <span>${toast.text}</span>
        ${toast.action && html`<button onClick=${() => { toast.action.run(); setToast(null); }}>${toast.action.label}</button>`}
      </div>`}
    ${sheet && sheet.kind === 'required' && html`<${RequiredSheet} ctx=${p} sheet=${sheet} close=${() => setSheet(null)}/>`}
    ${sheet && sheet.kind === 'confirm' && html`<${ConfirmSheet} sheet=${sheet} close=${() => setSheet(null)}/>`}
  `;
}

function ConfirmSheet({ sheet, close }){
  return html`<div class="scrim" onClick=${e => { if (e.target === e.currentTarget) close(); }}>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <h2 id="confirm-title">${sheet.title}</h2>
      <p class="hint">${sheet.text}</p>
      <div class="sheet-actions">
        <button class="btn btn-ghost sm" onClick=${close}>Cancel</button>
        <button class=${'btn sm ' + (sheet.danger ? 'btn-danger' : 'btn-solid')} onClick=${() => { close(); sheet.run(); }}>${sheet.ok}</button>
      </div>
    </div>
  </div>`;
}

/* ---------- Today ---------- */
function TodayView({ app }){
  const { p, today, go } = app;
  const cur = p.cur;
  const planToday = cur.set && cur.date === today;
  const items = planToday ? cur.items || [] : [];
  const nDone = items.filter(i => (cur.done || []).includes(i.id)).length;
  const tot = dayTotals(today), tg = targetsFor(today), gymDone = workedOutOn(today);
  return html`<div class="stack">
    <header class="head">
      <div class="grow col"><span class="eyebrow">${fmtLong(today)}</span><h1>Today</h1></div>
      ${sync.state === 'error' && html`<button class="icon-btn" aria-label="Sync problem, open Settings" style="color:var(--danger)" onClick=${() => go('settings')}><${Ico} d=${UI.sync}/></button>`}
      <button class="icon-btn round" aria-label="Settings" onClick=${() => go('settings')}><${Ico} d=${UI.gear}/></button>
    </header>

    <section class="card" aria-label="Today at a glance">
      <div class="rings">
        <button class="ring" onClick=${() => go('diet')}><${Ring} value=${tot.kcal} max=${tg.kcal} color="var(--ring-kcal)"/><span class="ring-val">${kc(tot.kcal)}</span><span class="ring-sub">${tg.kcal ? 'of ' + kc(tg.kcal) + ' kcal' : 'kcal'}</span></button>
        <button class="ring" onClick=${() => go('diet')}><${Ring} value=${tot.p} max=${tg.p} color="var(--ring-protein)"/><span class="ring-val">${g1(tot.p)} g</span><span class="ring-sub">${tg.p ? 'of ' + g1(tg.p) + ' g protein' : 'protein'}</span></button>
        <button class="ring" onClick=${() => go('gym')}><${Ring} value=${gymDone ? 1 : 0} max=${1} color="var(--ring-gym)"/><span class="ring-val">${gymDone ? 'Done' : '–'}</span><span class="ring-sub">${gymDone ? 'workout' : 'gym'}</span></button>
      </div>
      ${!tg.kcal && html`<p class="hint">Set your calorie and protein targets in Settings to fill the rings.</p>`}
    </section>

    <section class="card">
      <div class="row-between">
        <h2 class="card-title">Plan</h2>
        ${planToday && html`<span class="cat-sub">${nDone} of ${items.length} done</span>`}
      </div>
      ${planToday
        ? html`<${PlanItems} ctx=${p} compact=${true}/>
               <button class="btn btn-ghost sm" onClick=${() => { p.setSub('plan'); go('planner'); }}>Open planner</button>`
        : html`<p class="hint">No plan for today yet. Pick a few things if you feel like it.</p>
               <button class="btn btn-pop" onClick=${() => { p.setSub('plan'); go('planner'); }}>Plan my day</button>`}
    </section>
  </div>`;
}

/* ---------- Settings ---------- */
const THEMES = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];
const ago = t => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return plural(Math.round(s / 60), 'minute', 'minutes') + ' ago';
  return new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};

function SettingsView({ app }){
  const { settings, showToast } = app;
  const setTheme = t => store.set('settings/app', Object.assign({}, settings, { theme: t }));
  return html`<div class="stack">
    <header class="head"><h1>Settings</h1></header>
    <section class="card">
      <h2 class="card-title">Appearance</h2>
      <div class="seg inset" role="group" aria-label="Appearance">
        ${THEMES.map(t => html`<button key=${t[0]} aria-pressed=${String(settings.theme === t[0])} onClick=${() => setTheme(t[0])}>${t[1]}</button>`)}
      </div>
      <p class="hint">Auto follows your iPhone or Mac.</p>
    </section>
    <section class="card">
      <h2 class="card-title">Rest timer sound</h2>
      <div class="list">${SOUNDS.map(([k, name]) => { const on = (settings.restSound || 'chime') === k; return html`<button key=${k} class="act-pick" aria-pressed=${String(on)}
        onClick=${() => { store.set('settings/app', Object.assign({}, settings, { restSound: k })); playSound(k); }}>
        <span class="grow row-title">${name}</span><span class=${'radio' + (on ? ' on' : '')}></span></button>`; })}</div>
      <p class="hint">Tap one to hear it. It plays through your headphones when they’re connected, otherwise the iPhone speaker, while Ember Life is open.</p>
    </section>
    <section class="card">
      <h2 class="card-title">Daily targets</h2>
      <${TargetsForm} onSaved=${() => showToast('Targets saved.')}/>
    </section>
    <${SyncCard} showToast=${showToast}/>
    <${BackupCard} app=${app}/>
    <${KeysCard} showToast=${showToast}/>
    <section class="card">
      <h2 class="card-title">Assistant model</h2>
      <div class="list">${AI_MODELS.map(([id, name, sub]) => { const on = aiModel() === id; return html`<button key=${id} class="act-pick" aria-pressed=${String(on)}
        onClick=${() => store.set('settings/app', Object.assign({}, settings, { aiModel: id }))}>
        <span class="col grow"><span class="row-title">${name}</span><span class="row-sub wrap">${sub}</span></span><span class=${'radio' + (on ? ' on' : '')}></span></button>`; })}</div>
      <p class="hint">Used by the ✦ assistant and food estimates. Costs come out of your Anthropic credit; photos cost a little more than text.</p>
    </section>
    <section class="card">
      <h2 class="card-title">Put it on your iPhone home screen</h2>
      <ol class="steps">
        <li>Open the Ember Life link in Safari on your iPhone.</li>
        <li>Tap the Share button, then “Add to Home Screen”.</li>
        <li>Tap Add. Open it from the new icon from now on.</li>
      </ol>
    </section>
    <p class="hint" style="text-align:center">Ember Life ${VERSION}</p>
  </div>`;
}

function SyncCard({ showToast }){
  const dev = deviceGet();
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState(dev.repo || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    const t = token.trim(), r = repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    if (!t || !/^[\w.-]+\/[\w.-]+$/.test(r)){ setErr('Fill in both: the token, and the repository as username/ember-life-data.'); return; }
    setBusy(true); setErr('');
    try {
      const problem = await sync.test(t, r);
      if (problem){ setErr(problem); return; }
      deviceSet({ token: t, repo: r });
      setToken('');
      await sync.now();
      showToast(sync.state === 'error' ? sync.error : 'Sync is on.');
    } catch (e){ setErr('Couldn’t reach GitHub. Check your connection.'); }
    finally { setBusy(false); }
  };
  if (sync.configured()){
    const line = sync.state === 'syncing' ? 'Syncing…' : sync.state === 'error' ? sync.error : 'Synced ' + ago(sync.lastAt);
    return html`<section class="card">
      <h2 class="card-title">Sync</h2>
      <p class=${'status' + (sync.state === 'error' ? ' bad' : '')}><${Ico} d=${sync.state === 'error' ? UI.x : UI.check} size=${16} sw=${3}/>${line}</p>
      <p class="hint">Saving to your private repository ${dev.repo}. Changes sync when you open or leave the app, and a few seconds after you edit something.</p>
      <div class="btn-row">
        <button class="btn btn-ghost sm" disabled=${sync.state === 'syncing'} onClick=${() => sync.now()}><${Ico} d=${UI.sync} size=${16}/>Sync now</button>
        <button class="btn btn-ghost sm" onClick=${() => { deviceSet({ token: '', lastSync: 0 }); sync.set('off'); }}>Turn off on this device</button>
      </div>
    </section>`;
  }
  return html`<section class="card">
    <h2 class="card-title">Sync between iPhone and Mac</h2>
    <p class="hint">Your data is saved on this device. To keep iPhone and Mac in step, connect a private GitHub repository. Do this once on each device.</p>
    <div class="field">
      <label class="label" for="gh-repo">Repository</label>
      <input id="gh-repo" class="input inset" placeholder="username/ember-life-data" autocomplete="off" autocapitalize="off" spellcheck="false" value=${repo} onInput=${e => { setRepo(e.target.value); setErr(''); }}/>
    </div>
    <div class="field">
      <label class="label" for="gh-token">GitHub token</label>
      <input id="gh-token" class="input inset" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false" value=${token} onInput=${e => { setToken(e.target.value); setErr(''); }}/>
    </div>
    ${err && html`<p class="status bad">${err}</p>`}
    <button class="btn btn-solid" disabled=${busy} onClick=${connect}>${busy ? 'Checking…' : 'Connect'}</button>
    <p class="hint">The token stays on this device only and can open nothing but that one repository.</p>
  </section>`;
}

/* Backup: Ember Life backups, and the old Day Planner backup file */
function BackupCard({ app }){
  const fileRef = useRef(null);
  const { showToast, setSheet, today } = app;
  const exportData = async () => {
    const data = JSON.stringify({ app: 'Ember Life', format: 1, exportedAt: new Date().toISOString(), docs: store.exportAll() }, null, 1);
    const name = 'ember-life-backup-' + today + '.json';
    try {
      const file = new File([data], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad/.test(navigator.userAgent)){
        await navigator.share({ files: [file], title: name });
        return;
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast('Backup saved to Downloads.');
    } catch (e){ if (!e || e.name !== 'AbortError') showToast('The backup couldn’t be saved. Try again.'); }
  };
  const importFile = async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    let j;
    try { j = JSON.parse(await f.text()); } catch (err){ showToast('That file isn’t a backup Ember Life can read.'); return; }
    if (j && j.app === 'Ember Life' && j.docs){
      setSheet({ kind: 'confirm', title: 'Replace everything?', ok: 'Replace', danger: true,
        text: 'This replaces all data in Ember Life with the backup from ' + (j.exportedAt ? new Date(j.exportedAt).toLocaleDateString() : 'that file') + '. Synced devices get the backup too.',
        run: () => { store.importAll(j.docs); showToast('Backup restored.'); } });
    } else if (j && (j.config || j.days)){
      const days = Array.isArray(j.days) ? j.days.filter(d => d && d.date) : [];
      setSheet({ kind: 'confirm', title: 'Import Day Planner?', ok: 'Import',
        text: 'Adds your categories, combos and ' + plural(days.length, 'day', 'days') + ' of history to the Planner. Planner data already in Ember Life is replaced.',
        run: () => {
          if (j.config) store.set('planner/config', j.config);
          if (j.current) store.set('planner/current', j.current);
          days.forEach(d => store.set('days/' + d.date, d));
          showToast('Day Planner imported.');
        } });
    } else showToast('That file isn’t a backup Ember Life can read.');
  };
  return html`<section class="card">
    <h2 class="card-title">Backup</h2>
    <p class="hint">Save everything as one file, or restore from one. You can also import your old Day Planner backup here.</p>
    <div class="btn-row">
      <button class="btn btn-ghost sm" onClick=${exportData}>Export backup</button>
      <button class="btn btn-ghost sm" onClick=${() => fileRef.current && fileRef.current.click()}>Import</button>
      <input ref=${fileRef} id="import-file" type="file" accept="application/json,.json" hidden onChange=${importFile}/>
    </div>
  </section>`;
}

/* Keys are cleaned of spaces, line breaks and invisible characters that copy-paste on iPhone can add */
const cleanKey = k => String(k || '').replace(/[\s\u200B-\u200D\uFEFF]+/g, '');
const keyPreview = k => k.length > 18 ? k.slice(0, 14) + '…' + k.slice(-4) + ' (' + k.length + ' characters)' : k;
function KeysCard({ showToast }){
  const dev = deviceGet();
  const [usda, setUsda] = useState(dev.usdaKey || '');
  const [claudeKey, setClaudeKey] = useState(dev.claudeKey || '');
  const [test, setTest] = useState(null);
  const saved = cleanKey(deviceGet().claudeKey);
  const save = () => { const u = cleanKey(usda), c = cleanKey(claudeKey); deviceSet({ usdaKey: u, claudeKey: c }); setUsda(u); setClaudeKey(c); setTest(null); showToast('Keys saved on this device.'); };
  const runTest = async () => {
    setTest({ state: 'busy' });
    let Anthropic = null;
    try { const c = await claude(); Anthropic = c.Anthropic; await c.client.messages.create({ model: 'claude-haiku-5-5', max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] }); setTest({ state: 'ok', text: 'The key works.' }); }
    catch (e){ setTest({ state: 'bad', text: aiError(Anthropic, e) }); }
  };
  return html`<section class="card">
    <h2 class="card-title">API keys</h2>
    <p class="hint">Food lookups use the free USDA key; the AI assistant uses your Claude key. Keys stay on this device and never sync.</p>
    <div class="field">
      <label class="label" for="key-usda">USDA FoodData Central</label>
      <input id="key-usda" class="input inset" type="password" placeholder="Free key from api.data.gov" autocomplete="off" autocapitalize="off" spellcheck="false" value=${usda} onInput=${e => setUsda(e.target.value)}/>
    </div>
    <div class="field">
      <label class="label" for="key-claude">Claude API</label>
      <input id="key-claude" class="input inset" type="password" placeholder="sk-ant-api03-…" autocomplete="off" autocapitalize="off" spellcheck="false" value=${claudeKey} onInput=${e => setClaudeKey(e.target.value)}/>
      ${saved && html`<p class="hint">Saved key: <b class="mono">${keyPreview(saved)}</b></p>`}
      ${saved && !saved.startsWith('sk-ant-api') && html`<p class="warn"><${Ico} d=${UI.alert} size=${16}/>This doesn’t look like an API key. Keys from console.anthropic.com → Settings → API keys start with sk-ant-api03-.</p>`}
    </div>
    <div class="btn-row">
      <button class="btn btn-ghost sm" onClick=${save}>Save keys</button>
      ${saved && html`<button class="btn btn-ghost sm" disabled=${test && test.state === 'busy'} onClick=${runTest}>${test && test.state === 'busy' ? 'Testing…' : 'Test Claude key'}</button>`}
    </div>
    ${test && test.text && html`<p class=${'status' + (test.state === 'bad' ? ' bad' : '')}><${Ico} d=${test.state === 'bad' ? UI.x : UI.check} size=${16} sw=${3}/>${test.text}</p>`}
  </section>`;
}
