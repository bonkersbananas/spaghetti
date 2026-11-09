/**
 * Password hashing with WebCrypto PBKDF2-SHA256. The same code runs in the
 * Worker (to verify) and in Node (in `pnpm user:add`, to hash), since both
 * expose `crypto.subtle`.
 *
 * Stored format: `pbkdf2-sha256$<iterations>$<salt, base64>$<hash, base64>`.
 * 100,000 iterations is the most the Workers runtime allows.
 */

export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const PREFIX = "pbkdf2-sha256";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return [PREFIX, PBKDF2_ITERATIONS, toBase64(salt), toBase64(hash)].join("$");
}

/** Compares in constant time, so timing reveals nothing about the hash. */
function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [prefix, iterations, salt, hash] = stored.split("$");
  if (prefix !== PREFIX || !iterations || !salt || !hash) return false;
  const rounds = Number(iterations);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > PBKDF2_ITERATIONS) return false;
  const expected = fromBase64(hash);
  const actual = await derive(password, fromBase64(salt), rounds);
  return equal(actual, expected);
}
