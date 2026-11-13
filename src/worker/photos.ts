import { and, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import type { PhotoVariant } from "../shared/api.ts";
import { CHANGES_KEEP_MS } from "../shared/changes.ts";
import { PURGE_AFTER_MS } from "../shared/deleted.ts";
import { type Db, getDb } from "./db/index.ts";
import {
  attemptFiles,
  attempts,
  changes,
  comments,
  itemFiles,
  items,
  photos,
  recipes,
  shoppingItems,
  spools,
  twistFiles,
  twists,
  upkeepLogs,
} from "./db/schema.ts";

export function photoKey(photoId: string, variant: PhotoVariant): string {
  return `photos/${photoId}/${variant}`;
}

/**
 * What already stores its picture under photos/<photoId>/: an item's photo, a spool's label or an upkeep log entry
 * (deleted ones too, until the purge), as "item:<id>", "spool:<id>" or "log:<id>", or null when the id is free. The
 * three share one key space and the browser picks the id, so an upload under an id that is someone else's must be
 * refused: it would overwrite that picture, and replacing or purging it later would delete it.
 */
export async function photoOwner(db: Db, photoId: string): Promise<string | null> {
  const [photo, spool, log] = await db.batch([
    db.select({ itemId: photos.itemId }).from(photos).where(eq(photos.id, photoId)).limit(1),
    db.select({ id: spools.id }).from(spools).where(eq(spools.photoId, photoId)).limit(1),
    db.select({ id: upkeepLogs.id }).from(upkeepLogs).where(eq(upkeepLogs.photoId, photoId)).limit(1),
  ]);
  if (photo[0]) return `item:${photo[0].itemId}`;
  if (spool[0]) return `spool:${spool[0].id}`;
  if (log[0]) return `log:${log[0].id}`;
  return null;
}

/**
 * A slicer file's bytes and its plate's picture (a model's original, and its sliced .gcode.3mf), in the photos' bucket;
 * for a model sliced again, the slice it replaced and that one's picture, kept for its undo.
 */
export function fileKey(fileId: string, part: FilePart): string {
  return `files/${fileId}/${part}`;
}

export type FilePart = "file" | "thumb" | "sliced" | "previous" | "previous-thumb";

/** Every R2 object a file row may have: what the purge removes with it. */
export const fileKeys = (fileId: string) =>
  (["file", "thumb", "sliced", "previous", "previous-thumb"] as const).map((part) => fileKey(fileId, part));

export { PURGE_AFTER_MS };

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
    await env.PHOTOS.delete(batch.flatMap(fileKeys));
    await db.delete(attemptFiles).where(inArray(attemptFiles.id, batch));
  }
  const doomedItemFiles = await db
    .select({ id: itemFiles.id })
    .from(itemFiles)
    .where(
      or(and(isNotNull(itemFiles.deletedAt), lt(itemFiles.deletedAt, cutoff)), inArray(itemFiles.itemId, goneItems)),
    );
  for (let i = 0; i < doomedItemFiles.length; i += 50) {
    const batch = doomedItemFiles.slice(i, i + 50).map((file) => file.id);
    await env.PHOTOS.delete(batch.flatMap(fileKeys));
    await db.delete(itemFiles).where(inArray(itemFiles.id, batch));
  }
  const goneTwists = db
    .select({ id: twists.id })
    .from(twists)
    .where(and(isNotNull(twists.deletedAt), lt(twists.deletedAt, cutoff)));
  const doomedTwistFiles = await db
    .select({ id: twistFiles.id })
    .from(twistFiles)
    .where(
      or(
        and(isNotNull(twistFiles.deletedAt), lt(twistFiles.deletedAt, cutoff)),
        inArray(twistFiles.twistId, goneTwists),
      ),
    );
  for (let i = 0; i < doomedTwistFiles.length; i += 50) {
    const batch = doomedTwistFiles.slice(i, i + 50).map((file) => file.id);
    await env.PHOTOS.delete(batch.flatMap(fileKeys));
    await db.delete(twistFiles).where(inArray(twistFiles.id, batch));
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
  await db.delete(recipes).where(and(isNotNull(recipes.deletedAt), lt(recipes.deletedAt, cutoff)));
  await db.delete(twists).where(and(isNotNull(twists.deletedAt), lt(twists.deletedAt, cutoff)));
  await db.delete(comments).where(and(isNotNull(comments.deletedAt), lt(comments.deletedAt, cutoff)));
  // Their pictures first (R2 goes first, like the rest), so a cut-short purge leaves rows the next run finishes.
  const goneShopping = await db
    .select({ id: shoppingItems.id })
    .from(shoppingItems)
    .where(and(isNotNull(shoppingItems.deletedAt), lt(shoppingItems.deletedAt, cutoff)));
  // Every purged thing, picture source or not: clearing a link leaves the old object behind (a missing key is harmless).
  for (let at = 0; at < goneShopping.length; at += 500) {
    await env.PHOTOS.delete(goneShopping.slice(at, at + 500).map((row) => `shopping/${row.id}/picture`));
  }
  await db.delete(shoppingItems).where(and(isNotNull(shoppingItems.deletedAt), lt(shoppingItems.deletedAt, cutoff)));
  // The change feed keeps a month: anyone who was away longer is told to reload everything.
  // The newest row stays however old, so the cursor never goes back to a smaller number.
  await db
    .delete(changes)
    .where(and(lt(changes.at, new Date(now - CHANGES_KEEP_MS)), lt(changes.seq, sql`(SELECT max(seq) FROM changes)`)));
  return {
    photos: doomed.length,
    files: doomedFiles.length,
    spools: doomedSpools.length,
    attempts: purgedAttempts.length,
    items: purgedItems.length,
  };
}
