/* Local-first storage + GitHub sync.
   Every record is a "doc" at a path ("planner/config", "days/2026-10-27", ...) stored as { v, t }:
   v = the data (null = deleted), t = when it last changed. Syncing merges two copies doc by doc,
   newest change wins, so edits on the iPhone and the Mac never wipe each other out wholesale.
   Device-only things (GitHub token, API keys) live in a separate key and never leave this device. */
import { clone } from './lib.js';

const KEY = 'ember-life-v1';
const DEVICE_KEY = 'ember-life-device';
const FILE = 'ember-life.json';

let docs = {};
try { docs = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e){ docs = {}; }
const subs = new Set();
let persistFailed = false;

function persist(){
  try { localStorage.setItem(KEY, JSON.stringify(docs)); persistFailed = false; }
  catch (e){ persistFailed = true; }
}
function notify(){ subs.forEach(f => { try { f(); } catch (e){ console.error(e); } }); }

export const store = {
  get(path){ const d = docs[path]; return d && d.v != null ? d.v : null; },
  set(path, v){ docs[path] = { v: clone(v), t: Date.now() }; persist(); notify(); sync.schedule(); },
  del(path){ if (!docs[path] || docs[path].v == null) return; docs[path] = { v: null, t: Date.now() }; persist(); notify(); sync.schedule(); },
  list(prefix){ return Object.keys(docs).filter(k => k.startsWith(prefix) && docs[k].v != null).map(k => docs[k].v); },
  raw(){ return docs; },
  subscribe(fn){ subs.add(fn); return () => subs.delete(fn); },
  get saveFailed(){ return persistFailed; },
  /* Merge another copy in. Returns { changed: local data changed, ahead: we have something the other copy lacks } */
  merge(other){
    let changed = false, ahead = false;
    const keys = new Set(Object.keys(docs).concat(Object.keys(other || {})));
    keys.forEach(k => {
      const a = docs[k], b = other && other[k];
      if (b && (!a || b.t > a.t)){ docs[k] = b; changed = true; }
      else if (a && (!b || a.t > b.t)) ahead = true;
    });
    if (changed){ persist(); notify(); }
    return { changed, ahead };
  },
  /* Replace everything from a backup file (still syncs: every doc gets a fresh timestamp) */
  importAll(fresh){
    const now = Date.now();
    Object.keys(docs).forEach(k => { if (!(k in fresh)) docs[k] = { v: null, t: now }; });
    Object.keys(fresh).forEach(k => { docs[k] = { v: fresh[k], t: now }; });
    persist(); notify(); sync.schedule(true);
  },
  exportAll(){
    const out = {};
    Object.keys(docs).forEach(k => { if (docs[k].v != null) out[k] = docs[k].v; });
    return out;
  }
};

/* ---------- This device only ---------- */
export function deviceGet(){
  try { return JSON.parse(localStorage.getItem(DEVICE_KEY) || '{}') || {}; } catch (e){ return {}; }
}
export function deviceSet(patch){
  const next = Object.assign(deviceGet(), patch);
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(next)); } catch (e){}
  notify();
  return next;
}

/* ---------- GitHub sync: one JSON file in the user's private repo ---------- */
const enc = s => { const b = new TextEncoder().encode(s); let out = ''; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(out); };
const dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));

async function gh(path, opts = {}){
  const { token } = deviceGet();
  const res = await fetch('https://api.github.com' + path, Object.assign({ cache: 'no-store' }, opts, {
    headers: Object.assign({ Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, opts.headers || {})
  }));
  return res;
}

export const sync = {
  state: 'off',          /* off | idle | syncing | error */
  error: '',
  lastAt: deviceGet().lastSync || 0,
  timer: null,
  running: null,
  configured(){ const d = deviceGet(); return !!(d.token && d.repo); },
  set(state, error = ''){ this.state = state; this.error = error; notify(); },
  schedule(soon){
    if (!this.configured()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.now(), soon ? 300 : 8000);
  },
  /* Pull, merge, push if we're ahead. Runs one at a time. */
  async now(){
    if (!this.configured()){ this.set('off'); return; }
    if (this.running) return this.running;
    clearTimeout(this.timer);
    this.running = (async () => {
      this.set('syncing');
      const { repo } = deviceGet();
      try {
        for (let attempt = 0; attempt < 3; attempt++){
          const r = await gh('/repos/' + repo + '/contents/' + FILE);
          let sha = null, remote = {};
          if (r.status === 200){
            const j = await r.json();
            sha = j.sha;
            let text = j.content ? dec(j.content) : '';
            if (!text && j.size > 0){
              const raw = await gh('/repos/' + repo + '/contents/' + FILE, { headers: { Accept: 'application/vnd.github.raw+json' } });
              text = await raw.text();
            }
            try { remote = (JSON.parse(text || '{}').docs) || {}; } catch (e){ remote = {}; }
          } else if (r.status !== 404) throw await ghError(r);
          const { ahead } = store.merge(remote);
          if (!ahead && sha) break;
          const body = JSON.stringify({ app: 'Ember Life', format: 1, savedAt: new Date().toISOString(), docs: store.raw() });
          const put = await gh('/repos/' + repo + '/contents/' + FILE, {
            method: 'PUT',
            body: JSON.stringify(Object.assign({ message: 'Sync ' + new Date().toISOString(), content: enc(body) }, sha ? { sha } : {}))
          });
          if (put.status === 200 || put.status === 201) break;
          if (put.status === 409 || put.status === 422) continue;  /* the other device saved first: pull again */
          throw await ghError(put);
        }
        this.lastAt = Date.now(); deviceSet({ lastSync: this.lastAt });
        this.set('idle');
      } catch (e){
        this.set('error', e && e.message ? e.message : 'Sync failed. Check your connection.');
      } finally { this.running = null; }
    })();
    return this.running;
  },
  /* Check the token and repo before saving them */
  async test(token, repo){
    const res = await fetch('https://api.github.com/repos/' + repo, { cache: 'no-store', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } });
    if (res.status === 200){
      const j = await res.json();
      if (!j.private) return 'That repository is public. Make it private first, so your data stays yours.';
      if (j.permissions && !j.permissions.push) return 'The token can read that repository but not save to it. Give it “Contents: Read and write”.';
      return '';
    }
    if (res.status === 401) return 'GitHub didn’t accept that token. Check you copied all of it.';
    if (res.status === 404) return 'Couldn’t find that repository with this token. Check the name and that the token has access to it.';
    return 'GitHub answered with an error (' + res.status + '). Try again in a minute.';
  }
};

async function ghError(res){
  if (res.status === 401) return new Error('Your GitHub token stopped working. Add a new one in Settings.');
  if (res.status === 403 || res.status === 404) return new Error('The token can’t open the data repository anymore. Check it in Settings.');
  return new Error('GitHub error ' + res.status + '. It will try again.');
}

/* Sync when the app opens, comes back to the front, or goes to the background */
if (typeof document !== 'undefined'){
  document.addEventListener('visibilitychange', () => { if (sync.configured()) sync.now(); });
  window.addEventListener('online', () => { if (sync.configured()) sync.now(); });
  setInterval(() => { if (document.visibilityState === 'visible' && sync.configured()) sync.now(); }, 120000);
}
