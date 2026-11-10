import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { CaptureResponse } from "../../shared/api.ts";
import { captureNote, captureTitle, MAX_CAPTURE_PHOTOS } from "../../shared/capture.ts";
import { afterChange, recordChange } from "../changes.ts";
import { items, photos } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { fromBase64, type ImageInfo, readImage } from "../mcp/image.ts";
import { photoKey } from "../photos.ts";

const text = z.string().max(20_000).optional();
const fields = z.object({
  id: z.uuid().optional(),
  title: z.string().max(200).optional(),
  text,
  url: z.string().max(2000).optional(),
  /** A photo as base64 (JSON bodies only; multipart and raw bodies carry the file itself). */
  image: z.string().optional(),
});

/** A stand-in for the average color: a browser works out the real one when it resizes the photo. */
const NEUTRAL = "#a9a095";

/** A UUID made from the idea's id and the photo's place, the same every time. */
async function photoIdFor(itemId: string, position: number): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${itemId}:${position}`)));
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x40;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const blank = (value: string | null | undefined) => value?.trim() || undefined;

/**
 * The one-tap way in for things that can't run the app: an iOS Shortcut, a bookmarklet, a script.
 * Takes JSON (`{ url?, text?, title?, id? }`), a multipart form (the same fields, plus `image` files) or a
 * raw image body (`Content-Type: image/jpeg`, the fields in the query string), makes an idea of it and answers
 * with its link. Photos are stored as they came and flagged `needsResize` (decision 0004).
 */
export const captureRoutes = new Hono<AppEnv>().post("/", async (c) => {
  const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  let input: z.infer<typeof fields>;
  const files: Uint8Array[] = [];
  try {
    if (type.startsWith("image/")) {
      const q = c.req.query();
      input = fields.parse({ id: blank(q.id), title: blank(q.title), text: blank(q.text), url: blank(q.url) });
      files.push(new Uint8Array(await c.req.arrayBuffer()));
    } else if (type === "multipart/form-data") {
      const form = await c.req.formData();
      const value = (name: string) => {
        const entry = form.get(name);
        return typeof entry === "string" ? blank(entry) : undefined;
      };
      input = fields.parse({ id: value("id"), title: value("title"), text: value("text"), url: value("url") });
      for (const entry of form.values()) {
        if (typeof entry !== "string" && entry.size > 0) files.push(new Uint8Array(await entry.arrayBuffer()));
      }
    } else {
      input = fields.parse(await c.req.json());
      if (input.image) files.push(fromBase64(input.image));
    }
  } catch (error) {
    if (error instanceof z.ZodError) return apiError(c, 400, "invalid", "That couldn't be read.");
    if (error instanceof Error && /base64|JPEG|WebP|photo/i.test(error.message)) {
      return apiError(c, 400, "invalid", error.message);
    }
    return apiError(c, 400, "invalid", "That couldn't be read. Send JSON, a form or an image.");
  }

  const note = captureNote(input.text, input.url);
  const title = captureTitle(input.title, input.text, input.url);
  if (!note && !title && !files.length)
    return apiError(c, 400, "invalid", "Send a link, some text, a title or a photo.");
  if (files.length > MAX_CAPTURE_PHOTOS) {
    return apiError(c, 400, "invalid", `At most ${MAX_CAPTURE_PHOTOS} photos at a time.`);
  }
  const images: ImageInfo[] = [];
  try {
    for (const bytes of files) images.push(readImage(bytes));
  } catch (error) {
    // iPhones take HEIC: the Shortcut converts to JPEG first (see docs/share.md).
    return apiError(c, 415, "unsupported", error instanceof Error ? error.message : "That photo couldn't be read.");
  }

  const db = c.var.db;
  const itemId = input.id ?? crypto.randomUUID();
  const now = new Date();
  await db.batch([
    db
      .insert(items)
      .values({
        id: itemId,
        title,
        note,
        stage: "idea",
        createdBy: c.var.user.id,
        createdVia: c.var.via,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing(),
    recordChange(db, { entity: "item", id: itemId, itemId, action: "created", actor: c.var.actor }),
  ]);
  const item = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
    .get();
  if (!item) return apiError(c, 409, "deleted", "That was deleted.");

  // Each photo's id follows from the idea's id and its place, so a retry after a half-finished upload
  // stores the photos that are missing and finds the others where they were.
  for (const [position, image] of images.entries()) {
    const photoId = await photoIdFor(itemId, position);
    // Already there (a retry): a browser may have resized it by now, and the original must not replace that.
    const existing = await db.select({ id: photos.id }).from(photos).where(eq(photos.id, photoId)).get();
    if (existing) continue;
    const httpMetadata = { contentType: image.contentType };
    // The original is both sizes until a browser resizes it; "provisional" keeps it out of long-lived caches.
    const customMetadata = { provisional: "1" };
    await Promise.all(
      (["large", "thumb"] as const).map((variant) =>
        c.env.PHOTOS.put(photoKey(photoId, variant), image.bytes, { httpMetadata, customMetadata }),
      ),
    );
    await db.batch([
      db
        .insert(photos)
        .values({
          id: photoId,
          itemId,
          position,
          width: image.width,
          height: image.height,
          color: NEUTRAL,
          contentType: image.contentType,
          needsResize: true,
          createdBy: c.var.user.id,
          createdAt: now,
        })
        .onConflictDoNothing(),
      recordChange(db, { entity: "photo", id: photoId, itemId, action: "created", actor: c.var.actor }),
      db
        .update(items)
        .set({ updatedAt: now })
        .where(and(eq(items.id, itemId), afterChange)),
    ]);
  }
  return c.json<CaptureResponse>(
    { id: itemId, url: `${new URL(c.req.url).origin}/ideas/${itemId}`, photos: images.length },
    201,
  );
});
