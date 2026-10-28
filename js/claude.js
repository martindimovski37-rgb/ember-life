/* Connection to the Claude API through Anthropic's official JavaScript SDK (vendored, loaded on first use).
   The key stays on this device (Settings → API keys) and requests go straight from the phone to Anthropic. */
import { store, deviceGet } from './store.js';

export const AI_MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5', 'Smartest. About 2–5 cents a message.'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5', 'Fast and very capable. About half the cost.'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5', 'Quickest and cheapest, less careful with numbers.']
];
export const aiModel = () => (store.get('settings/app') || {}).aiModel || 'claude-opus-5-5';

let SDK = null;
export async function claude(){
  const key = deviceGet().claudeKey;
  if (!key) throw new Error('Add your Claude key in Settings → API keys first.');
  if (!SDK) SDK = (await import('../vendor/anthropic-sdk.mjs')).default;
  return { Anthropic: SDK, client: new SDK({ apiKey: key, dangerouslyAllowBrowser: true }) };
}

/* Server-side fallback: if a safety check declines a request, the API re-runs it on the recommended model.
   Haiku has no server-side fallback, so it goes without. */
export const fallbackParams = model => model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

export function aiError(Anthropic, e){
  if (Anthropic && e instanceof Anthropic.AuthenticationError) return 'Claude didn’t accept your key. Check it in Settings → API keys.';
  if (Anthropic && e instanceof Anthropic.PermissionDeniedError) return 'This key isn’t allowed to use that model. Check your Anthropic Console.';
  if (Anthropic && e instanceof Anthropic.RateLimitError) return 'Too many requests right now. Wait a minute and try again.';
  if (Anthropic && e instanceof Anthropic.BadRequestError) return /credit/i.test(e.message || '') ? 'Your Anthropic credit has run out. Top it up in the Anthropic Console.' : 'Claude couldn’t handle that request. Try rephrasing it.';
  if (Anthropic && e instanceof Anthropic.APIConnectionError) return navigator.onLine === false ? 'You’re offline. The assistant needs a connection.' : 'Couldn’t reach Claude. Check your connection and try again.';
  if (Anthropic && e instanceof Anthropic.APIError) return 'Claude had a problem (' + (e.status || 'error') + '). Try again in a moment.';
  return e && e.message ? e.message : 'Something went wrong. Try again.';
}
