import { MAX_PHOTO_BYTES } from "../../shared/api.ts";
import { checkLinkUrl } from "../../shared/link-safety.ts";
import { resolvesPublic } from "../link-preview.ts";

const TOO_LARGE = "That photo is too large (over 12 MB).";

/** What the API needs to know about a photo that wasn't resized in a browser. */
export interface ImageInfo {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/webp";
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, o: number) => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
const u16le = (b: Uint8Array, o: number) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, o: number) => u16le(b, o) | ((b[o + 2] ?? 0) << 16);
const ascii = (b: Uint8Array, o: number, length: number) => String.fromCharCode(...b.slice(o, o + length));

/** Width and height from a JPEG's start-of-frame segment. */
function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1] ?? 0;
    if (marker === 0xff) {
      o += 1;
      continue;
    }
    // Start of frame (not the table or arithmetic-coding markers in the same range).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, o + 5), width: u16be(b, o + 7) };
    }
    o += 2 + u16be(b, o + 2);
  }
  return null;
}

/** Width and height from a WebP's first chunk (lossy, lossless or extended). */
function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return null;
}

/** Reads a JPEG or WebP's type and size from its bytes. PNG and the rest are refused: the API stores JPEG and WebP. */
export function readImage(bytes: Uint8Array): ImageInfo {
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error(TOO_LARGE);
  let size: { width: number; height: number } | null = null;
  let contentType: ImageInfo["contentType"];
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    contentType = "image/jpeg";
    size = jpegSize(bytes);
  } else if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    contentType = "image/webp";
    size = webpSize(bytes);
  } else {
    throw new Error("Photos must be JPEG or WebP images.");
  }
  if (!size || size.width < 1 || size.height < 1 || size.width > 10_000 || size.height > 10_000) {
    throw new Error("That image's size couldn't be read, or is over 10,000 px.");
  }
  return { bytes, contentType, ...size };
}

export function fromBase64(data: string): Uint8Array {
  // Allow a data: URL prefix.
  const clean = data.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  try {
    const binary = atob(clean.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw new Error("The photo isn't valid base64.");
  }
}

/** Fetches a photo from an https URL, with a size cap and a timeout. */
export async function fromUrl(
  url: string,
  redirect: "follow" | "manual" = "follow",
  allowHttp = false,
): Promise<Uint8Array> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("The photo URL isn't a valid URL.");
  }
  if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:"))
    throw new Error("The photo URL must be https.");
  let response: Response;
  try {
    response = await fetch(parsed, { signal: AbortSignal.timeout(10_000), redirect });
  } catch {
    throw new Error("The photo couldn't be fetched from that URL.");
  }
  return readPhoto(response);
}

const NOT_PUBLIC = "The photo URL must be an https address on the open internet.";
const PHOTO_REDIRECTS = 3;

/**
 * A photo from any address an agent gives (capture_idea's photo_url): the link-preview rules hold on every hop, the
 * first and each redirect (https, a public name, no port or credentials, a name that resolves to public addresses
 * only), so the Worker, or the container on someone's home network, never fetches something local for a token.
 */
export async function fromPublicUrl(url: string): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(10_000);
  let next = checkLinkUrl(url);
  for (let hop = 0; hop <= PHOTO_REDIRECTS; hop++) {
    if (!next) throw new Error(NOT_PUBLIC);
    let response: Response;
    try {
      if (!(await resolvesPublic(next.hostname.replace(/\.$/, ""), signal))) throw new Error(NOT_PUBLIC);
      response = await fetch(next, { signal, redirect: "manual" });
    } catch (error) {
      if (error instanceof Error && error.message === NOT_PUBLIC) throw error;
      throw new Error("The photo couldn't be fetched from that URL.");
    }
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) return readPhoto(response);
    await response.body?.cancel().catch(() => undefined);
    next = URL.canParse(location, next.href) ? checkLinkUrl(new URL(location, next).href) : null;
  }
  throw new Error("The photo URL redirected too many times.");
}

/** The body of a photo's answer, cut off at the size cap. */
async function readPhoto(response: Response): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`The photo URL answered ${response.status}.`);
  if (Number(response.headers.get("content-length") ?? 0) > MAX_PHOTO_BYTES) throw new Error(TOO_LARGE);
  // The header can be missing or wrong: the cap is enforced while reading, and the download stops there.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The photo URL sent nothing.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_PHOTO_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(TOO_LARGE);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Bytes as base64, in slices (a spread of a whole photo would overflow the stack). */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
