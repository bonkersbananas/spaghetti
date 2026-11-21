import { and, eq, isNull } from "drizzle-orm";
import { bestPhoto } from "../shared/cover.ts";
import { hasPhotoMetadata, stripPhotoMetadata } from "../shared/photo-metadata.ts";
import { getDb } from "./db/index.ts";
import { attempts, items, photos, twists } from "./db/schema.ts";
import { setPageHeaders } from "./page-headers.ts";
import { photoKey } from "./photos.ts";

/**
 * Link previews (decision 0064): what Slack, iMessage and the like read from a shared link to an idea, a build or a
 * twist. Their crawlers have no session, so the Worker answers these three paths itself and writes the tags into the
 * app's index.html; a signed-in browser gets the same page, tags in its head and nothing else different.
 */

export type PreviewKind = "ideas" | "builds" | "twists";

const PATH = /^\/(ideas|builds|twists)\/([A-Za-z0-9_-]{1,64})\/?$/;
const IMAGE_PATH = /^\/og\/(ideas|builds|twists)\/([A-Za-z0-9_-]{1,64})(?:\.jpg)?$/;

/** The landing page's wording (landing.html), used when a thing has no text to show. */
const TAGLINE =
  "Every print, every spaghetti, written down. Ideas in seconds, every attempt kept, and what worked last time one search away.";
const SITE = "Spaghetti";
const MAX_DESCRIPTION = 160;
const MAX_TITLE = 100;
/** A crawler's limit is about 5 MB; Slack and Apple unfurl fastest well under 1 MB. */
const MAX_IMAGE_BYTES = 1_000_000;

export interface Preview {
  title: string;
  description: string;
  /** The photo to show, or null for the landing page's picture. */
  photoId: string | null;
  contentType: string | null;
}

/** Cuts text at a word, with an ellipsis, to at most `max` characters. */
export function cut(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  const at = space > max * 0.5 ? space : head.length;
  return `${head.slice(0, at).replace(/[\s.,;:!?-]+$/, "")}…`;
}

/** Title and description from a thing's own title (maybe none) and its text: the first line of the text stands in for a missing title. */
export function words(title: string | null, text: string): { title: string; description: string } {
  const own = (title ?? "").replace(/\s+/g, " ").trim();
  if (own) return { title: cut(own, MAX_TITLE), description: cut(text, MAX_DESCRIPTION) };
  const lines = text.trim().split(/\r?\n/);
  const first = (lines.shift() ?? "").trim();
  const head = cut(first, MAX_TITLE);
  // A first line that was cut carries its rest into the description.
  const rest =
    first.length > head.length ? `${first.slice(head.replace(/…$/, "").length)} ${lines.join(" ")}` : lines.join(" ");
  return { title: head, description: cut(rest, MAX_DESCRIPTION) };
}

interface Pic {
  id: string;
  attemptId: string | null;
  createdAt: number;
  contentType: string;
}

/** One batch of small reads. Null when the thing doesn't exist or is deleted. */
export async function findPreview(env: Env, kind: PreviewKind, id: string): Promise<Preview | null> {
  const db = getDb(env.DB);
  if (kind === "twists") {
    const twist = await db
      .select({ name: twists.name, note: twists.note, sourcePhotoId: twists.sourcePhotoId })
      .from(twists)
      .where(and(eq(twists.id, id), isNull(twists.deletedAt)))
      .get();
    if (!twist) return null;
    const photo = twist.sourcePhotoId
      ? await db
          .select({ id: photos.id, contentType: photos.contentType })
          .from(photos)
          .innerJoin(items, eq(items.id, photos.itemId))
          .where(and(eq(photos.id, twist.sourcePhotoId), isNull(photos.deletedAt), isNull(items.deletedAt)))
          .get()
      : undefined;
    return { ...words(twist.name, twist.note), photoId: photo?.id ?? null, contentType: photo?.contentType ?? null };
  }
  const [rows, pics, tries] = await db.batch([
    db
      .select({ title: items.title, note: items.note, coverPhotoId: items.coverPhotoId })
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .limit(1),
    db
      .select({
        id: photos.id,
        attemptId: photos.attemptId,
        createdAt: photos.createdAt,
        contentType: photos.contentType,
        attemptDeleted: attempts.deletedAt,
      })
      .from(photos)
      .leftJoin(attempts, eq(attempts.id, photos.attemptId))
      .where(and(eq(photos.itemId, id), isNull(photos.deletedAt)))
      .orderBy(photos.position),
    db
      .select({ id: attempts.id, outcome: attempts.outcome })
      .from(attempts)
      .where(and(eq(attempts.itemId, id), isNull(attempts.deletedAt)))
      .orderBy(attempts.printedAt, attempts.createdAt, attempts.id),
  ]);
  const item = rows[0];
  if (!item) return null;
  const live: Pic[] = pics
    .filter((p) => !p.attemptDeleted)
    .map((p) => ({
      id: p.id,
      attemptId: p.attemptId,
      createdAt: +p.createdAt,
      contentType: p.contentType,
    }));
  // The photo its page and cards lead with: the same rule as the app's (shared/cover.ts).
  const photo = bestPhoto(live, tries, item.coverPhotoId);
  return { ...words(item.title, item.note), photoId: photo?.id ?? null, contentType: photo?.contentType ?? null };
}

const esc = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** The tags for a page, as the head's extra HTML; the document's own title and description are replaced separately. */
export function tags(origin: string, kind: PreviewKind, id: string, preview: Preview | null) {
  const title = preview?.title ? `${SITE} · ${preview.title}` : SITE;
  const description = preview?.description || TAGLINE;
  const url = `${origin}/${kind}/${id}`;
  const image = preview?.photoId
    ? `${origin}/og/${kind}/${id}.jpg?p=${encodeURIComponent(preview.photoId)}`
    : `${origin}/og.jpg`;
  const own = Boolean(preview?.photoId);
  const html = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    ...(own
      ? []
      : [`<meta property="og:image:width" content="1200" />`, `<meta property="og:image:height" content="630" />`]),
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ].join("\n    ");
  return { title, description, html };
}

/** Whether a path is one of the three detail pages (so the Worker answers it with tags). */
export function previewTarget(pathname: string): { kind: PreviewKind; id: string } | null {
  const match = PATH.exec(pathname);
  return match ? { kind: match[1] as PreviewKind, id: match[2] as string } : null;
}

/** The app's index.html with the thing's tags in its head. A failed read gives the generic tags, never an error. */
export async function previewPage(
  request: Request,
  env: Env,
  target: { kind: PreviewKind; id: string },
): Promise<Response> {
  const url = new URL(request.url);
  const page = await env.ASSETS.fetch(new Request(new URL("/", url), request));
  const preview = await findPreview(env, target.kind, target.id).catch((error) => {
    console.error("preview failed", error);
    return null;
  });
  const made = tags(url.origin, target.kind, target.id, preview);
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-cache");
  setPageHeaders(headers);
  const rewritten = new HTMLRewriter()
    .on("title", { element: (element) => void element.setInnerContent(made.title) })
    .on('meta[name="description"]', { element: (element) => void element.setAttribute("content", made.description) })
    .on("head", { element: (element) => void element.append(`\n    ${made.html}\n  `, { html: true }) })
    .transform(new Response(page.body, { status: page.status, headers }));
  return rewritten;
}

/**
 * The one picture a crawler may fetch without signing in: the cover of an existing, undeleted thing, from its stored
 * variants (the large one when it is under a megabyte, else the thumbnail; the Worker can't resize). Anything else
 * is the same plain 404.
 */
export async function previewImage(request: Request, env: Env): Promise<Response> {
  const match = IMAGE_PATH.exec(new URL(request.url).pathname);
  const missing = () =>
    new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  if (!match) return missing();
  const preview = await findPreview(env, match[1] as PreviewKind, match[2] as string);
  if (!preview?.photoId) return missing();
  const large = await env.PHOTOS.head(photoKey(preview.photoId, "large"));
  const variant = large && large.size <= MAX_IMAGE_BYTES ? "large" : "thumb";
  const object = await env.PHOTOS.get(photoKey(preview.photoId, variant));
  if (!object) return missing();
  // An original waiting for a browser to resize it may still carry where it was taken (decision 0075): not sent.
  if (object.customMetadata?.provisional) return missing();
  // Sent without EXIF, XMP or IPTC; what isn't a JPEG or WebP it can read goes as it is, unless metadata shows in it.
  const stored = new Uint8Array(await object.arrayBuffer());
  const bytes = stripPhotoMetadata(stored) ?? stored;
  if (hasPhotoMetadata(bytes, { strict: false })) return missing();
  const headers = new Headers({
    "Content-Type": object.httpMetadata?.contentType ?? preview.contentType ?? "image/jpeg",
    "Content-Length": String(bytes.byteLength),
    // The cover can change under the same address (the page's ?p= names it), so an hour, not a year.
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  return new Response(request.method === "HEAD" ? null : bytes, { headers });
}
