import { SECRET_PREFIX, SECRET_SHOWN_CHARS } from "../../shared/webhooks.ts";

/**
 * The webhook signing secrets, and how they are kept (decision 0025). The HMAC key has to be recoverable to
 * sign, so it can't be hashed like an agent token. It is stored encrypted with AES-GCM under a key derived (HKDF)
 * from a Worker secret, `WEBHOOK_SECRET_KEY` or, when that isn't set, `VAPID_PRIVATE_KEY`: a copy of the database
 * alone can't sign anything. Nothing here is ever logged.
 */

const encoder = new TextEncoder();
const INFO = encoder.encode("spaghetti/webhook-secret/v1");

const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const unb64 = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));

/** The key material, or null when the Worker has none (webhooks are then unavailable). */
export const secretKeySource = (env: Env) => env.WEBHOOK_SECRET_KEY || env.VAPID_PRIVATE_KEY || null;

async function encryptionKey(env: Env): Promise<CryptoKey> {
  const source = secretKeySource(env);
  if (!source) throw new Error("No key to keep webhook secrets under");
  const material = await crypto.subtle.importKey("raw", encoder.encode(source), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** A new secret: `whsec_` and 32 random bytes. */
export function generateSecret(): string {
  return SECRET_PREFIX + b64(crypto.getRandomValues(new Uint8Array(32)));
}

export const secretPrefix = (secret: string) => secret.slice(0, SECRET_SHOWN_CHARS);

/** `iv.ciphertext`, both base64url. */
export async function sealSecret(env: Env, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), encoder.encode(secret));
  return `${b64(iv)}.${b64(new Uint8Array(sealed))}`;
}

export async function openSecret(env: Env, stored: string): Promise<string> {
  const [iv, sealed] = stored.split(".");
  if (!iv || !sealed) throw new Error("Unreadable webhook secret");
  const opened = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) },
    await encryptionKey(env),
    unb64(sealed),
  );
  return new TextDecoder().decode(opened);
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** HMAC-SHA256 over `<timestamp>.<body>` with the secret, as lowercase hex (docs/api.md has the receiver's side). */
export async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`)));
}
