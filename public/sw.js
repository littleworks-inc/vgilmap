/*
 * VigilMap service worker: the APP SHELL only.
 *
 * What it does: lets the app open with no connection (the page, its scripts and styles, the icons).
 * What it deliberately does NOT do: touch /api/*, or anything on another origin (map tiles, fonts).
 * VigilMap shows live hazards, so a cached answer must never pass for a current one; the page itself
 * says when it is offline and keeps only what it already holds in memory.
 *
 *   navigation to "/"     network first (so a new deploy shows up), cached shell if the network fails
 *   /assets/*             cache first (file names carry a content hash, so a cached file never goes stale)
 *   /icons/*, manifest    stale-while-revalidate
 *   everything else       left to the network
 */
const SHELL = 'vigil-shell-v1';
const PRECACHE = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon.svg'];
const NAV_TIMEOUT_MS = 4000;
// Cache lookups ignore `Vary`: the server answers "Vary: Origin", and module scripts send an Origin header
// that the precache fetch did not, so without this a cached script is a MISS and the app is blank offline.
// Safe here: everything cached is a same-origin static file.
const MATCH = { ignoreVary: true };
const MAX_ASSETS = 60; // hashed files pile up across deploys; past this, drop the ones the current page no longer uses

/** Same-origin /assets/... URLs a page's HTML refers to (scripts, stylesheets, preloads). */
function assetUrlsIn(html) {
  const urls = new Set();
  for (const m of html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)) urls.add(m[1]);
  return [...urls];
}

async function precacheShell() {
  const cache = await caches.open(SHELL);
  const res = await fetch('/', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`shell unavailable (${res.status})`);
  const html = await res.clone().text();
  await cache.put('/', res);
  // The page was loaded BEFORE this worker existed, so its files did not pass through us: fetch them now,
  // otherwise going offline right after the first visit would leave a shell with no scripts.
  await Promise.all([...PRECACHE.filter(u => u !== '/'), ...assetUrlsIn(html)].map(u => cache.add(u).catch(() => {})));
}

self.addEventListener('install', event => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== SHELL) await caches.delete(name);
    await self.clients.claim();
  })());
});

async function pruneAssets(cache, html) {
  const keys = await cache.keys();
  const assets = keys.filter(r => new URL(r.url).pathname.startsWith('/assets/'));
  if (assets.length <= MAX_ASSETS) return;
  const wanted = new Set(assetUrlsIn(html));
  await Promise.all(assets.filter(r => !wanted.has(new URL(r.url).pathname)).map(r => cache.delete(r)));
}

async function navigate(request) {
  const cache = await caches.open(SHELL);
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS));
    const res = await Promise.race([fetch(request), timeout]);
    if (res.ok) {
      const copy = res.clone();
      await cache.put('/', res.clone());
      void copy.text().then(html => pruneAssets(cache, html)).catch(() => {});
    }
    return res;
  } catch {
    const shell = await cache.match('/', MATCH);
    if (shell) return shell;
    throw new Error('offline and no cached shell');
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request, MATCH);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request, MATCH);
  const fresh = fetch(request).then(res => { if (res.ok) void cache.put(request, res.clone()); return res; });
  if (hit) { void fresh.catch(() => {}); return hit; }
  return fresh;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // map tiles, fonts, other APIs: never ours to cache
  if (url.pathname.startsWith('/api/')) return;    // live data always comes from the network

  if (request.mode === 'navigate') {
    if (url.pathname === '/') event.respondWith(navigate(request)); // /api-docs.html etc. are not the app
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(staleWhileRevalidate(request));
  }
});
