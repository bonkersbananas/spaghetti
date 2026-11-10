import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "../../src/shared/base64url.ts";
import { encryptPayload, importVapidKey, vapidAuthorization } from "../../src/worker/push/webpush.ts";

/** The example in RFC 8291, appendix A: a fixed sender key and salt give exactly this message. */
const rfc = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

async function ephemeralFrom(publicKey: string, privateKey: string): Promise<CryptoKeyPair> {
  const point = fromBase64Url(publicKey);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    ext: true,
    x: toBase64Url(point.slice(1, 33)),
    y: toBase64Url(point.slice(33)),
  };
  return {
    publicKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, []),
    privateKey: await crypto.subtle.importKey(
      "jwk",
      { ...jwk, d: privateKey },
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    ),
  };
}

describe("web push encryption", () => {
  it("reproduces RFC 8291's example message byte for byte", async () => {
    const body = await encryptPayload(
      { p256dh: rfc.uaPublic, auth: rfc.auth },
      new TextEncoder().encode(rfc.plaintext),
      { ephemeral: await ephemeralFrom(rfc.asPublic, rfc.asPrivate), salt: fromBase64Url(rfc.salt) },
    );
    expect(toBase64Url(body)).toBe(rfc.body);
  });

  it("uses a fresh key and salt each time", async () => {
    const keys = { p256dh: rfc.uaPublic, auth: rfc.auth };
    const a = await encryptPayload(keys, new TextEncoder().encode("hi"));
    const b = await encryptPayload(keys, new TextEncoder().encode("hi"));
    expect(toBase64Url(a)).not.toBe(toBase64Url(b));
  });

  it("refuses a message that doesn't fit one record", async () => {
    await expect(encryptPayload({ p256dh: rfc.uaPublic, auth: rfc.auth }, new Uint8Array(4100))).rejects.toThrow(
      /too long/,
    );
  });
});

describe("VAPID", () => {
  it("signs a JWT for the push service's origin that its public key verifies", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const signingKey = await importVapidKey(publicKey, jwk.d as string);

    const now = Date.UTC(2026, 10, 10, 12);
    const header = await vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc",
      { subject: "https://spaghetti.day", publicKey, signingKey },
      now,
    );
    const match = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=(.+)$/);
    expect(match).not.toBeNull();
    const [, head, claims, signature, k] = match as string[];
    expect(k).toBe(publicKey);
    expect(JSON.parse(atob(head as string))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(claims as string)))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: Math.floor(now / 1000) + 43200,
      sub: "https://spaghetti.day",
    });
    expect(fromBase64Url(signature as string)).toHaveLength(64);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      fromBase64Url(signature as string),
      new TextEncoder().encode(`${head}.${claims}`),
    );
    expect(ok).toBe(true);
  });

  it("refuses a public key that isn't an uncompressed P-256 point", async () => {
    await expect(importVapidKey("AAAA", "x")).rejects.toThrow(/uncompressed/);
  });
});
