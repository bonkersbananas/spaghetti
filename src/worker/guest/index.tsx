/** @jsxImportSource hono/jsx */
import { and, eq, isNull, or } from "drizzle-orm";
import { PHOTO_VARIANTS, type PhotoVariant } from "../../shared/api.ts";
import { hasPhotoMetadata, stripPhotoMetadata } from "../../shared/photo-metadata.ts";
import { sharePath } from "../../shared/shares.ts";
import { signedInUserId } from "../auth/session.ts";
import { type Db, getDb } from "../db/index.ts";
import { attemptFiles, attempts, itemFiles, items, photos, type ShareRow, twistFiles, twists } from "../db/schema.ts";
import { setPageHeaders } from "../page-headers.ts";
import { fileKey, photoKey } from "../photos.ts";
import { cut } from "../previews.ts";
import { liveTarget, shareByToken } from "../shares.ts";
import { GuestBody, NotSharedBody, photoUrl } from "./page.tsx";
import { plateToolpaths, type RangedSource, streamToolpaths } from "./toolpaths.ts";
import { fileIdsOf, type GuestView, loadItemView, loadTwistView, photoIdsOf } from "./view.ts";

/**
 * /s/<token>: a shared idea, build or twist for someone who isn't signed in (decision 0075), and its photos at
 * /s/<token>/photos/<id>/<thumb|large>, and its files' plate pictures and toolpaths at /s/<token>/files/<id>/<thumb|
 * toolpaths> (decision 0077: the 3D view, never the file). Read-only by construction: GET and HEAD only, and nothing here writes.
 * Everything that isn't a live link to a live thing answers the same way (a 404 page that says it isn't shared
 * anymore; a plain 404 for a photo), so a guess learns nothing. Someone signed in on this browser is sent to the
 * thing's own page in the app instead.
 */

const PAGE = /^\/s\/([^/]+)\/?$/;
const PHOTO = /^\/s\/([^/]+)\/photos\/([0-9a-f-]{36})\/([a-z]+)$/i;
const FILE = /^\/s\/([^/]+)\/files\/([0-9a-f-]{36})\/([a-z]+)$/i;

/**
 * The page's own headers. Its policy names one place for script and workers: /assets/guest/, where the page's own
 * build puts its one script and the 3D view it loads on a tap (decision 0077); the view fetches only this link's
 * files. Nothing from elsewhere, no frames, no forms, no referrer.
 */
export function guestPageHeaders(origin: string, token: string | null, dev = false): Record<string, string> {
  const assets = `${origin}/assets/guest/`;
  const policy = dev
    ? // `vite dev` serves the page's modules from /src and /node_modules, with its own client and socket.
      "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self' ws: wss:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    : [
        "default-src 'none'",
        "img-src 'self'",
        // React sets the viewer's few inline styles (its slider's fill, its legend's colours).
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        `script-src ${assets}`,
        `worker-src ${assets}`,
        token ? `connect-src ${origin}/s/${token}/files/` : "",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ]
        .filter(Boolean)
        .join("; ");
  return {
    "Content-Security-Policy": policy,
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive, noimageindex",
    // A stopped link must stop: nothing keeps the page, in the browser or between it and us.
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
  };
}

/** When the build's template can't be read (the Worker's own tests have no assets): the same page, unstyled. */
const BARE_TEMPLATE =
  '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Spaghetti</title><meta name="robots" content="noindex, nofollow, noarchive" /><meta name="referrer" content="no-referrer" /></head><body></body></html>';

const SITE = "Spaghetti";
const MAX_PREVIEW_BYTES = 1_000_000;
const TAGLINE = "A 3D print, shared from Spaghetti.";

const notFound = (method: string) =>
  new Response(method === "HEAD" ? null : "Not found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });

async function template(request: Request, env: Env): Promise<string> {
  try {
    const response = await env.ASSETS.fetch(new Request(new URL("/guest", request.url), { method: "GET" }));
    if (response.ok) return await response.text();
  } catch {
    // No assets binding (the Worker's tests): the bare page.
  }
  return BARE_TEMPLATE;
}

/** The text a link preview shows: the note's first words, else what the thing is. */
function description(view: GuestView): string {
  if (view.note) return cut(view.note, 160);
  if (view.kind === "build") return cut(view.summary, 160);
  if (view.kind === "twist" && view.changes.length) return cut(view.changes.map((c) => c.name).join(", "), 160);
  return TAGLINE;
}

/** Open Graph and Twitter tags, escaped by hono/jsx like the page itself. */
function Preview({
  view,
  origin,
  token,
  variant,
}: {
  view: GuestView;
  origin: string;
  token: string;
  variant: PhotoVariant;
}) {
  const title = `${view.title} · ${SITE}`;
  const words = description(view);
  const image = view.cover ? `${origin}${photoUrl(token, view.cover.id, variant)}` : `${origin}/og.jpg`;
  // The thumbnail is the large photo scaled to 600 px on its long edge.
  const scale = view.cover && variant === "thumb" ? 600 / Math.max(view.cover.width, view.cover.height) : 1;
  return (
    <>
      <meta name="description" content={words} />
      <meta property="og:type" content="article" />
      <meta property="og:site_name" content={SITE} />
      <meta property="og:url" content={`${origin}${sharePath(token)}`} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={words} />
      <meta property="og:image" content={image} />
      {view.cover ? (
        <>
          <meta property="og:image:width" content={String(Math.round(view.cover.width * Math.min(1, scale)))} />
          <meta property="og:image:height" content={String(Math.round(view.cover.height * Math.min(1, scale)))} />
          <meta property="og:image:alt" content={view.title} />
        </>
      ) : (
        <>
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
        </>
      )}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={words} />
      <meta name="twitter:image" content={image} />
    </>
  );
}

async function render(
  request: Request,
  env: Env,
  parts: { title: string; head: string; body: string; status: number; token: string | null },
): Promise<Response> {
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
  setPageHeaders(headers);
  const html = await template(request, env);
  // The dev server's page loads its modules unbundled, with Vite's client: never a build's.
  const dev = html.includes("/@vite/client");
  const origin = new URL(request.url).origin;
  for (const [name, value] of Object.entries(guestPageHeaders(origin, parts.token, dev))) headers.set(name, value);
  const page = new Response(html, { status: parts.status, headers });
  const rewritten = new HTMLRewriter()
    .on("title", { element: (element) => void element.setInnerContent(parts.title) })
    .on("head", { element: (element) => void element.append(parts.head, { html: true }) })
    .on("body", {
      element: (element) => {
        element.setAttribute("class", "gp-body");
        element.setInnerContent(parts.body, { html: true });
      },
    })
    .transform(page);
  if (request.method === "HEAD") return new Response(null, { status: rewritten.status, headers: rewritten.headers });
  return rewritten;
}

function notShared(request: Request, env: Env) {
  return render(request, env, {
    title: "Not shared anymore · Spaghetti",
    head: "",
    body: String(<NotSharedBody />),
    status: 404,
    token: null,
  });
}

async function viewOf(db: Db, share: ShareRow): Promise<GuestView | null> {
  return share.kind === "twist" ? loadTwistView(db, share.targetId) : loadItemView(db, share.targetId);
}

async function page(request: Request, env: Env, token: string): Promise<Response> {
  const db = getDb(env.DB);
  const share = await shareByToken(db, token);
  // One of the two people: the thing's own page in the app, where they can do everything.
  if (share && (await signedInUserId(db, request.headers.get("Cookie")))) {
    const target = await liveTarget(db, share.kind, share.targetId);
    if (target) {
      return new Response(null, {
        status: 302,
        headers: { Location: target.path, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
      });
    }
  }
  if (!share || share.revokedAt) return notShared(request, env);
  const view = await viewOf(db, share);
  if (!view) return notShared(request, env);
  const origin = new URL(request.url).origin;
  // Crawlers unfurl fastest well under a megabyte (worker/previews.ts): the large photo when it is, else the thumbnail.
  const large = view.cover ? await env.PHOTOS.head(photoKey(view.cover.id, "large")) : null;
  const variant: PhotoVariant = large && large.size <= MAX_PREVIEW_BYTES ? "large" : "thumb";
  return render(request, env, {
    title: `${view.title} · ${SITE}`,
    head: String(<Preview view={view} origin={origin} token={token} variant={variant} />),
    body: String(<GuestBody view={view} token={token} />),
    status: 200,
    token,
  });
}

/**
 * Whether a photo is one this link shows: an idea's or build's own live photo (not of a deleted attempt), or the one
 * photo a twist leads with; never a photo stored as it came (`needs_resize`), which may still carry its EXIF.
 */
async function photoOfShare(db: Db, share: ShareRow, photoId: string) {
  const live = and(eq(photos.id, photoId), isNull(photos.deletedAt), eq(photos.needsResize, false));
  if (share.kind === "item") {
    return db
      .select({ id: photos.id, contentType: photos.contentType })
      .from(photos)
      .innerJoin(items, eq(items.id, photos.itemId))
      .leftJoin(attempts, eq(attempts.id, photos.attemptId))
      .where(
        and(
          live,
          eq(photos.itemId, share.targetId),
          isNull(items.deletedAt),
          or(isNull(photos.attemptId), isNull(attempts.deletedAt)),
        ),
      )
      .get();
  }
  return db
    .select({ id: photos.id, contentType: photos.contentType })
    .from(twists)
    .innerJoin(photos, eq(photos.id, twists.sourcePhotoId))
    .innerJoin(items, eq(items.id, photos.itemId))
    .where(and(live, eq(twists.id, share.targetId), isNull(twists.deletedAt), isNull(items.deletedAt)))
    .get();
}

const SERVED_TYPES = new Set(["image/jpeg", "image/webp"]);

async function photo(request: Request, env: Env, token: string, photoId: string, variant: string) {
  if (!PHOTO_VARIANTS.includes(variant as PhotoVariant)) return notFound(request.method);
  const db = getDb(env.DB);
  const share = await shareByToken(db, token);
  if (!share || share.revokedAt) return notFound(request.method);
  const id = photoId.toLowerCase();
  // Only a photo the page itself shows (the same allow-list), and only while it is the thing's own, live photo.
  const view = await viewOf(db, share);
  if (!view || !photoIdsOf(view).has(id)) return notFound(request.method);
  const row = await photoOfShare(db, share, id);
  if (!row) return notFound(request.method);
  const object = await env.PHOTOS.get(photoKey(row.id, variant as PhotoVariant));
  if (!object) return notFound(request.method);
  // Provisional bytes (an original waiting for a browser to resize it) are never a guest's.
  if (object.customMetadata?.provisional) return notFound(request.method);
  const type = object.httpMetadata?.contentType ?? row.contentType;
  if (!SERVED_TYPES.has(type)) return notFound(request.method);
  // A guest gets a copy without EXIF, XMP or IPTC (a place, a camera, a time): Safari's own JPEGs carry an Exif block.
  // What is served is checked again, not what should be: a photo it can't read, or that still carries some, isn't.
  const bytes = stripPhotoMetadata(new Uint8Array(await object.arrayBuffer()));
  if (!bytes || hasPhotoMetadata(bytes)) {
    console.warn("shared photo withheld: its metadata couldn't be stripped", row.id);
    return notFound(request.method);
  }
  return new Response(request.method === "HEAD" ? null : bytes, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.byteLength),
      // The guest's own browser may keep it a few minutes; no shared cache may keep it at all, so a stopped link's
      // photos stop with it.
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, noimageindex",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}

/**
 * A file this link shows: an idea's or build's own live file, a live attempt's of it, or the twist's model; the same
 * rules as the app's (routes/files.ts liveFile), held to this one thing.
 */
async function fileOfShare(db: Db, share: ShareRow, fileId: string) {
  const fields = { id: itemFiles.id, kind: itemFiles.kind, stored: itemFiles.stored, hasThumb: itemFiles.hasThumb };
  if (share.kind === "twist") {
    return db
      .select({
        id: twistFiles.id,
        kind: twistFiles.kind,
        stored: twistFiles.stored,
        hasThumb: twistFiles.hasThumb,
      })
      .from(twistFiles)
      .innerJoin(twists, eq(twists.id, twistFiles.twistId))
      .where(
        and(
          eq(twistFiles.id, fileId),
          eq(twistFiles.twistId, share.targetId),
          isNull(twistFiles.deletedAt),
          isNull(twists.deletedAt),
        ),
      )
      .get();
  }
  const [own, attempt] = await Promise.all([
    db
      .select(fields)
      .from(itemFiles)
      .innerJoin(items, eq(items.id, itemFiles.itemId))
      .where(
        and(
          eq(itemFiles.id, fileId),
          eq(itemFiles.itemId, share.targetId),
          isNull(itemFiles.deletedAt),
          isNull(items.deletedAt),
        ),
      )
      .get(),
    db
      .select({
        id: attemptFiles.id,
        kind: attemptFiles.kind,
        stored: attemptFiles.stored,
        hasThumb: attemptFiles.hasThumb,
      })
      .from(attemptFiles)
      .innerJoin(attempts, eq(attempts.id, attemptFiles.attemptId))
      .innerJoin(items, eq(items.id, attempts.itemId))
      .where(
        and(
          eq(attemptFiles.id, fileId),
          eq(attempts.itemId, share.targetId),
          isNull(attemptFiles.deletedAt),
          isNull(attempts.deletedAt),
          isNull(items.deletedAt),
        ),
      )
      .get(),
  ]);
  return own ?? attempt;
}

/** An object in a bucket, read by range. Null when it isn't there. */
async function r2Source(bucket: R2Bucket, key: string): Promise<RangedSource | null> {
  const head = await bucket.head(key);
  if (!head) return null;
  const get = async (offset: number, length: number) => {
    const object = await bucket.get(key, { range: { offset, length } });
    if (!object) throw new Error("The file went away while it was read.");
    return object;
  };
  return {
    size: head.size,
    read: async (offset, length) => new Uint8Array(await (await get(offset, length)).arrayBuffer()),
    stream: async (offset, length) => (await get(offset, length)).body,
  };
}

const PICTURE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Whether a request for toolpaths is the 3D view's own fetch (or a browser too old to say): never a navigation, a
 * download or another site's page. So the address isn't a file to open or save: pasted into the address bar, it is
 * a 404 like any other.
 */
function fetchedByTheView(request: Request): boolean {
  const mode = request.headers.get("Sec-Fetch-Mode");
  const dest = request.headers.get("Sec-Fetch-Dest");
  const site = request.headers.get("Sec-Fetch-Site");
  if (mode === "navigate" || mode === "nested-navigate") return false;
  if (dest !== null && dest !== "empty") return false;
  return site === null || site === "same-origin";
}

/** The headers every file part goes out with: kept a few minutes by the guest's browser only, never by a shared cache. */
const FILE_HEADERS = {
  "Cache-Control": "private, max-age=300",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, noimageindex",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
};

async function file(request: Request, env: Env, token: string, fileId: string, part: string) {
  if (part !== "thumb" && part !== "toolpaths") return notFound(request.method);
  if (part === "toolpaths" && !fetchedByTheView(request)) return notFound(request.method);
  const db = getDb(env.DB);
  const share = await shareByToken(db, token);
  if (!share || share.revokedAt) return notFound(request.method);
  const id = fileId.toLowerCase();
  // Only a file whose card the page shows, and only while it is still this thing's own live file.
  const view = await viewOf(db, share);
  const shown = view ? fileIdsOf(view).get(id) : undefined;
  if (!shown) return notFound(request.method);
  const row = await fileOfShare(db, share, id);
  if (!row) return notFound(request.method);

  if (part === "thumb") {
    if (!row.hasThumb || !shown.thumb) return notFound(request.method);
    const object = await env.PHOTOS.get(fileKey(row.id, "thumb"));
    const type = object?.httpMetadata?.contentType ?? "";
    if (!object || !PICTURE_TYPES.has(type)) return notFound(request.method);
    // A plate's picture is made by a slicer, which may write its own text into it: a guest gets the picture only.
    const bytes = stripPhotoMetadata(new Uint8Array(await object.arrayBuffer()));
    if (!bytes || hasPhotoMetadata(bytes)) {
      console.warn("shared plate picture withheld: its metadata couldn't be stripped", row.id);
      return notFound(request.method);
    }
    return new Response(request.method === "HEAD" ? null : bytes, {
      headers: { "Content-Type": type, "Content-Length": String(bytes.byteLength), ...FILE_HEADERS },
    });
  }

  // The plate's toolpaths, for the 3D view: a model's sliced file, or a slicer's own; never the model itself.
  if (!shown.view || !row.stored) return notFound(request.method);
  const source = await r2Source(env.PHOTOS, fileKey(row.id, row.kind === "model" ? "sliced" : "file"));
  const toolpaths = source ? await plateToolpaths(source, shown.view.plate).catch(() => null) : null;
  if (!source || !toolpaths) return notFound(request.method);
  const headers = {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(toolpaths.size),
    ...FILE_HEADERS,
  };
  if (request.method === "HEAD") return new Response(null, { headers });
  const fixed = new FixedLengthStream(toolpaths.size);
  streamToolpaths(source, toolpaths)
    .pipeTo(fixed.writable)
    .catch((error) => console.warn("shared toolpaths stopped", row.id, String(error)));
  return new Response(fixed.readable, { headers });
}

/** Everything under /s/. */
export async function guestRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const { pathname } = new URL(request.url);
  const shown = PAGE.exec(pathname);
  if (shown) return page(request, env, shown[1] as string);
  const asked = PHOTO.exec(pathname);
  if (asked) return photo(request, env, asked[1] as string, asked[2] as string, asked[3] as string);
  const kept = FILE.exec(pathname);
  if (kept) return file(request, env, kept[1] as string, kept[2] as string, kept[3] as string);
  return notFound(request.method);
}
