import { afterEach, describe, expect, it } from "vitest";
import {
  KEEPALIVE_EACH,
  KEEPALIVE_TOTAL,
  keepaliveCost,
  keepaliveInFlight,
  reserveKeepalive,
  wantsKeepalive,
} from "../../src/client/lib/keepalive.ts";

const releases: Array<() => void> = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
});
const take = (body: unknown) => {
  const release = reserveKeepalive(body);
  if (release) releases.push(release);
  return release;
};

describe("keepaliveCost", () => {
  it("counts a JSON string in bytes, not characters", () => {
    expect((keepaliveCost("åäö") ?? 0) - (keepaliveCost("abc") ?? 0)).toBe(3);
  });
  it("is cheap for no body and unknown for uploads", () => {
    expect(keepaliveCost(undefined)).toBeGreaterThan(0);
    expect(keepaliveCost(new Blob(["x"]))).toBeNull();
    expect(keepaliveCost(new FormData())).toBeNull();
  });
});

describe("reserveKeepalive", () => {
  it("lets small bodies through and gives the budget back on release", () => {
    const release = take(JSON.stringify({ a: 1 }));
    expect(release).not.toBeNull();
    expect(keepaliveInFlight()).toBeGreaterThan(0);
    release?.();
    release?.(); // twice is harmless
    expect(keepaliveInFlight()).toBe(0);
  });
  it("refuses a body over one request's share and uploads", () => {
    expect(take("x".repeat(KEEPALIVE_EACH + 1))).toBeNull();
    expect(take(new Blob(["x"]))).toBeNull();
    expect(keepaliveInFlight()).toBe(0);
  });
  it("refuses once the requests in flight would pass the total, and accepts again after one finishes", () => {
    const body = "x".repeat(KEEPALIVE_EACH / 2);
    const held: Array<() => void> = [];
    for (;;) {
      const release = take(body);
      if (!release) break;
      held.push(release);
      expect(keepaliveInFlight()).toBeLessThanOrEqual(KEEPALIVE_TOTAL);
    }
    expect(held.length).toBeGreaterThan(1);
    held[0]?.();
    expect(take(body)).not.toBeNull();
  });
});

describe("wantsKeepalive", () => {
  it("is for writes only", () => {
    expect(wantsKeepalive("POST", "/items/1/comments")).toBe(true);
    expect(wantsKeepalive("PUT", "/items/1/reactions/heart")).toBe(true);
    expect(wantsKeepalive("DELETE", "/items/1")).toBe(true);
    expect(wantsKeepalive(undefined, "/items")).toBe(false);
    expect(wantsKeepalive("GET", "/items")).toBe(false);
  });
  it("leaves sign-in, join, link, passkey ceremonies, OAuth and passwords alone", () => {
    for (const path of [
      "/session",
      "/session/link",
      "/session/passkey/options",
      "/join",
      "/join/peek",
      "/oauth/decision",
      "/account/password",
      "/account/passkeys",
      "/account/passkeys/options",
    ]) {
      expect(wantsKeepalive("POST", path), path).toBe(false);
    }
    expect(wantsKeepalive("PATCH", "/account/passkeys/abc")).toBe(true);
  });
});
