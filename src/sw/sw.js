/*
 * Spaghetti's service worker. Plain JavaScript, no dependencies: the Vite
 * plugin in scripts/vite-service-worker.ts prepends `self.__BUILD__` (a
 * version and the list of built files) and emits the result as /sw.js.
 *
 * What it does:
 *   - Precaches the app shell (index.html, scripts, styles, fonts, icons), so
 *     the app opens instantly and with no signal.
 *   - Serves photos already seen from a cache (they never change once saved).
 *   - Leaves everything else under /api alone: it goes to the network, every
 *     time, and is never cached, so nobody sees another person's stale edits.
 *   - Installs new versions in the background; the page offers a "Refresh"
 *     toast (SKIP_WAITING), otherwise the new version takes over once every
 *     tab has been closed.
 */
const { version, precache } = self.__BUILD__;

const SHELL_CACHE = `sg-shell-${version}`;
const PHOTO_CACHE = "sg-photos";
const SHELL_URL = "/";
const MAX_PHOTOS = 400;
const PHOTO_PATH = /^\/api\/photos\/[^/]+\/(thumb|large)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // index.html answers every client route. A copy, because a redirected
      // response can't be used to answer a navigation.
      const shell = await fetch(SHELL_URL, { cache: "reload" });
      if (!shell.ok) throw new Error(`The app shell answered ${shell.status}`);
      await cache.put(SHELL_URL, new Response(await shell.blob(), { headers: shell.headers }));
      await cache.addAll(precache.map((url) => new Request(url, { cache: "reload" })));
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("sg-shell-") && name !== SHELL_CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    // Only photos are ever kept; the rest of the API is always live.
    if (PHOTO_PATH.test(url.pathname)) event.respondWith(photo(event, request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(shell(request));
    return;
  }
  event.respondWith(asset(request));
});

async function shell(request) {
  const cached = await caches.match(SHELL_URL, { cacheName: SHELL_CACHE });
  return cached ?? fetch(request);
}

async function asset(request) {
  const cached = await caches.match(request, { cacheName: SHELL_CACHE });
  return cached ?? fetch(request);
}

async function photo(event, request) {
  const cache = await caches.open(PHOTO_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    event.waitUntil(
      (async () => {
        await cache.put(request, response.clone());
        const keys = await cache.keys();
        // Oldest first: keep the cache from growing without end.
        for (const key of keys.slice(0, Math.max(0, keys.length - MAX_PHOTOS))) await cache.delete(key);
      })(),
    );
  }
  return response;
}
