/* Ember Life offline cache. Network first so updates show up right away; the cache is the fallback
   when there's no signal (e.g. in the gym). Bump VERSION when files are added. */
const VERSION = 'ember-life-6';
const SHELL = ['./', 'index.html', 'css/app.css', 'vendor/preact-htm.umd.js', 'js/main.js', 'js/app.js', 'js/lib.js', 'js/store.js', 'js/planner.js', 'js/diet.js', 'js/gym.js', 'js/bodymap.js', 'data/exercises.json', 'vendor/zxing.min.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok || res.type === 'opaque'){ const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
