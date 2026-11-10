/**
 * Web Push with WebCrypto only: the message encrypted as aes128gcm (RFC 8291, on RFC 8188) and the
 * request signed with VAPID (RFC 8292, an ES256 JWT). No Node libraries; the same code runs in workerd.
 */
import { fromBase64Url, toBase64Url } from "../../shared/base64url.ts";

type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const enc = (text: string) => encoder.encode(text) as Bytes;
/** One record holds the whole message (a notification is a few hundred bytes), so the record size is the maximum. */
const RECORD_SIZE = 4096;
const MAX_PAYLOAD = RECORD_SIZE - 86;

export interface PushKeys {
  /** The browser's public key, base64url (65 bytes, uncompressed P-256). */
  p256dh: string;
  /** The browser's 16-byte authentication secret, base64url. */
  auth: string;
}

const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/**
 * Encrypts `payload` for one browser. `ephemeral` and `salt` are only passed by the test that checks
 * this against RFC 8291's example; otherwise they are fresh and random.
 */
export async function encryptPayload(
  keys: PushKeys,
  payload: Bytes,
  fixed?: { ephemeral: CryptoKeyPair; salt: Bytes },
): Promise<Bytes> {
  if (payload.length > MAX_PAYLOAD) throw new Error("The push message is too long.");
  const uaPublic = fromBase64Url(keys.p256dh);
  const authSecret = fromBase64Url(keys.auth);
  const ephemeral =
    fixed?.ephemeral ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const salt = fixed?.salt ?? (crypto.getRandomValues(new Uint8Array(16)) as Bytes);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", ephemeral.publicKey)) as ArrayBuffer);

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as never, ephemeral.privateKey, 256),
  );
  // RFC 8291 §3.4: the input keying material mixes the shared secret with the auth secret and both public keys.
  const ikm = await hkdf(authSecret, shared, concat(enc("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc("Content-Encoding: nonce\0"), 12);

  // One record: the message, then the 0x02 delimiter that marks the last record (no padding).
  const record = concat(payload, new Uint8Array([2]));
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, record));

  // The header (RFC 8188 §2.1): salt, record size, the sender's key id length and the key itself.
  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** The signing key from the two halves kept in the config: the public key (a var) and the private scalar (a secret). */
export async function importVapidKey(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const point = fromBase64Url(publicKey);
  if (point.length !== 65 || point[0] !== 4) throw new Error("VAPID_PUBLIC_KEY isn't an uncompressed P-256 key.");
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: privateKey,
      x: toBase64Url(point.slice(1, 33)),
      y: toBase64Url(point.slice(33)),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** The `Authorization` header for one push service: a JWT for its origin, valid for 12 hours (the most allowed is 24). */
export async function vapidAuthorization(
  endpoint: string,
  vapid: { subject: string; publicKey: string; signingKey: CryptoKey },
  now = Date.now(),
): Promise<string> {
  const header = toBase64Url(enc(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toBase64Url(
    enc(
      JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: vapid.subject }),
    ),
  );
  const signed = `${header}.${claims}`;
  // WebCrypto signs ES256 as the raw r||s pair, which is what a JWT wants (not DER).
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, vapid.signingKey, enc(signed)),
  );
  return `vapid t=${signed}.${toBase64Url(signature)}, k=${vapid.publicKey}`;
}

export type PushResult = "sent" | "gone" | "failed";

/** Sends one message. "gone" (404 or 410) means the browser dropped the subscription: remove it. */
export async function sendPush(
  subscription: { endpoint: string } & PushKeys,
  message: unknown,
  vapid: { subject: string; publicKey: string; signingKey: CryptoKey },
  options: { ttl?: number; urgency?: "normal" | "high" } = {},
): Promise<PushResult> {
  let body: Bytes;
  try {
    body = await encryptPayload(subscription, enc(JSON.stringify(message)));
  } catch {
    // Keys that don't decode or aren't a P-256 point never will: treat the subscription as gone.
    return "gone";
  }
  let response: Response;
  try {
    response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(subscription.endpoint, vapid),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(options.ttl ?? 60 * 60),
        Urgency: options.urgency ?? "normal",
      },
      body: body as BodyInit,
    });
  } catch {
    return "failed";
  }
  if (response.ok) return "sent";
  return response.status === 404 || response.status === 410 ? "gone" : "failed";
}
