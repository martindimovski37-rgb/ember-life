import { html, render } from './lib.js';
import { App } from './app.js';
import { endSplash, installIgnite } from './fx.js';

const root = document.getElementById('app');
root.textContent = '';
render(html`<${App}/>`, root);
endSplash();
installIgnite();

/* iPhone ignores "no zoom" in the page settings, so block pinch-zoom gestures directly */
['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));

/* Offline support + home-screen app (skipped on the local test server) */
if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'){
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  /* a new version took over: reload once so the new screens show up */
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded){ reloaded = true; location.reload(); } });
}
