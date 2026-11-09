import type { Item, PhotoVariant } from "@shared/api";
import { photoUrl } from "@shared/api";
import { itemKeys } from "./items";

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

function want(photoId: string | undefined, variant: PhotoVariant) {
  if (!photoId) return;
  const url = photoUrl(photoId, variant);
  if (requested.has(url) || requested.size >= MAX_PER_SESSION) return;
  requested.add(url);
  queue.push(url);
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
  void pump();
}
