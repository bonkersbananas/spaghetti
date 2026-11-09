import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { PHOTO_VARIANTS, type PhotoResponse, type PhotoVariant } from "../../shared/api.ts";
import { items, photos } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError, toApiPhoto } from "../http.ts";
import { photoKey } from "../photos.ts";

/** A photo's bytes never change (a new photo gets a new id), so browsers may keep them for a year. */
const IMMUTABLE = "private, max-age=31536000, immutable";

export const photoRoutes = new Hono<AppEnv>()
  /** The pixels, for signed-in people only. */
  .get("/:id/:variant", async (c) => {
    const variant = c.req.param("variant") as PhotoVariant;
    if (!PHOTO_VARIANTS.includes(variant)) return apiError(c, 404, "not_found", "No such photo size.");
    const key = photoKey(c.req.param("id"), variant);
    const object = await c.env.PHOTOS.get(key, { onlyIf: c.req.raw.headers });
    if (!object) return apiError(c, 404, "not_found", "That photo isn't here.");
    c.header("Cache-Control", IMMUTABLE);
    c.header("ETag", object.httpEtag);
    // A conditional request that matched: the browser's copy is current.
    if (!("body" in object)) return c.body(null, 304);
    c.header("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
    c.header("Content-Length", String(object.size));
    return c.body(object.body);
  })

  /** Removes a photo from its item at once; restore brings it back (undo). */
  .delete("/:id", async (c) => {
    const result = await c.var.db
      .update(photos)
      .set({ deletedAt: new Date() })
      .where(and(eq(photos.id, c.req.param("id")), isNull(photos.deletedAt)))
      .returning({ itemId: photos.itemId });
    if (!result[0]) return apiError(c, 404, "not_found", "That photo isn't here.");
    await c.var.db.update(items).set({ updatedAt: new Date() }).where(eq(items.id, result[0].itemId));
    return c.body(null, 204);
  })

  .post("/:id/restore", async (c) => {
    const [photo] = await c.var.db
      .update(photos)
      .set({ deletedAt: null })
      .where(and(eq(photos.id, c.req.param("id")), isNotNull(photos.deletedAt)))
      .returning();
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
