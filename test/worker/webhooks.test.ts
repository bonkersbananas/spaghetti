import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type {
  DeliveriesResponse,
  DeliveryResponse,
  NewWebhookResponse,
  WebhookPayload,
  WebhooksResponse,
} from "../../src/shared/webhooks.ts";
import { RETRY_DELAYS_MS, RETRY_WINDOW_MS } from "../../src/shared/webhooks.ts";
import { getDb } from "../../src/worker/db/index.ts";
import { fanOut, pruneDeliveries, runWebhooks, sendDue } from "../../src/worker/webhooks/deliver.ts";
import { sign } from "../../src/worker/webhooks/secrets.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let alex: string;
let cookie: string;
let samCookie: string;

beforeEach(async () => {
  await resetDb();
  alex = await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  await addUser("sam", "battery staple", "Sam Lund", "basil");
  cookie = await signIn("alex", "correct horse");
  samCookie = await signIn("sam", "battery staple");
});

afterEach(() => vi.restoreAllMocks());

const URL_OK = "https://hooks.example.org/spaghetti";
const uuid = () => crypto.randomUUID();
const errorOf = async (response: Response) =>
  (await response.json<{ error: { code: string; message: string } }>()).error;

interface Sent {
  url: string;
  headers: Headers;
  body: string;
}

/**
 * The internet as the Worker sees it: DNS answers (public unless `dns` says otherwise) and the receiver,
 * answered by `answer` for each POST. The Response is made inside the stub (a Response built in the test can't
 * be read in the Worker's request).
 */
function stubWeb(answer: (sent: Sent) => number | Response | Error = () => 200, dns: Record<string, string[]> = {}) {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "cloudflare-dns.com") {
      const name = url.searchParams.get("name") ?? "";
      const type = url.searchParams.get("type");
      const addresses = (dns[name] ?? ["93.184.216.34"]).filter(
        (address) => (type === "AAAA") === address.includes(":"),
      );
      return Response.json({ Status: 0, Answer: addresses.map((data) => ({ type: type === "AAAA" ? 28 : 1, data })) });
    }
    const call: Sent = { url: url.href, headers: new Headers(init?.headers), body: String(init?.body) };
    expect(init?.redirect).toBe("manual");
    sent.push(call);
    const result = answer(call);
    if (result instanceof Error) throw result;
    return typeof result === "number" ? new Response("ok", { status: result }) : result;
  });
  return sent;
}

async function make(kinds: string[] = ["all"], extra: Record<string, unknown> = {}, as = cookie, url = URL_OK) {
  const response = await request("/api/webhooks", { method: "POST", json: { url, kinds, ...extra }, cookie: as });
  return { response, made: response.status === 201 ? await response.json<NewWebhookResponse>() : null };
}

async function createItem(as = cookie) {
  const response = await request("/api/items", { method: "POST", json: { id: uuid(), title: "Benchy" }, cookie: as });
  expect(response.status).toBe(201);
}

const db = () => getDb(env.DB);
const deliveries = async (id: string, as = cookie) =>
  (await (await request(`/api/webhooks/${id}/deliveries`, { cookie: as })).json<DeliveriesResponse>()).deliveries;

describe("making webhooks", () => {
  it("shows the secret once and keeps only an encrypted copy", async () => {
    const { response, made } = await make(["item", "comment"]);
    expect(response.status).toBe(201);
    expect(made?.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(made?.webhook).toMatchObject({
      url: URL_OK,
      kinds: ["item", "comment"],
      state: "active",
      secretPrefix: made?.secret.slice(0, 10),
    });
    const listed = await request("/api/webhooks", { cookie });
    const text = await listed.text();
    expect(text).not.toContain(made?.secret ?? "?");
    expect((JSON.parse(text) as WebhooksResponse).webhooks).toHaveLength(1);
    const stored = await env.DB.prepare("SELECT secret_enc, secret_prefix FROM webhooks").first<{
      secret_enc: string;
    }>();
    expect(stored?.secret_enc).not.toContain(made?.secret.slice(6) ?? "?");
    expect(stored?.secret_enc).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("is for people only: an agent token is refused, however broad", async () => {
    const agent = await (
      await request("/api/agents", {
        method: "POST",
        json: { name: "Claude", scopes: ["read", "capture", "attempts", "printer"] },
        cookie,
      })
    ).json<NewTokenResponse>();
    const asAgent = (path: string, init: RequestInit & { json?: unknown } = {}) =>
      request(path, { ...init, headers: { Authorization: `Bearer ${agent.token}` } });
    const { made } = await make();
    for (const [method, path] of [
      ["GET", "/api/webhooks"],
      ["POST", "/api/webhooks"],
      ["DELETE", `/api/webhooks/${made?.webhook.id}`],
      ["POST", `/api/webhooks/${made?.webhook.id}/test`],
      ["GET", `/api/webhooks/${made?.webhook.id}/deliveries`],
    ] as const) {
      const answer = await asAgent(path, {
        method,
        json: method === "POST" ? { url: URL_OK, kinds: ["all"] } : undefined,
      });
      expect(answer.status, `${method} ${path}`).toBe(403);
      expect((await errorOf(answer)).code).toBe("person_only");
    }
    expect((await request("/api/webhooks")).status).toBe(401);
  });

  it("keeps each person's webhooks to themselves", async () => {
    const { made } = await make();
    const id = made?.webhook.id;
    expect((await (await request("/api/webhooks", { cookie: samCookie })).json<WebhooksResponse>()).webhooks).toEqual(
      [],
    );
    expect((await request(`/api/webhooks/${id}/test`, { method: "POST", cookie: samCookie })).status).toBe(404);
    expect((await request(`/api/webhooks/${id}`, { method: "DELETE", cookie: samCookie })).status).toBe(404);
  });

  it("refuses addresses that aren't public https", async () => {
    for (const url of [
      "http://hooks.example.org/x",
      "https://127.0.0.1/x",
      "https://localhost/x",
      "https://192.168.1.20/x",
      "https://[::1]/x",
      "https://printer.local/x",
      "https://user:pw@hooks.example.org/x",
      "https://hooks.example.org:8443/x",
      "ftp://hooks.example.org/x",
    ]) {
      const { response } = await make(["all"], {}, cookie, url);
      expect(response.status, url).toBe(422);
      expect((await errorOf(response)).code).toBe("unsafe_url");
    }
    expect((await make([], {})).response.status).toBe(400);
    expect((await make(["nonsense"])).response.status).toBe(400);
  });

  it("only takes an agent of your own, and takes at most ten", async () => {
    const sams = await (
      await request("/api/agents", {
        method: "POST",
        json: { name: "Claude for Sam", scopes: ["read"] },
        cookie: samCookie,
      })
    ).json<NewTokenResponse>();
    expect((await make(["all"], { agentId: sams.agent.id })).response.status).toBe(400);
    const mine = await (
      await request("/api/agents", { method: "POST", json: { name: "Claude for Alex", scopes: ["read"] }, cookie })
    ).json<NewTokenResponse>();
    expect((await make(["all"], { agentId: mine.agent.id })).made?.webhook.agentId).toBe(mine.agent.id);
    for (let i = 0; i < 9; i++) expect((await make()).response.status).toBe(201);
    expect((await make()).response.status).toBe(409);
  });

  it("deletes with an undo", async () => {
    const { made } = await make();
    const id = made?.webhook.id;
    expect((await request(`/api/webhooks/${id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await (await request("/api/webhooks", { cookie })).json<WebhooksResponse>()).webhooks).toEqual([]);
    expect((await request(`/api/webhooks/${id}/restore`, { method: "POST", cookie })).status).toBe(200);
    expect((await (await request("/api/webhooks", { cookie })).json<WebhooksResponse>()).webhooks).toHaveLength(1);
  });
});

describe("delivering changes", () => {
  it("turns the changes it asked for into signed POSTs, in the change feed's shape", async () => {
    const { made } = await make(["item"]);
    await createItem(); // an item change
    await request("/api/tags", { method: "POST", json: { kind: "failure", label: "Warping" }, cookie }); // a tag change: not wanted
    const sent = stubWeb();
    const result = await runWebhooks(env);
    expect(result).toMatchObject({ made: 1, sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    const [call] = sent;
    const payload = JSON.parse(call?.body ?? "{}") as WebhookPayload;
    expect(payload).toMatchObject({
      webhookId: made?.webhook.id,
      test: false,
      more: false,
      reset: false,
      changes: [{ entity: "item", action: "created", actor: { kind: "person", id: alex } }],
    });
    expect(payload.cursor).toBe(payload.changes[0]?.seq);
    expect(call?.headers.get("Spaghetti-Delivery")).toBe(payload.deliveryId);
    const timestamp = call?.headers.get("Spaghetti-Timestamp") ?? "";
    expect(Math.abs(Number(timestamp) - Date.now() / 1000)).toBeLessThan(30);
    expect(call?.headers.get("Spaghetti-Signature")).toBe(
      `v1=${await sign(made?.secret ?? "", timestamp, call?.body ?? "")}`,
    );
    // The cursor moved: running again sends nothing.
    expect(await runWebhooks(env)).toMatchObject({ made: 0, sent: 0 });
    expect((await deliveries(made?.webhook.id ?? ""))[0]).toMatchObject({
      status: "delivered",
      attempts: 1,
      httpStatus: 200,
    });
  });

  it("starts from now: changes from before it was made aren't replayed", async () => {
    await createItem();
    await make();
    const sent = stubWeb();
    expect(await runWebhooks(env)).toMatchObject({ made: 0 });
    expect(sent).toHaveLength(0);
    await createItem();
    expect(await runWebhooks(env)).toMatchObject({ made: 1, sent: 1 });
  });

  it("makes a delivery once per change however often it runs", async () => {
    const { made } = await make();
    await createItem();
    stubWeb(() => 500);
    await Promise.all([fanOut(db()), fanOut(db())]);
    expect(await deliveries(made?.webhook.id ?? "")).toHaveLength(1);
  });

  it("retries with backoff, and stays quiet until each retry is due", async () => {
    const { made } = await make();
    await createItem();
    const sent = stubWeb(() => 503);
    const start = Date.now();
    await runWebhooks(env, start);
    expect(sent).toHaveLength(1);
    const [first] = await deliveries(made?.webhook.id ?? "");
    expect(first).toMatchObject({ status: "pending", attempts: 1, httpStatus: 503, error: "It answered 503." });
    expect(first?.nextAt).toBeGreaterThanOrEqual(start + (RETRY_DELAYS_MS[0] ?? 0));

    // Not yet due: nothing is sent.
    await sendDue(env, db(), start + 30_000);
    expect(sent).toHaveLength(1);
    // Due: a second try, with the same body and a new signature.
    await sendDue(env, db(), start + (RETRY_DELAYS_MS[0] ?? 0) + 1000);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.body).toBe(sent[0]?.body);
    expect((await deliveries(made?.webhook.id ?? ""))[0]).toMatchObject({ attempts: 2, status: "pending" });
    const info = (await (await request("/api/webhooks", { cookie })).json<WebhooksResponse>()).webhooks[0];
    expect(info?.state).toBe("active");
  });

  it("recovers: a later success clears the retries", async () => {
    const { made } = await make();
    await createItem();
    let status = 500;
    stubWeb(() => status);
    const start = Date.now();
    await runWebhooks(env, start);
    status = 200;
    await sendDue(env, db(), start + (RETRY_DELAYS_MS[0] ?? 0) + 1000);
    expect((await deliveries(made?.webhook.id ?? ""))[0]).toMatchObject({
      status: "delivered",
      attempts: 2,
      nextAt: null,
    });
  });

  it("gives up after a day, marks the webhook failing and shows the last error", async () => {
    const { made } = await make();
    await createItem();
    const sent = stubWeb(() => 500);
    let now = Date.now();
    const created = now;
    await runWebhooks(env, now);
    // The cron wakes every five minutes; walk through the whole day.
    while (now < created + RETRY_WINDOW_MS + 60 * 60 * 1000) {
      now += 5 * 60 * 1000;
      await sendDue(env, db(), now);
    }
    expect(sent).toHaveLength(RETRY_DELAYS_MS.length + 1);
    const [delivery] = await deliveries(made?.webhook.id ?? "");
    expect(delivery).toMatchObject({ status: "failed", attempts: RETRY_DELAYS_MS.length + 1, nextAt: null });
    const info = (await (await request("/api/webhooks", { cookie })).json<WebhooksResponse>()).webhooks[0];
    expect(info).toMatchObject({ state: "failing", lastError: "It answered 500." });
    expect(info?.lastErrorAt).not.toBeNull();
    // It keeps trying fresh changes, and one success makes it active again.
    await createItem();
    stubWeb(() => 200);
    await runWebhooks(env, now + 1000);
    expect((await (await request("/api/webhooks", { cookie })).json<WebhooksResponse>()).webhooks[0]?.state).toBe(
      "active",
    );
  });

  it("doesn't follow redirects and treats a timeout or a refusal to connect as a failure", async () => {
    const { made } = await make();
    await createItem();
    stubWeb(() => new Response(null, { status: 302, headers: { Location: "https://169.254.169.254/" } }));
    await runWebhooks(env);
    expect((await deliveries(made?.webhook.id ?? ""))[0]).toMatchObject({
      httpStatus: 302,
      error: "It answered 302: redirects aren't followed.",
    });

    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    stubWeb(() => timeout);
    await sendDue(env, db(), Date.now() + 3 * 60 * 1000);
    expect((await deliveries(made?.webhook.id ?? ""))[0]?.error).toBe("It didn't answer in time.");
    stubWeb(() => new Error("connection refused"));
    await sendDue(env, db(), Date.now() + 10 * 60 * 1000);
    expect((await deliveries(made?.webhook.id ?? ""))[0]?.error).toBe("Couldn't connect to it.");
  });

  it("refuses a name that now points somewhere private, without sending anything", async () => {
    const { made } = await make();
    await createItem();
    const sent = stubWeb(() => 200, { "hooks.example.org": ["192.168.1.30"] });
    await runWebhooks(env);
    expect(sent).toHaveLength(0);
    expect((await deliveries(made?.webhook.id ?? ""))[0]).toMatchObject({
      status: "failed",
      error: "That address points somewhere private, or doesn't resolve.",
    });
    expect((await (await request("/api/webhooks", { cookie })).json<WebhooksResponse>()).webhooks[0]?.state).toBe(
      "failing",
    );
  });

  it("sends nothing for a deleted webhook", async () => {
    const { made } = await make();
    await request(`/api/webhooks/${made?.webhook.id}`, { method: "DELETE", cookie });
    await createItem();
    const sent = stubWeb();
    await runWebhooks(env);
    expect(sent).toHaveLength(0);
  });
});

describe("test events and retries by hand", () => {
  it("sends a test event now and records it", async () => {
    const { made } = await make();
    const sent = stubWeb();
    const response = await request(`/api/webhooks/${made?.webhook.id}/test`, { method: "POST", cookie });
    expect(response.status).toBe(201);
    const { delivery } = await response.json<DeliveryResponse>();
    expect(delivery).toMatchObject({ test: true, status: "delivered", httpStatus: 200, seq: null });
    expect((JSON.parse(sent[0]?.body ?? "{}") as WebhookPayload).test).toBe(true);
    expect(await deliveries(made?.webhook.id ?? "")).toHaveLength(1);
  });

  it("reports a test event that fails, and Retry sends it again", async () => {
    const { made } = await make();
    stubWeb(() => 500);
    const { delivery } = await (
      await request(`/api/webhooks/${made?.webhook.id}/test`, { method: "POST", cookie })
    ).json<DeliveryResponse>();
    expect(delivery).toMatchObject({ status: "pending", attempts: 1, error: "It answered 500." });
    const sent = stubWeb();
    const retried = await request(`/api/webhooks/${made?.webhook.id}/deliveries/${delivery.id}/retry`, {
      method: "POST",
      cookie,
    });
    expect((await retried.json<DeliveryResponse>()).delivery).toMatchObject({
      status: "delivered",
      attempts: 1,
      error: null,
    });
    expect(sent).toHaveLength(1);
    expect(
      (await request(`/api/webhooks/${made?.webhook.id}/deliveries/${uuid()}/retry`, { method: "POST", cookie }))
        .status,
    ).toBe(404);
  });

  it("tidies old finished deliveries daily, never pending ones", async () => {
    const { made } = await make();
    stubWeb();
    await request(`/api/webhooks/${made?.webhook.id}/test`, { method: "POST", cookie });
    await pruneDeliveries(env, Date.now());
    expect(await deliveries(made?.webhook.id ?? "")).toHaveLength(1);
    await pruneDeliveries(env, Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(await deliveries(made?.webhook.id ?? "")).toHaveLength(0);
  });
});
