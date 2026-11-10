import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { PHOTO_VARIANTS, type PhotoResponse, type PhotoVariant, type ResizeClaimResponse } from "../../shared/api.ts";
import { afterChange, recordChange } from "../changes.ts";
import { items, photos } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError, toApiPhoto } from "../http.ts";
import { photoKey } from "../photos.ts";

/** A photo's bytes never change (a new photo gets a new id), so browsers may keep them for a year. */
const IMMUTABLE = "private, max-age=31536000, immutable";
/** How long one browser has to finish resizing a photo before another may try. */
export const CLAIM_FOR_MS = 5 * 60 * 1000;

export const photoRoutes = new Hono<AppEnv>()
  /** The pixels, for signed-in people only. */
  .get("/:id/:variant", async (c) => {
    const variant = c.req.param("variant") as PhotoVariant;
    if (!PHOTO_VARIANTS.includes(variant)) return apiError(c, 404, "not_found", "No such photo size.");
    const key = photoKey(c.req.param("id"), variant);
    const object = await c.env.PHOTOS.get(key, { onlyIf: c.req.raw.headers });
    if (!object) return apiError(c, 404, "not_found", "That photo isn't here.");
    // An original waiting to be resized will be replaced: browsers must check back, not keep it for a year.
    c.header("Cache-Control", object.customMetadata?.provisional ? "private, no-cache" : IMMUTABLE);
    c.header("ETag", object.httpEtag);
    // A conditional request that matched: the browser's copy is current.
    if (!("body" in object)) return c.body(null, 304);
    c.header("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
    c.header("Content-Length", String(object.size));
    return c.body(object.body);
  })

  /**
   * A browser takes the job of resizing a photo that arrived without one (needs_resize), so two people's
   * browsers don't both decode a big image. The claim lapses after CLAIM_FOR_MS if the job never finishes.
   * This is bookkeeping, not something anyone sees, so it isn't a change in the feed.
   */
  .post("/:id/resize-claim", async (c) => {
    const photoId = c.req.param("id");
    const now = Date.now();
    const [claimed] = await c.var.db
      .update(photos)
      .set({ resizeClaimedAt: new Date(now) })
      .where(
        and(
          eq(photos.id, photoId),
          eq(photos.needsResize, true),
          isNull(photos.deletedAt),
          or(isNull(photos.resizeClaimedAt), lt(photos.resizeClaimedAt, new Date(now - CLAIM_FOR_MS))),
        ),
      )
      .returning({ id: photos.id });
    if (claimed) return c.json<ResizeClaimResponse>({ claimed: true });
    const exists = await c.var.db.select({ id: photos.id }).from(photos).where(eq(photos.id, photoId)).get();
    if (!exists) return apiError(c, 404, "not_found", "That photo isn't here.");
    return c.json<ResizeClaimResponse>({ claimed: false });
  })

  /** Removes a photo from its item at once; restore brings it back (undo). */
  .delete("/:id", async (c) => {
    const photoId = c.req.param("id");
    const db = c.var.db;
    const itemOfPhoto = sql`(SELECT item_id FROM photos WHERE id = ${photoId})`;
    const [result] = await db.batch([
      db
        .update(photos)
        .set({ deletedAt: new Date() })
        .where(and(eq(photos.id, photoId), isNull(photos.deletedAt)))
        .returning({ itemId: photos.itemId }),
      recordChange(db, {
        entity: "photo",
        id: photoId,
        itemId: itemOfPhoto,
        action: "deleted",
        actor: c.var.actor,
      }),
      db
        .update(items)
        .set({ updatedAt: new Date() })
        .where(and(sql`${items.id} = ${itemOfPhoto}`, afterChange)),
    ]);
    if (!result[0]) return apiError(c, 404, "not_found", "That photo isn't here.");
    return c.body(null, 204);
  })

  .post("/:id/restore", async (c) => {
    const photoId = c.req.param("id");
    const db = c.var.db;
    const itemOfPhoto = sql`(SELECT item_id FROM photos WHERE id = ${photoId})`;
    const [[photo]] = await db.batch([
      db
        .update(photos)
        .set({ deletedAt: null })
        .where(and(eq(photos.id, photoId), isNotNull(photos.deletedAt)))
        .returning(),
      recordChange(db, {
        entity: "photo",
        id: photoId,
        itemId: itemOfPhoto,
        action: "restored",
        actor: c.var.actor,
      }),
      db
        .update(items)
        .set({ updatedAt: new Date() })
        .where(and(sql`${items.id} = ${itemOfPhoto}`, afterChange)),
    ]);
    const existing =
      photo ??
      (await c.var.db
        .select()
        .from(photos)
        .where(eq(photos.id, c.req.param("id")))
        .get());
    if (!existing) return apiError(c, 404, "not_found", "That photo is gone for good.");
    return c.json<PhotoResponse>({ photo: toApiPhoto(existing) });
  });
