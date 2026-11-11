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
 *   - Shows the "how did it go?" notifications (web push) and answers them: a button records the outcome
 *     without opening the app, through the same /finish route the app uses; with no connection the answer
 *     is queued in the app's outbox (IndexedDB), which sends it on the next visit.
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
const PHOTO_PATH = /^\/api\/(photos\/[^/]+\/(thumb|large)|people\/[^/]+\/photo)$/;

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
  // The same thing a notification button does; the e2e test uses it, since a test can't tap one.
  else if (event.data?.type === "answer-nudge") event.waitUntil(answerNudge(event.data.nudge, event.data.outcome));
});

// ---- "How did it go?" notifications (web push) ----

const OUTCOME_LABEL = { success: "Worked", partial: "Partly", failed: "Spaghetti" };

self.addEventListener("push", (event) => {
  event.waitUntil(showNudge(event));
});

async function showNudge(event) {
  let message = null;
  try {
    message = event.data?.json() ?? null;
  } catch {
    // Not ours to read: still show something, a push must always be visible.
  }
  const maxActions = self.Notification?.maxActions ?? 0;
  await self.registration.showNotification(message?.title ?? "Spaghetti", {
    body: message?.body ?? "",
    tag: message?.tag ?? "spaghetti",
    icon: "/icon-192.png",
    data: { url: message?.url ?? "/ideas", attemptId: message?.attemptId, itemId: message?.itemId },
    // Android and desktop Chrome have buttons; iPhone has none, and tapping the notification opens the sheet.
    actions: pickActions(message?.actions ?? [], maxActions),
  });
}

/** Desktop Chrome shows two buttons, Android three: with two, keep the first and last (Worked, Spaghetti); Partly is one tap away in the sheet. */
function pickActions(actions, max) {
  if (actions.length <= max) return actions;
  if (max <= 0) return [];
  return max === 1 ? actions.slice(0, 1) : [...actions.slice(0, max - 1), actions[actions.length - 1]];
}

self.addEventListener("notificationclick", (event) => {
  const { data } = event.notification;
  event.notification.close();
  if (event.action && OUTCOME_LABEL[event.action] && data?.attemptId) {
    event.waitUntil(answerNudge(data, event.action));
  } else {
    event.waitUntil(openApp(data?.url ?? "/ideas"));
  }
});

async function openApp(path) {
  const url = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const open = windows[0];
  if (open) {
    await open.focus().catch(() => undefined);
    // The app navigates itself (no reload); a page that doesn't know the message gets a plain navigation.
    open.postMessage({ type: "navigate", url: path });
    return;
  }
  await self.clients.openWindow(url);
}

/** Records the outcome a notification button picked. Offline or a server hiccup queues it in the outbox. */
async function answerNudge(nudge, outcome) {
  if (!nudge?.attemptId || !OUTCOME_LABEL[outcome]) return;
  const finishedAt = Date.now();
  let status = 0;
  try {
    const response = await fetch(`/api/attempts/${encodeURIComponent(nudge.attemptId)}/finish`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome, finishedAt }),
    });
    status = response.status;
  } catch {
    // No connection.
  }
  if (status >= 200 && status < 300) {
    await confirmAnswer(nudge, `Marked as ${OUTCOME_LABEL[outcome]}`, "Add a photo or a word whenever you like.");
  } else if (status === 401) {
    // Signed out on this device: sign in, then the sheet.
    await openApp(nudge.url);
  } else if (status === 400 || status === 404) {
    await confirmAnswer(nudge, "That print isn't there any more", "");
  } else if (nudge.itemId) {
    await queueFinish(nudge.itemId, {
      attemptId: nudge.attemptId,
      outcome,
      finishedAt,
      note: "",
      failureTags: [],
      successNotes: [],
    });
    await confirmAnswer(
      nudge,
      `Marked as ${OUTCOME_LABEL[outcome]}`,
      "Saved on this phone. It reaches Spaghetti when you're back online.",
    );
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) client.postMessage({ type: "outbox-changed" });
  }
}

/** A short-lived replacement for the notification, so a tap on a button has an answer; it clears itself. */
async function confirmAnswer(nudge, title, body) {
  const tag = `attempt-${nudge.attemptId}`;
  await self.registration.showNotification(title, {
    body,
    tag,
    icon: "/icon-192.png",
    silent: true,
    data: { url: nudge.url },
  });
  await new Promise((resolve) => setTimeout(resolve, 6000));
  for (const shown of await self.registration.getNotifications({ tag })) shown.close();
}

/** Adds a finish to the app's outbox (IndexedDB "spaghetti" / "outbox", the same shape lib/outbox.ts keeps). */
function queueFinish(itemId, finish) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("spaghetti", 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains("outbox"))
        open.result.createObjectStore("outbox", { keyPath: "itemId" });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("outbox", "readwrite");
      const store = tx.objectStore("outbox");
      const read = store.get(itemId);
      read.onsuccess = () => {
        const entry = read.result ?? { itemId, photos: [], queuedAt: Date.now() };
        // Answered twice before it was sent keeps the later answer.
        const finishes = (entry.finishes ?? []).filter((f) => f.attemptId !== finish.attemptId);
        store.put({ ...entry, finishes: [...finishes, finish] });
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

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
