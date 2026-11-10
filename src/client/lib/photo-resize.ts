import type { Item, Photo, PhotoResponse, ResizeClaimResponse } from "@shared/api";
import { photoUrl } from "@shared/api";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { isOnline } from "./connection";
import { processPhoto } from "./images";
import { itemKeys, patchCachedItem } from "./items";

/**
 * Photos that reach the server without a browser (an agent's capture, later the
 * printer bridge's camera frames) are stored at full size as their own thumbnail,
 * with a placeholder colour, and flagged `needsResize`. The first signed-in
 * browser that sees one resizes it here, in idle time and with nothing to see:
 * it fetches the large image, makes the two variants and the average colour with
 * the same pipeline as every other photo (`processPhoto`), and uploads them over
 * the originals, which clears the flag. Until then the grid shows the placeholder
 * colour and loads the original lazily, as for any photo.
 *
 * Once per photo: tabs share a Web Lock per photo, and the server hands out one
 * claim at a time (it lapses after a few minutes if the job never finishes), so
 * two people's browsers don't both decode a big image. If two do race, the second
 * upload writes the same thing again, which is harmless.
 */
const RETRY_AFTER_MS = 5 * 60 * 1000;
const failedAt = new Map<string, number>();
let running = false;

function unresizedPhotos(queryClient: QueryClient): Photo[] {
  const found = new Map<string, Photo>();
  for (const [, data] of queryClient.getQueriesData<Item[] | Item | null>({ queryKey: itemKeys.all })) {
    const items = Array.isArray(data) ? data : data ? [data] : [];
    for (const item of items) for (const photo of item.photos) if (photo.needsResize) found.set(photo.id, photo);
  }
  const now = Date.now();
  return [...found.values()].filter((photo) => now - (failedAt.get(photo.id) ?? 0) > RETRY_AFTER_MS);
}

/** Resizes one photo. Returns quietly whenever it isn't this browser's job. */
async function resizeOne(queryClient: QueryClient, photo: Photo) {
  const work = async (): Promise<boolean> => {
    const { claimed } = await api<ResizeClaimResponse>(`/photos/${photo.id}/resize-claim`, { method: "POST" });
    if (!claimed) return false;
    const original = await fetch(photoUrl(photo.id, "large"), { credentials: "same-origin" });
    if (!original.ok) throw new Error(`The original answered ${original.status}`);
    const processed = await processPhoto(await original.blob());
    const form = new FormData();
    form.set("width", String(processed.width));
    form.set("height", String(processed.height));
    form.set("color", processed.color);
    form.set("large", processed.large, "large");
    form.set("thumb", processed.thumb, "thumb");
    const { photo: saved } = await api<PhotoResponse>(`/items/${photo.itemId}/photos/${photo.id}`, {
      method: "PUT",
      body: form,
    });
    patchCachedItem(queryClient, photo.itemId, (item) => ({
      ...item,
      photos: item.photos.map((p) => (p.id === saved.id ? { ...p, ...saved } : p)),
    }));
    return true;
  };
  let done = false;
  try {
    // Another tab of this browser may be on it already.
    done = navigator.locks
      ? ((await navigator.locks.request(`spaghetti-resize-${photo.id}`, { ifAvailable: true }, (lock) =>
          lock ? work() : false,
        )) as boolean)
      : await work();
  } catch {
    // Too big to decode here, offline, refused: leave it for later.
  }
  // Not done (someone else has it, or it failed): don't ask again for a while. If it is still flagged then, try again.
  if (!done) failedAt.set(photo.id, Date.now());
}

function whenIdle(run: () => void) {
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 15_000 });
  else setTimeout(run, 2000);
}

/** Starts watching what the item queries hold; returns the cleanup. */
export function followUnresizedPhotos(queryClient: QueryClient) {
  let scheduled = false;
  let stopped = false;

  async function pump() {
    if (running || stopped) return;
    running = true;
    try {
      // One at a time, and only while someone is looking at a connected app.
      for (let photo = unresizedPhotos(queryClient)[0]; photo; photo = unresizedPhotos(queryClient)[0]) {
        if (stopped || !isOnline() || document.visibilityState === "hidden") return;
        await resizeOne(queryClient, photo);
        // Let the browser breathe between photos.
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (scheduled || stopped) return;
    if (!unresizedPhotos(queryClient).length) return;
    scheduled = true;
    whenIdle(() => {
      scheduled = false;
      void pump();
    });
  }

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.query.queryKey[0] === itemKeys.all[0]) schedule();
  });
  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("online", schedule);
  schedule();
  return () => {
    stopped = true;
    unsubscribe();
    document.removeEventListener("visibilitychange", schedule);
    window.removeEventListener("online", schedule);
  };
}
