import type { Item, PhotoVariant } from "@shared/api";
import { photoUrl } from "@shared/api";
import { itemKeys } from "./item-keys";

/**
 * Photos are the point of the app, offline too. The service worker keeps
 * every photo it has served, but a photo below the fold of a list was never
 * asked for, and the large version of a build's photos only when opened. When
 * items arrive from the server, this quietly fetches (low priority, two at a
 * time) the pictures that offline screens will want: card thumbnails from the
 * lists, and for a build or idea opened online its thumbnails plus the large
 * hero and the lead photo of each attempt. What is fetched goes through the
 * service worker, so it lands in the same photo cache.
 */
const MAX_PER_SESSION = 240;
const requested = new Set<string>();
const queue: string[] = [];
let running = 0;

function hero(item: Item) {
  return item.photos.find((p) => p.id === item.coverPhotoId) ?? item.photos.find((p) => !p.attemptId) ?? item.photos[0];
}

function newest(item: Item) {
  return item.photos.reduce<Item["photos"][number] | undefined>(
    (best, photo) => (!best || photo.createdAt > best.createdAt ? photo : best),
    undefined,
  );
}

/** Photos that are still full-size originals waiting to be resized: warming them would download the whole thing. */
const unresized = new Set<string>();

function want(photoId: string | undefined, variant: PhotoVariant) {
  if (!photoId || unresized.has(photoId)) return;
  const url = photoUrl(photoId, variant);
  if (requested.has(url) || requested.size >= MAX_PER_SESSION) return;
  requested.add(url);
  queue.push(url);
}

/**
 * Warming starts a moment after a list arrives, once the browser is idle, so
 * it doesn't compete with the photos on screen for a phone's connection;
 * then it goes two at a time.
 */
let scheduled = false;
function schedulePump() {
  if (scheduled) return;
  scheduled = true;
  const start = () => {
    scheduled = false;
    void pump();
  };
  // The screen's own photos start loading as it renders; give them a head start, then wait for a quiet moment.
  setTimeout(() => {
    if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 3000 });
    else start();
  }, 1500);
}

async function pump() {
  while (running < 2 && queue.length) {
    const url = queue.shift();
    if (!url) break;
    running++;
    void fetch(url, { priority: "low" } as RequestInit)
      .then((response) => response.blob())
      .catch(() => undefined)
      .finally(() => {
        running--;
        void pump();
      });
  }
}

const connection = (): { saveData?: boolean } | undefined =>
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;

/** Called with what a successful query returned; only item lists and item pages matter. */
export function warmPhotosFor(queryKey: readonly unknown[], data: unknown) {
  if (queryKey[0] !== itemKeys.all[0] || !navigator.onLine || connection()?.saveData) return;
  const items = Array.isArray(data) ? (data as Item[]) : data ? [data as Item] : [];
  for (const item of items) for (const photo of item.photos ?? []) if (photo.needsResize) unresized.add(photo.id);
  if (queryKey[1] === "list" && Array.isArray(data)) {
    for (const item of data as Item[]) {
      want(hero(item)?.id, "thumb");
      want(newest(item)?.id, "thumb");
    }
  } else if (queryKey[1] === "detail" && data) {
    const item = data as Item;
    want(hero(item)?.id, "large");
    for (const photo of item.photos.slice(0, 12)) want(photo.id, "thumb");
    for (const attempt of item.attempts) want(item.photos.find((p) => p.attemptId === attempt.id)?.id, "large");
  } else return;
  schedulePump();
}
