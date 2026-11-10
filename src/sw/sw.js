/*
 * Spaghetti's service worker. Plain JavaScript, no dependencies: the Vite
 * plugin in scripts/vite-service-worker.ts prepends `self.__BUILD__` (a
 * version and the list of built files) and emits the result as /sw.js.
 *
 * What it does:
 *   - Precaches the app shell (index.html, scripts, styles, fonts, icons), so
 *     the app opens instantly and with no signal.
 *   - Serves photos already seen from a cache (they never change once saved, except originals still
 *     waiting to be resized, which the server marks no-cache and are never kept).
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
const SHARE_PATH = "/api/share";
const SHARE_CACHE = "sg-share";
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
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The share target (see public/manifest.webmanifest): the one POST the worker takes, so sharing works offline too.
  if (request.method === "POST" && url.pathname === SHARE_PATH) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== "GET") return;

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

/**
 * Keeps what was shared (title, text, url and image files) in a cache and redirects to the app's /share page, which
 * saves it as an idea and clears it. Nothing is lost if the page can't be reached right now: it is read later.
 */
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const id = crypto.randomUUID();
    const cache = await caches.open(SHARE_CACHE);
    const text = (name) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    const files = form.getAll("media").filter((value) => typeof value !== "string" && value.size > 0);
    await Promise.all(
      files.map((file, index) =>
        cache.put(`/__share/${id}/${index}`, new Response(file, { headers: { "Content-Type": file.type } })),
      ),
    );
    const meta = {
      title: text("title"),
      text: text("text"),
      url: text("url"),
      files: files.map((file) => ({ name: file.name, type: file.type })),
    };
    await cache.put(`/__share/${id}/meta`, Response.json(meta));
    return Response.redirect(new URL(`/share?id=${id}`, self.location.origin).href, 303);
  } catch {
    return Response.redirect(new URL("/share", self.location.origin).href, 303);
  }
}

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
  // An original waiting to be resized is served "no-cache": it will be replaced, so it is not kept here.
  if (response.ok && !/no-cache/.test(response.headers.get("Cache-Control") ?? "")) {
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
