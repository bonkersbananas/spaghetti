import { and, inArray, isNotNull, lt, or } from "drizzle-orm";
import type { PhotoVariant } from "../shared/api.ts";
import { getDb } from "./db/index.ts";
import { attempts, items, photos } from "./db/schema.ts";

export function photoKey(photoId: string, variant: PhotoVariant): string {
  return `photos/${photoId}/${variant}`;
}

/** Deleted things stay restorable this long, then the daily purge removes them. */
export const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Removes items, attempts and photos deleted more than PURGE_AFTER_MS ago
 * (an item's or attempt's photos go with it), with their R2 objects. Runs from the Worker's daily cron trigger. R2 goes first, so a
 * purge cut short leaves rows that the next run finishes, never orphaned files.
 */
export async function purgeDeleted(env: Env, now = Date.now()) {
  const db = getDb(env.DB);
  const cutoff = new Date(now - PURGE_AFTER_MS);
  const goneItems = db
    .select({ id: items.id })
    .from(items)
    .where(and(isNotNull(items.deletedAt), lt(items.deletedAt, cutoff)));
  const goneAttempts = db
    .select({ id: attempts.id })
    .from(attempts)
    .where(and(isNotNull(attempts.deletedAt), lt(attempts.deletedAt, cutoff)));
  const doomed = await db
    .select({ id: photos.id })
    .from(photos)
    .where(
      or(
        and(isNotNull(photos.deletedAt), lt(photos.deletedAt, cutoff)),
        inArray(photos.itemId, goneItems),
        inArray(photos.attemptId, goneAttempts),
      ),
    );

  // R2 deletes up to 1,000 keys per call; D1 binds up to 100 parameters.
  for (let i = 0; i < doomed.length; i += 50) {
    const batch = doomed.slice(i, i + 50).map((photo) => photo.id);
    await env.PHOTOS.delete(batch.flatMap((photoId) => [photoKey(photoId, "large"), photoKey(photoId, "thumb")]));
    await db.delete(photos).where(inArray(photos.id, batch));
  }
  const purgedAttempts = await db
    .delete(attempts)
    .where(or(and(isNotNull(attempts.deletedAt), lt(attempts.deletedAt, cutoff)), inArray(attempts.itemId, goneItems)))
    .returning({ id: attempts.id });
  const purgedItems = await db
    .delete(items)
    .where(and(isNotNull(items.deletedAt), lt(items.deletedAt, cutoff)))
    .returning({ id: items.id });
  return { photos: doomed.length, attempts: purgedAttempts.length, items: purgedItems.length };
}
