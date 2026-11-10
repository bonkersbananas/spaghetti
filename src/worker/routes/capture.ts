import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { CaptureResponse } from "../../shared/api.ts";
import { captureNote, captureTitle, MAX_CAPTURE_PHOTOS } from "../../shared/capture.ts";
import { lonelyModelLink } from "../../shared/model-links.ts";
import { afterChange, recordChange } from "../changes.ts";
import { items, photos } from "../db/schema.ts";
import { draftsEnabled, runDraft, startDraft } from "../draft/run.ts";
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
export const NEUTRAL = "#a9a095";

/** A UUID made from the idea's id and the photo's place, the same every time. */
export async function photoIdFor(itemId: string, position: number): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${itemId}:${position}`)));
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x40;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const blank = (value: string | null | undefined) => value?.trim() || undefined;

/** What a request body held, whatever shape it came in. */
interface Body {
  fields: z.infer<typeof fields>;
  /** Photos, as bytes. */
  files: Uint8Array[];
}

/** A file that is neither a photo we store nor readable text (a PNG, a PDF): refused with the photo message. */
class UnsupportedFile extends Error {
  constructor() {
    super("Photos must be JPEG or WebP images.");
  }
}

/** Text from bytes, or UnsupportedFile when they aren't UTF-8 text. */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new UnsupportedFile();
  }
}

const SINGLE_URL = /^https?:\/\/\S+$/i;
const isImage = (bytes: Uint8Array) =>
  (bytes[0] === 0xff && bytes[1] === 0xd8) || // JPEG
  (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) || // RIFF (WebP)
  (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70); // ftyp (HEIC: refused with a clear message)

/** Fills the fields from loose text: a lone link is the link, anything else is the words. */
function addText(into: Record<string, string | undefined>, value: string, name?: string) {
  const words = value.trim();
  if (!words) return;
  if (name === "url" || name === "title" || name === "text" || name === "id") {
    into[name] = into[name] ? `${into[name]}\n${words}` : words;
  } else if (SINGLE_URL.test(words) && !into.url) into.url = words;
  else into.text = into.text ? `${into.text}\n${words}` : words;
}

/**
 * Reads what Shortcuts, scripts and browsers actually send, in these shapes:
 *  - `application/json`: `{ url?, text?, title?, id?, image? }`.
 *  - `application/x-www-form-urlencoded`: a Shortcuts "Form" body with only text fields (`text=…`, `url=…`).
 *  - `multipart/form-data`: the same fields, and photos in any file part. A Shortcuts form can also send a URL
 *    or rich-text item as a *file part* (a filename and `text/plain` or another type): a part that isn't an image
 *    is read as text, filed under its field name when that is text, url or title, and otherwise as loose text.
 *  - `image/*` (or anything that starts like a JPEG, WebP or HEIC): a photo, with the fields in the query string.
 *  - `text/plain`, `text/uri-list` or any other text: the words, or the link when it is only a link.
 * The query string may carry `id`, `title`, `text` and `url` for any shape.
 */
async function readBody(c: Context<AppEnv>): Promise<Body> {
  const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const loose: Record<string, string | undefined> = {};
  const files: Uint8Array[] = [];
  const query = c.req.query();
  for (const name of ["id", "title", "text", "url"]) if (blank(query[name])) loose[name] = blank(query[name]);

  if (type === "application/json") {
    const parsed = fields.parse(await c.req.json());
    if (parsed.image) files.push(fromBase64(parsed.image));
    return { fields: fields.parse({ ...loose, ...parsed }), files };
  }
  if (type === "application/x-www-form-urlencoded" || type === "multipart/form-data") {
    const form = await c.req.formData();
    for (const [name, entry] of form.entries()) {
      if (typeof entry === "string") {
        addText(loose, entry, name);
        continue;
      }
      if (entry.size === 0) continue;
      const bytes = new Uint8Array(await entry.arrayBuffer());
      if (entry.type.startsWith("image/") || isImage(bytes)) files.push(bytes);
      else addText(loose, decodeText(bytes), name);
    }
    return { fields: fields.parse(loose), files };
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (type.startsWith("image/") || isImage(bytes)) files.push(bytes);
  else if (bytes.length) {
    const body = decodeText(bytes);
    // A JSON body sent without its Content-Type.
    if (/^\s*\{/.test(body) && type !== "text/plain") {
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        // Words that happen to start with a brace: shared text, not JSON.
      }
      const parsed = json === undefined ? undefined : fields.safeParse(json);
      if (parsed?.success) return { fields: fields.parse({ ...loose, ...parsed.data }), files };
    }
    // text/uri-list may start with comment lines.
    addText(
      loose,
      type === "text/uri-list"
        ? body
            .split(/\r?\n/)
            .filter((line) => !line.startsWith("#"))
            .join("\n")
        : body,
    );
  }
  return { fields: fields.parse(loose), files };
}

/**
 * A capture that is just a model-page link gets drafted by Claude in the background (decision 0019): the idea is
 * already saved and answered, this only asks. Only a person's session or their sharing token (capture scope and
 * nothing else) may start one, never an agent that can do more; the cron picks the job up if waitUntil's 30 seconds
 * run out first.
 */
async function draftFromLink(
  c: Context<AppEnv>,
  itemId: string,
  note: string,
  title: string | null,
  photoCount: number,
) {
  const scopes = c.var.scopes;
  const sharingToken = scopes?.length === 1 && scopes[0] === "capture";
  if ((scopes && !sharingToken) || !draftsEnabled(c.env) || title || photoCount) return;
  const found = lonelyModelLink(note);
  if (!found || !(await startDraft(c.var.db, itemId, found.url, c.var.user))) return;
  try {
    c.executionCtx.waitUntil(runDraft(c.env, itemId, c.var.db));
  } catch {
    // No execution context (a test): the cron's fallback does it.
  }
}

/** The sentence a Shortcut can show: what was saved, in a few words. */
function savedSentence(title: string | null, note: string, photos: number): string {
  const what = title ?? (note.split("\n")[0] || undefined) ?? (photos > 1 ? `${photos} photos` : "a photo");
  return `Saved to Spaghetti: ${what.length > 80 ? `${what.slice(0, 79)}…` : what}`;
}

/**
 * The one-tap way in for things that can't run the app: an iOS Shortcut, a bookmarklet, a script. It reads the
 * body in any of the shapes above, makes an idea of it and answers with its link. A JSON request (or one with
 * `Accept: application/json`) gets JSON; anything else gets one plain sentence, so a Shortcut can show it.
 * Photos are stored as they came and flagged `needsResize` (decision 0004).
 */
export const captureRoutes = new Hono<AppEnv>().post("/", async (c) => {
  const wantsJson =
    (c.req.header("content-type") ?? "").includes("application/json") ||
    (c.req.header("accept") ?? "").includes("application/json");
  /** An error in the shape the caller reads. */
  const refuse = (status: 400 | 409 | 415, code: string, message: string) =>
    wantsJson ? apiError(c, status, code, message) : c.text(`Spaghetti couldn't save that: ${message}`, status);

  let input: z.infer<typeof fields>;
  let files: Uint8Array[];
  try {
    ({ fields: input, files } = await readBody(c));
  } catch (error) {
    if (error instanceof UnsupportedFile) return refuse(415, "unsupported", error.message);
    if (error instanceof Error && /base64|JPEG|WebP|photo/i.test(error.message)) {
      return refuse(400, "invalid", error.message);
    }
    return refuse(
      400,
      "invalid",
      "that couldn't be read. Send a link or text as a form or JSON, or a JPEG or WebP photo.",
    );
  }
  // A lone link in `text` is the link.
  if (!input.url && input.text && SINGLE_URL.test(input.text.trim())) {
    input = { ...input, url: input.text.trim(), text: undefined };
  }

  const note = captureNote(input.text, input.url);
  const title = captureTitle(input.title, input.text, input.url);
  if (!note && !title && !files.length) return refuse(400, "invalid", "there was no link, text, title or photo in it.");
  if (files.length > MAX_CAPTURE_PHOTOS) {
    return refuse(400, "invalid", `at most ${MAX_CAPTURE_PHOTOS} photos at a time.`);
  }
  const images: ImageInfo[] = [];
  try {
    for (const bytes of files) images.push(readImage(bytes));
  } catch (error) {
    // iPhones take HEIC: the Shortcut converts to JPEG first (see docs/share.md).
    return refuse(415, "unsupported", error instanceof Error ? error.message : "that photo couldn't be read.");
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
  if (!item) return refuse(409, "deleted", "that was deleted.");

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
  await draftFromLink(c, itemId, note, title, images.length);
  const link = `${new URL(c.req.url).origin}/ideas/${itemId}`;
  if (!wantsJson) return c.text(savedSentence(title, note, images.length), 201);
  return c.json<CaptureResponse>(
    { id: itemId, url: link, photos: images.length, message: savedSentence(title, note, images.length) },
    201,
  );
});
