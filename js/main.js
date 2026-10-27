import { html, render } from './lib.js';
import { App } from './app.js';

const root = document.getElementById('app');
root.textContent = '';
render(html`<${App}/>`, root);

/* Offline support + home-screen app (skipped on the local test server) */
if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'){
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
