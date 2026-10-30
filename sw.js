/* Ember Life offline cache. The app's own files come straight from the phone, so it opens instantly even on a
   weak signal, and are refreshed in the background. A release (bump VERSION) installs a fresh copy of everything,
   and the app reloads once into it. */
const VERSION = 'ember-life-33';
const SHELL = ['./', 'index.html', 'css/app.css', 'vendor/preact-htm.umd.js', 'js/main.js', 'js/app.js', 'js/lib.js', 'js/fx.js', 'js/orb.js', 'js/voice.js', 'js/ember.js', 'js/store.js', 'js/planner.js', 'js/diet.js', 'js/gym.js', 'js/bodymap.js', 'js/claude.js', 'js/assistant.js', 'vendor/anthropic-sdk.mjs', 'vendor/node-buffer.mjs', 'data/exercises.json', 'vendor/zxing.min.js', 'vendor/three/three.min.js', 'vendor/three/CopyShader.js', 'vendor/three/LuminosityHighPassShader.js', 'vendor/three/EffectComposer.js', 'vendor/three/RenderPass.js', 'vendor/three/ShaderPass.js', 'vendor/three/UnrealBloomPass.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'sounds/boxing.m4a'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'ember-life-photos').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const own = url.origin === location.origin;
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  /* exercise photos: cache first, they never change */
  if (url.hostname === 'raw.githubusercontent.com' && url.pathname.startsWith('/yuhonas/free-exercise-db/')){
    e.respondWith(caches.open('ember-life-photos').then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => { if (res.ok || res.type === 'opaque') c.put(e.request, res.clone()); return res; }))));
    return;
  }
  if (!own && !font) return;   /* GitHub, USDA, Open Food Facts, Claude: always live */
  const fresh = fetch(own ? e.request.url : e.request, own ? { cache: 'no-cache' } : undefined).then(res => {
    if (res.ok || res.type === 'opaque'){ const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  });
  e.waitUntil(fresh.then(() => {}, () => {}));
  e.respondWith(caches.open(VERSION).then(c => c.match(e.request, { ignoreSearch: true })).then(hit => hit
    || fresh.catch(() => e.request.mode === 'navigate' ? caches.match('index.html') : undefined)));
});
