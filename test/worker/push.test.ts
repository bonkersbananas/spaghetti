import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toBase64Url } from "../../src/shared/base64url.ts";
import { sendNudges } from "../../src/worker/push/nudges.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
/** A morning, and a night, in UTC. */
const noon = Date.UTC(2026, 10, 10, 12);
const night = Date.UTC(2026, 10, 10, 23);
const nextMorning = Date.UTC(2026, 10, 11, 7, 30);

const ids = new Map<string, string>();
/** The API wants UUIDs; the tests name their attempts. */
const uid = (name: string) => {
  const found = ids.get(name) ?? crypto.randomUUID();
  ids.set(name, found);
  return found;
};

let alex = "";
let sam = "";
let pushes: Array<{ url: string; headers: Headers; status: number }>;
let respondWith: (url: string) => number;

/** A real browser key, so the message can be encrypted for it. */
async function browserKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  return {
    p256dh: toBase64Url(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)),
    auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

async function subscribe(cookie: string, name: string, extra: { timeZone?: string; alsoOthers?: boolean } = {}) {
  const response = await request("/api/push/subscription", {
    method: "PUT",
    cookie,
    json: { endpoint: `https://push.example/${name}`, keys: await browserKeys(), timeZone: "UTC", ...extra },
  });
  expect(response.status).toBe(204);
  return `https://push.example/${name}`;
}

/** A build with one attempt, its times set exactly (the API stamps "now"). */
async function attempt(
  cookie: string,
  id: string,
  times: { printedAt: number; endedAt?: number },
  estimatedMinutes?: number,
  title = "Tugboat",
) {
  const item = await request("/api/items", {
    method: "POST",
    cookie,
    json: { id: uid(`item-${id}`), title, stage: "building" },
  });
  expect(item.status).toBeLessThan(300);
  const made = await request(`/api/items/${uid(`item-${id}`)}/attempts`, {
    method: "POST",
    cookie,
    json: { id: uid(id), settings: estimatedMinutes ? { estimatedMinutes } : {} },
  });
  expect(made.status).toBeLessThan(300);
  await env.DB.prepare("UPDATE attempts SET printed_at = ?, ended_at = ? WHERE id = ?")
    .bind(times.printedAt, times.endedAt ?? null, uid(id))
    .run();
}

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex", "tomato");
  await addUser("sam", "another horse", "Sam", "sea");
  alex = await signIn("alex", "correct horse");
  sam = await signIn("sam", "another horse");
  ids.clear();
  pushes = [];
  respondWith = () => 201;
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://push.example/")) return real(input, init);
    const status = respondWith(url);
    pushes.push({ url, headers: new Headers(init?.headers), status });
    return new Response(null, { status });
  });
});
afterEach(() => vi.restoreAllMocks());

describe("when a nudge is sent", () => {
  it("tells the person who started a print that it is off the bed, once", async () => {
    const endpoint = await subscribe(alex, "alex-phone");
    await attempt(alex, "a1", { printedAt: noon - 3 * HOUR, endedAt: noon - 5 * MIN });
    expect(await sendNudges(env, noon)).toEqual({ sent: 1 });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.url).toBe(endpoint);
    expect(pushes[0]?.headers.get("Content-Encoding")).toBe("aes128gcm");
    expect(pushes[0]?.headers.get("Authorization")).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    expect(pushes[0]?.headers.get("TTL")).toBe(String(4 * 60 * 60));
    // Every later run leaves it alone.
    expect(await sendNudges(env, noon + 5 * MIN)).toEqual({ sent: 0 });
    expect(await sendNudges(env, noon + 2 * HOUR)).toEqual({ sent: 0 });
    expect(pushes).toHaveLength(1);
  });

  it("tells them a print without the bridge is overdue ten minutes after its estimate", async () => {
    await subscribe(alex, "alex-phone");
    await attempt(alex, "a2", { printedAt: noon - 69 * MIN }, 60);
    expect(await sendNudges(env, noon)).toEqual({ sent: 0 });
    expect(await sendNudges(env, noon + 2 * MIN)).toEqual({ sent: 1 });
  });

  it("leaves a print with no estimate and no bridge alone, and ones with an outcome", async () => {
    await subscribe(alex, "alex-phone");
    await attempt(alex, "a3", { printedAt: noon - 5 * HOUR });
    await attempt(alex, "a4", { printedAt: noon - 5 * HOUR, endedAt: noon - HOUR });
    await request(`/api/attempts/${uid("a4")}/finish`, { method: "POST", cookie: alex, json: { outcome: "success" } });
    expect(await sendNudges(env, noon)).toEqual({ sent: 0 });
  });

  it("drops a nudge whose moment has passed", async () => {
    await subscribe(alex, "alex-phone");
    await attempt(alex, "a5", { printedAt: noon - 30 * HOUR, endedAt: noon - 14 * HOUR });
    expect(await sendNudges(env, noon)).toEqual({ sent: 0 });
  });

  it("sends only to the person who started it, unless the other asked to hear about all prints", async () => {
    await subscribe(alex, "alex-phone");
    const samPhone = await subscribe(sam, "sam-phone");
    await attempt(alex, "a6", { printedAt: noon - 3 * HOUR, endedAt: noon - 5 * MIN });
    expect(await sendNudges(env, noon)).toEqual({ sent: 1 });
    expect(pushes.map((p) => p.url)).toEqual(["https://push.example/alex-phone"]);

    await attempt(alex, "a7", { printedAt: noon - 3 * HOUR, endedAt: noon - 5 * MIN }, undefined, "Hook");
    await request("/api/push/subscription", {
      method: "PATCH",
      cookie: sam,
      json: { endpoint: samPhone, alsoOthers: true },
    });
    pushes.length = 0;
    // Sam hears about the new one, and about the earlier one he hadn't been told of (still inside its window).
    expect(await sendNudges(env, noon)).toEqual({ sent: 3 });
    expect(pushes.map((p) => p.url).sort()).toEqual([
      "https://push.example/alex-phone",
      "https://push.example/sam-phone",
      "https://push.example/sam-phone",
    ]);
  });

  it("waits for the morning through quiet hours, and doesn't send if an outcome came meanwhile", async () => {
    await subscribe(alex, "alex-phone");
    await attempt(alex, "a8", { printedAt: night - 3 * HOUR, endedAt: night - 5 * MIN });
    await attempt(alex, "a9", { printedAt: night - 3 * HOUR, endedAt: night - 5 * MIN }, undefined, "Hook");
    expect(await sendNudges(env, night)).toEqual({ sent: 0 });
    expect(await sendNudges(env, Date.UTC(2026, 10, 11, 6, 59))).toEqual({ sent: 0 });
    await request(`/api/attempts/${uid("a9")}/finish`, { method: "POST", cookie: alex, json: { outcome: "failed" } });
    expect(await sendNudges(env, nextMorning)).toEqual({ sent: 1 });
    expect(pushes).toHaveLength(1);
  });

  it("reads quiet hours in the device's own time zone", async () => {
    // 23:00 UTC is 09:00 the next morning in Sydney, and 00:00 in Stockholm (a quiet hour).
    await subscribe(alex, "sydney", { timeZone: "Australia/Sydney" });
    await subscribe(alex, "stockholm", { timeZone: "Europe/Stockholm" });
    await attempt(alex, "a10", { printedAt: night - 3 * HOUR, endedAt: night - 5 * MIN });
    expect(await sendNudges(env, night)).toEqual({ sent: 1 });
    expect(pushes.map((p) => p.url)).toEqual(["https://push.example/sydney"]);
  });

  it("sends nothing from a server with no private key", async () => {
    await subscribe(alex, "alex-phone");
    await attempt(alex, "a11", { printedAt: noon - 3 * HOUR, endedAt: noon - 5 * MIN });
    const key = env.VAPID_PRIVATE_KEY;
    env.VAPID_PRIVATE_KEY = undefined;
    try {
      expect(await sendNudges(env, noon)).toEqual({ sent: 0 });
    } finally {
      env.VAPID_PRIVATE_KEY = key;
    }
    expect(pushes).toHaveLength(0);
  });

  it("is answered by the same finish route the app uses, which ends the nudges", async () => {
    await subscribe(alex, "alex-phone");
    await attempt(alex, "a12", { printedAt: noon - 3 * HOUR, endedAt: noon - 5 * MIN });
    // What the service worker sends when a notification button is tapped.
    const answered = await request(`/api/attempts/${uid("a12")}/finish`, {
      method: "POST",
      cookie: alex,
      json: { outcome: "partial", finishedAt: noon - MIN },
    });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toMatchObject({ attempt: { outcome: "partial" } });
    expect(await sendNudges(env, noon)).toEqual({ sent: 0 });
  });
});

describe("a push that doesn't get through", () => {
  it("is tried again on the next run, until a device takes it", async () => {
    await subscribe(alex, "alex-phone");
    await attempt(alex, "r1", { printedAt: noon - 3 * HOUR, endedAt: noon - 5 * MIN });
    respondWith = () => 503;
    expect(await sendNudges(env, noon)).toEqual({ sent: 0 });
    respondWith = () => 201;
    expect(await sendNudges(env, noon + 5 * MIN)).toEqual({ sent: 1 });
    expect(await sendNudges(env, noon + 10 * MIN)).toEqual({ sent: 0 });
  });

  it("with a stored key that can't be used drops that device and still reaches the others", async () => {
    await subscribe(alex, "good");
    await env.DB.prepare(
      "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, time_zone, also_others, created_at) SELECT 'bad', id, 'https://push.example/bad', 'AAAA', 'AAAA', 'UTC', 0, 0 FROM users WHERE username = 'alex'",
    ).run();
    await attempt(alex, "r2", { printedAt: noon - 3 * HOUR, endedAt: noon - 5 * MIN });
    expect(await sendNudges(env, noon)).toEqual({ sent: 1 });
    expect(
      (await env.DB.prepare("SELECT endpoint FROM push_subscriptions").all()).results.map((r) => r.endpoint),
    ).toEqual(["https://push.example/good"]);
  });

  it("is refused at signup when the keys aren't a browser's", async () => {
    const put = (keys: unknown) =>
      request("/api/push/subscription", {
        method: "PUT",
        cookie: alex,
        json: { endpoint: "https://push.example/x", keys, timeZone: "UTC" },
      });
    expect((await put({ p256dh: "AAAA", auth: "AAAA" })).status).toBe(400);
    expect((await put({ ...(await browserKeys()), auth: "AAAA" })).status).toBe(400);
  });
});

describe("expired subscriptions", () => {
  const devices = async () =>
    (await env.DB.prepare("SELECT endpoint FROM push_subscriptions").all()).results.map((r) => r.endpoint);

  for (const status of [404, 410]) {
    it(`are removed when the push service answers ${status}`, async () => {
      await subscribe(alex, "old-phone");
      await subscribe(alex, "new-phone");
      respondWith = (url) => (url.endsWith("old-phone") ? status : 201);
      await attempt(alex, "e1", { printedAt: noon - 3 * HOUR, endedAt: noon - 5 * MIN });
      expect(await sendNudges(env, noon)).toEqual({ sent: 1 });
      expect(await devices()).toEqual(["https://push.example/new-phone"]);
    });
  }

  it("are kept when the push service has a hiccup", async () => {
    await subscribe(alex, "alex-phone");
    respondWith = () => 503;
    await attempt(alex, "e2", { printedAt: noon - 3 * HOUR, endedAt: noon - 5 * MIN });
    expect(await sendNudges(env, noon)).toEqual({ sent: 0 });
    expect(await devices()).toEqual(["https://push.example/alex-phone"]);
  });
});

describe("the devices routes", () => {
  it("lists this person's devices with the public key, and nobody else's", async () => {
    const endpoint = await subscribe(alex, "alex-phone", { alsoOthers: true });
    const mine = await (await request("/api/push", { cookie: alex })).json();
    expect(mine).toEqual({
      publicKey: env.VAPID_PUBLIC_KEY,
      canSend: true,
      subscriptions: [{ endpoint, alsoOthers: true, timeZone: "UTC" }],
    });
    expect(
      ((await (await request("/api/push", { cookie: sam })).json()) as { subscriptions: unknown[] }).subscriptions,
    ).toEqual([]);
  });

  it("refuses endpoints that aren't https, unknown time zones and unreadable keys", async () => {
    const keys = await browserKeys();
    const put = (json: unknown) => request("/api/push/subscription", { method: "PUT", cookie: alex, json });
    expect((await put({ endpoint: "http://push.example/x", keys, timeZone: "UTC" })).status).toBe(400);
    expect((await put({ endpoint: "https://push.example/x", keys, timeZone: "Mars/Olympus" })).status).toBe(400);
    expect(
      (await put({ endpoint: "https://push.example/x", keys: { p256dh: "", auth: "x" }, timeZone: "UTC" })).status,
    ).toBe(400);
  });

  it("signing up again keeps the choice, and a device that changes hands is the new person's", async () => {
    const endpoint = await subscribe(alex, "shared", { alsoOthers: true });
    await subscribe(alex, "shared");
    expect(
      (
        (await (await request("/api/push", { cookie: alex })).json()) as {
          subscriptions: Array<{ alsoOthers: boolean }>;
        }
      ).subscriptions[0]?.alsoOthers,
    ).toBe(true);
    await subscribe(sam, "shared");
    expect(
      ((await (await request("/api/push", { cookie: alex })).json()) as { subscriptions: unknown[] }).subscriptions,
    ).toEqual([]);
    expect(
      ((await (await request("/api/push", { cookie: sam })).json()) as { subscriptions: unknown[] }).subscriptions,
    ).toHaveLength(1);
    expect(endpoint).toBe("https://push.example/shared");
  });

  it("changes and removes only your own device", async () => {
    const endpoint = await subscribe(alex, "alex-phone");
    const theirs = (json: object) =>
      request("/api/push/subscription", { method: "PATCH", cookie: sam, json: { endpoint, ...json } });
    expect((await theirs({ alsoOthers: true })).status).toBe(404);
    await request("/api/push/subscription", { method: "DELETE", cookie: sam, json: { endpoint } });
    expect(
      ((await (await request("/api/push", { cookie: alex })).json()) as { subscriptions: unknown[] }).subscriptions,
    ).toHaveLength(1);
    expect(
      (await request("/api/push/subscription", { method: "DELETE", cookie: alex, json: { endpoint } })).status,
    ).toBe(204);
    expect(
      ((await (await request("/api/push", { cookie: alex })).json()) as { subscriptions: unknown[] }).subscriptions,
    ).toEqual([]);
  });

  it("sends a test notification to this device only, and says when the device is gone", async () => {
    const endpoint = await subscribe(alex, "alex-phone");
    expect((await request("/api/push/test", { method: "POST", cookie: alex, json: { endpoint } })).status).toBe(204);
    expect(pushes.map((p) => p.url)).toEqual([endpoint]);
    expect((await request("/api/push/test", { method: "POST", cookie: sam, json: { endpoint } })).status).toBe(404);
    respondWith = () => 410;
    expect((await request("/api/push/test", { method: "POST", cookie: alex, json: { endpoint } })).status).toBe(410);
    respondWith = () => 500;
    await subscribe(alex, "alex-phone");
    expect((await request("/api/push/test", { method: "POST", cookie: alex, json: { endpoint } })).status).toBe(502);
  });

  it("needs a session and is refused to agent tokens", async () => {
    expect((await request("/api/push")).status).toBe(401);
    const made = await request("/api/agents", {
      method: "POST",
      cookie: alex,
      json: { name: "Claude", scopes: ["read", "capture", "attempts", "printer"] },
    });
    const { token } = (await made.json()) as { token: string };
    const asAgent = (path: string, init: RequestInit & { json?: unknown } = {}) =>
      request(path, { ...init, headers: { Authorization: `Bearer ${token}` } });
    for (const response of [
      await asAgent("/api/push"),
      await asAgent("/api/push/subscription", {
        method: "PUT",
        json: { endpoint: "https://push.example/x", keys: await browserKeys(), timeZone: "UTC" },
      }),
      await asAgent("/api/push/subscription", { method: "DELETE", json: { endpoint: "https://push.example/x" } }),
      await asAgent("/api/push/test", { method: "POST", json: { endpoint: "https://push.example/x" } }),
    ]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "person_only" } });
    }
  });
});

describe("signing out", () => {
  it("forgets the device that says so, and only that one", async () => {
    const phone = await subscribe(alex, "alex-phone");
    await subscribe(alex, "alex-laptop");
    await request("/api/session", { method: "DELETE", cookie: alex, json: { pushEndpoint: phone } });
    const left = (await env.DB.prepare("SELECT endpoint FROM push_subscriptions").all()).results.map((r) => r.endpoint);
    expect(left).toEqual(["https://push.example/alex-laptop"]);
  });

  it("can't be used to forget someone else's device", async () => {
    const phone = await subscribe(alex, "alex-phone");
    await request("/api/session", { method: "DELETE", cookie: sam, json: { pushEndpoint: phone } });
    expect((await env.DB.prepare("SELECT endpoint FROM push_subscriptions").all()).results).toHaveLength(1);
  });
});
