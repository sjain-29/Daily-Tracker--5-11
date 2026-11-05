// js/pwa.js — service worker registration, update prompts and the install experience.

let deferredPrompt = null;
const listeners = new Set();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // show our own install button instead of the mini-infobar
  deferredPrompt = e;
  listeners.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => { deferredPrompt = null; listeners.forEach((fn) => fn()); });

export const onInstallAvailabilityChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const canPromptInstall = () => !!deferredPrompt;
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  listeners.forEach((fn) => fn());
  return outcome;
}

/** Registers sw.js. `onUpdate(applyFn)` is called when a new version is waiting. */
export function registerServiceWorker({ onUpdate } = {}) {
  if (!('serviceWorker' in navigator)) return;
  const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!secure) return;
  // Reload only after the user accepted an update — never when the very first service worker
  // takes control (that would interrupt someone typing on first visit).
  let updateAccepted = false;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateAccepted || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const announce = (worker) => onUpdate?.(() => { updateAccepted = true; worker.postMessage({ type: 'SKIP_WAITING' }); });
    if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) announce(worker);
      });
    });
    // Check for a new version when the app regains focus (GitHub Pages deploys).
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch((err) => console.warn('[pwa] service worker registration failed', err));
}
