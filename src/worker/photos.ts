import { and, inArray, isNotNull, lt, or } from "drizzle-orm";
import type { PhotoVariant } from "../shared/api.ts";
import { getDb } from "./db/index.ts";
import { attemptFiles, attempts, items, photos, spools } from "./db/schema.ts";

export function photoKey(photoId: string, variant: PhotoVariant): string {
  return `photos/${photoId}/${variant}`;
}

/** A slicer file's bytes and its plate's picture, in the same bucket as the photos. */
export function fileKey(fileId: string, part: "file" | "thumb"): string {
  return `files/${fileId}/${part}`;
}

/** Deleted things stay restorable this long, then the daily purge removes them. */
export const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Removes items, attempts, photos, slicer files and spools deleted more than
 * PURGE_AFTER_MS ago (an item's or attempt's photos and files go with it),
 * with their R2 objects. Runs from the Worker's daily cron trigger. R2 goes first, so a
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
  const doomedFiles = await db
    .select({ id: attemptFiles.id })
    .from(attemptFiles)
    .where(
      or(
        and(isNotNull(attemptFiles.deletedAt), lt(attemptFiles.deletedAt, cutoff)),
        inArray(attemptFiles.attemptId, goneAttempts),
        inArray(
          attemptFiles.attemptId,
          db.select({ id: attempts.id }).from(attempts).where(inArray(attempts.itemId, goneItems)),
        ),
      ),
    );
  for (let i = 0; i < doomedFiles.length; i += 50) {
    const batch = doomedFiles.slice(i, i + 50).map((file) => file.id);
    await env.PHOTOS.delete(batch.flatMap((fileId) => [fileKey(fileId, "file"), fileKey(fileId, "thumb")]));
    await db.delete(attemptFiles).where(inArray(attemptFiles.id, batch));
  }
  const doomedSpools = await db
    .select({ id: spools.id, photoId: spools.photoId })
    .from(spools)
    .where(and(isNotNull(spools.deletedAt), lt(spools.deletedAt, cutoff)));
  for (let i = 0; i < doomedSpools.length; i += 50) {
    const batch = doomedSpools.slice(i, i + 50);
    const keys = batch.flatMap((spool) =>
      spool.photoId ? [photoKey(spool.photoId, "large"), photoKey(spool.photoId, "thumb")] : [],
    );
    if (keys.length) await env.PHOTOS.delete(keys);
    // Their slots go with them (ON DELETE CASCADE).
    await db.delete(spools).where(
      inArray(
        spools.id,
        batch.map((spool) => spool.id),
      ),
    );
  }
  const purgedAttempts = await db
    .delete(attempts)
    .where(or(and(isNotNull(attempts.deletedAt), lt(attempts.deletedAt, cutoff)), inArray(attempts.itemId, goneItems)))
    .returning({ id: attempts.id });
  const purgedItems = await db
    .delete(items)
    .where(and(isNotNull(items.deletedAt), lt(items.deletedAt, cutoff)))
    .returning({ id: items.id });
  return {
    photos: doomed.length,
    files: doomedFiles.length,
    spools: doomedSpools.length,
    attempts: purgedAttempts.length,
    items: purgedItems.length,
  };
}
