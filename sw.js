// sw.js — service worker: offline app shell + runtime caching. Firebase data traffic is never cached here
// (the Realtime Database SDK manages its own connection; the app keeps its own on-device queue).

const VERSION = '1.1.0';
const SHELL_CACHE = `flightdeck-shell-${VERSION}`;
const RUNTIME_CACHE = 'flightdeck-runtime-v1';

// App shell — keep this list in sync when adding files (README → "Updating the app").
const SHELL = [
  "./",
  "./index.html",
  "./login.html",
  "./manifest.json",
  "./css/responsive.css",
  "./css/style.css",
  "./css/themes.css",
  "./js/app.js",
  "./js/auth.js",
  "./js/boot-theme.js",
  "./js/charts.js",
  "./js/components.js",
  "./js/constants.js",
  "./js/database.js",
  "./js/firebase-config.js",
  "./js/firebase.js",
  "./js/icons.js",
  "./js/login.js",
  "./js/notifications.js",
  "./js/pwa.js",
  "./js/quick-start-data.js",
  "./js/quick-start.js",
  "./js/shared.js",
  "./js/store.js",
  "./js/task-logic.js",
  "./js/task-modal.js",
  "./js/theme.js",
  "./js/timer.js",
  "./js/ui.js",
  "./js/utils.js",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/badge-72.png",
  "./assets/icons/favicon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/maskable-512.png",
  "./assets/vendor/chart.umd.min.js",
  "./js/views/analytics.js",
  "./js/views/archive.js",
  "./js/views/calendar.js",
  "./js/views/dashboard.js",
  "./js/views/kanban.js",
  "./js/views/notes.js",
  "./js/views/projects.js",
  "./js/views/settings.js",
  "./js/views/tasks.js",
  "./js/views/timeline.js"
];

// Firebase SDK modules (versioned URLs, safe to cache forever).
const SDK = [
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js",
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js"
];

const NETWORK_ONLY_HOSTS = [/firebaseio\.com$/, /firebasedatabase\.app$/, /googleapis\.com$/, /^www\.google\.com$/, /recaptcha/];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map((url) => shell.add(new Request(url, { cache: 'reload' })).catch((err) => console.warn('[sw] skip', url, err))));
    // Pre-cache the Firebase SDK too, but never let a slow CDN block installation.
    const runtime = await caches.open(RUNTIME_CACHE);
    const sdk = Promise.all(SDK.map((url) => runtime.add(new Request(url, { mode: 'cors' })).catch(() => {})));
    await Promise.race([sdk, new Promise((resolve) => setTimeout(resolve, 8000))]);
  })());
  // First install activates immediately; updates wait until the user accepts "Reload".
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('flightdeck-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (NETWORK_ONLY_HOSTS.some((re) => re.test(url.hostname)) && !url.pathname.startsWith('/firebasejs/')) return;

  // Page navigations: network first (fresh deploys), fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetchWithTimeout(req, 5000);
        if (res.ok && url.origin === self.location.origin) (await caches.open(SHELL_CACHE)).put(stripQuery(req), res.clone());
        return res;
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        const page = url.pathname.endsWith('login.html') ? './login.html' : './index.html';
        return (await cache.match(stripQuery(req))) || (await cache.match(page)) || Response.error();
      }
    })());
    return;
  }

  // Same-origin static files: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
    return;
  }

  // Versioned CDN files (Firebase SDK, Google Fonts): cache first.
  if (url.hostname === 'www.gstatic.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })());
  }
});

// Clicking a notification focuses the app (or opens it) at the relevant view.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './index.html', self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (client.url.startsWith(self.registration.scope)) { await client.focus(); if ('navigate' in client) return client.navigate(target); return; }
    }
    return self.clients.openWindow(target);
  })());
});

function stripQuery(req) { const u = new URL(req.url); u.search = ''; u.hash = ''; return u.href; }
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}
