/**
 * A software authenticator for the Worker tests: makes the same registration and sign-in answers a
 * phone's Face ID would (ES256, "none" attestation), so the real verification in @simplewebauthn/server
 * runs on them. Test-only: nothing here is used by the app.
 */
import { fromBase64Url, toBase64Url } from "../../src/shared/base64url.ts";

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// A sliver of CBOR: unsigned and negative integers, byte and text strings, maps.
function head(major: number, length: number): Uint8Array {
  if (length < 24) return Uint8Array.of((major << 5) | length);
  if (length < 256) return Uint8Array.of((major << 5) | 24, length);
  return Uint8Array.of((major << 5) | 25, length >> 8, length & 255);
}
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function cbor(value: Cbor): Uint8Array {
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") return concat(head(3, encoder.encode(value).length), encoder.encode(value));
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  const parts: Uint8Array[] = [head(5, value.size)];
  for (const [k, v] of value) parts.push(cbor(k), cbor(v));
  return concat(...parts);
}

const sha256 = async (data: BufferSource) => new Uint8Array(await crypto.subtle.digest("SHA-256", data));

/** The raw r||s WebCrypto makes, as the DER the WebAuthn spec wants. */
function derSignature(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array) => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    const body = bytes.slice(start);
    const padded = (body[0] ?? 0) & 0x80 ? concat(Uint8Array.of(0), body) : body;
    return concat(Uint8Array.of(0x02, padded.length), padded);
  };
  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32));
  return concat(Uint8Array.of(0x30, r.length + s.length), r, s);
}

export interface AuthenticatorOptions {
  /** Flags: user verification (Face ID) on by default; a test turns it off to see it refused. */
  verified?: boolean;
  backedUp?: boolean;
}

export class SoftAuthenticator {
  readonly credentialId = crypto.getRandomValues(new Uint8Array(32));
  counter = 0;
  private keys!: CryptoKeyPair;

  private options: AuthenticatorOptions;
  constructor(options: AuthenticatorOptions = {}) {
    this.options = options;
  }

  get id() {
    return toBase64Url(this.credentialId);
  }

  private flags(extra = 0) {
    return 0x01 | (this.options.verified === false ? 0 : 0x04) | (this.options.backedUp ? 0x18 : 0) | extra;
  }

  private async authData(rpId: string, extra: number, counter: number, attested?: Uint8Array) {
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, counter);
    return concat(
      await sha256(encoder.encode(rpId)),
      Uint8Array.of(this.flags(extra)),
      counterBytes,
      attested ?? new Uint8Array(),
    );
  }

  /** The answer to navigator.credentials.create(). `origin` and `challenge` can be lied about to test refusals. */
  async register(input: { challenge: string; rpId: string; origin: string; type?: string }) {
    this.keys ??= (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", this.keys.publicKey)) as JsonWebKey;
    const cose = new Map<Cbor, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, fromBase64Url(jwk.x ?? "")],
      [-3, fromBase64Url(jwk.y ?? "")],
    ]);
    const idLength = new Uint8Array(2);
    new DataView(idLength.buffer).setUint16(0, this.credentialId.length);
    const attested = concat(new Uint8Array(16), idLength, this.credentialId, cbor(cose));
    const authData = await this.authData(input.rpId, 0x40, this.counter, attested);
    const clientData = encoder.encode(
      JSON.stringify({
        type: input.type ?? "webauthn.create",
        challenge: input.challenge,
        origin: input.origin,
        crossOrigin: false,
      }),
    );
    const attestationObject = cbor(
      new Map<Cbor, Cbor>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: toBase64Url(clientData),
        attestationObject: toBase64Url(attestationObject),
        transports: ["internal" as const],
      },
    };
  }

  /** The answer to navigator.credentials.get(): signs the challenge and, like a real key, counts up. */
  async authenticate(input: {
    challenge: string;
    rpId: string;
    origin: string;
    userHandle?: string;
    counter?: number;
  }) {
    this.keys ??= (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    this.counter = input.counter ?? this.counter + 1;
    const authData = await this.authData(input.rpId, 0, this.counter);
    const clientData = encoder.encode(
      JSON.stringify({ type: "webauthn.get", challenge: input.challenge, origin: input.origin, crossOrigin: false }),
    );
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      this.keys.privateKey,
      concat(authData, await sha256(clientData)),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: toBase64Url(clientData),
        authenticatorData: toBase64Url(authData),
        signature: toBase64Url(derSignature(new Uint8Array(signature))),
        ...(input.userHandle ? { userHandle: input.userHandle } : {}),
      },
    };
  }
}
