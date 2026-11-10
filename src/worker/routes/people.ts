import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  MAX_PROFILE_PHOTO_BYTES,
  type PeopleResponse,
  PHOTO_CONTENT_TYPES,
  type SessionResponse,
} from "../../shared/api.ts";
import { recordChange } from "../changes.ts";
import { users } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError, toPerson } from "../http.ts";

/** Picture bytes never change under their versioned address, so browsers may keep them for a year. */
const IMMUTABLE = "private, max-age=31536000, immutable";

/**
 * People, and your own profile picture. Changing it is person-only (not in auth/scopes.ts): a token
 * can read the picture's address in `person` objects but never set it.
 */
export const peopleRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await c.var.db.select().from(users).orderBy(asc(users.createdAt));
    return c.json<PeopleResponse>({ people: rows.map(toPerson) });
  })

  /** The picture's bytes; the `v` in the address is the version, so a new picture is a new address. */
  .get("/:id/photo", async (c) => {
    const row = await c.var.db
      .select({ key: users.photoKey })
      .from(users)
      .where(eq(users.id, c.req.param("id")))
      .get();
    const object = row?.key ? await c.env.PHOTOS.get(row.key, { onlyIf: c.req.raw.headers }) : null;
    if (!object) return apiError(c, 404, "not_found", "No picture here.");
    c.header("Cache-Control", IMMUTABLE);
    c.header("ETag", object.httpEtag);
    if (!("body" in object)) return c.body(null, 304);
    c.header("Content-Type", object.httpMetadata?.contentType ?? "image/webp");
    c.header("Content-Length", String(object.size));
    return c.body(object.body);
  })

  /** Sets your picture: a multipart body with one `photo` file, already square and small. */
  .put("/me/photo", async (c) => {
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > 2 * MAX_PROFILE_PHOTO_BYTES) return apiError(c, 413, "too_large", "That picture is too large.");
    const form = await c.req.formData().catch(() => null);
    const photo = form?.get("photo");
    if (!(photo instanceof File)) return apiError(c, 400, "invalid", "That picture couldn't be read.");
    if (!(PHOTO_CONTENT_TYPES as readonly string[]).includes(photo.type)) {
      return apiError(c, 415, "unsupported", "Pictures are uploaded as WebP or JPEG.");
    }
    if (photo.size === 0 || photo.size > MAX_PROFILE_PHOTO_BYTES) {
      return apiError(c, 413, "too_large", "That picture is too large.");
    }
    const me = c.var.user;
    const key = `people/${me.id}/${crypto.randomUUID().slice(0, 8)}`;
    await c.env.PHOTOS.put(key, photo.stream(), { httpMetadata: { contentType: photo.type } });
    const db = c.var.db;
    const [[updated]] = await db.batch([
      db.update(users).set({ photoKey: key }).where(eq(users.id, me.id)).returning(),
      recordChange(db, { entity: "person", id: me.id, action: "updated", actor: c.var.actor }),
    ]);
    if (!updated) return apiError(c, 404, "not_found", "No such person.");
    if (me.photoKey) await c.env.PHOTOS.delete(me.photoKey);
    return c.json<SessionResponse>({ user: toPerson(updated) });
  })

  /** Back to initials. */
  .delete("/me/photo", async (c) => {
    const me = c.var.user;
    const db = c.var.db;
    const [[updated]] = await db.batch([
      db.update(users).set({ photoKey: null }).where(eq(users.id, me.id)).returning(),
      recordChange(db, { entity: "person", id: me.id, action: "updated", actor: c.var.actor }),
    ]);
    if (me.photoKey) await c.env.PHOTOS.delete(me.photoKey);
    return c.json<SessionResponse>({ user: toPerson(updated ?? me) });
  });
