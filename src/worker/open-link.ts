import { OPEN_LINK_MINUTES, type OpenPart } from "../shared/open-link.ts";
import { secretKeySource } from "./webhooks/secrets.ts";

/**
 * Signed links for Bambu Studio (decision 0058). Bambu Studio fetches a file itself, with none of the app's cookies,
 * so a signed-in person asks for a link to one file: `/open/<id>.<part>.<expires>.<signature>/<name>`, where the
 * signature is an HMAC-SHA256 of the first three under a key derived (HKDF) from WEBHOOK_SECRET_KEY with its own
 * purpose, so the link can't stand in for a webhook secret or the other way round. Nothing is stored: the link
 * proves itself, and holds for its minutes only. Not secret-bearing beyond that: it names one file, read-only.
 */

const encoder = new TextEncoder();
const INFO = encoder.encode("spaghetti/open-link/v1");

const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Whether the Worker has the key links are signed with. */
export const canSignLinks = (env: Env) => Boolean(secretKeySource(env));

async function signingKey(env: Env): Promise<CryptoKey> {
  const source = secretKeySource(env);
  if (!source) throw new Error("No key to sign links with");
  const material = await crypto.subtle.importKey("raw", encoder.encode(source), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: INFO },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

const claim = (id: string, part: OpenPart, expires: number) => `${id}.${part}.${expires}`;

/** The token of a link to one file, good for OPEN_LINK_MINUTES from `now`. */
export async function signOpenLink(
  env: Env,
  id: string,
  part: OpenPart,
  now = Date.now(),
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = now + OPEN_LINK_MINUTES * 60_000;
  const mac = await crypto.subtle.sign("HMAC", await signingKey(env), encoder.encode(claim(id, part, expiresAt)));
  return { token: `${claim(id, part, expiresAt)}.${b64(new Uint8Array(mac))}`, expiresAt };
}

/** Which file and part a token is for, when its signature holds and it hasn't expired; else null. */
export async function verifyOpenLink(
  env: Env,
  token: string,
  now = Date.now(),
): Promise<{ id: string; part: OpenPart } | null> {
  if (!canSignLinks(env)) return null;
  const match = /^([0-9a-f-]{36})\.(file|sliced)\.(\d{1,15})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  const [, id, part, expires, signature] = match as unknown as [string, string, OpenPart, string, string];
  if (Number(expires) <= now) return null;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
  // crypto.subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify(
    "HMAC",
    await signingKey(env),
    bytes,
    encoder.encode(claim(id, part, Number(expires))),
  );
  return ok ? { id, part } : null;
}
