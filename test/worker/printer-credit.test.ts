import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentsResponse, NewTokenResponse } from "../../src/shared/agents.ts";
import type { AttemptResponse, ItemResponse, JournalResponse, SearchResponse } from "../../src/shared/api.ts";
import { toBase64Url } from "../../src/shared/base64url.ts";
import type { PushMessage } from "../../src/shared/push.ts";
import { buildStory } from "../../src/shared/story.ts";
import { sendNudges } from "../../src/worker/push/nudges.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

/**
 * A print the printer bridge records is the printer's (decision 0076), not whoever paired the bridge: nobody's until a
 * person says who started it.
 */
let carl: string;
let marie: string;
let carlId: string;
let marieId: string;
let token: string;

const uuid = () => crypto.randomUUID();
const asBridge = (path: string, init: RequestInit & { json?: unknown } = {}) =>
  request(path, { ...init, headers: { Authorization: `Bearer ${token}`, Origin: "http://printer.test" } });

beforeEach(async () => {
  await resetDb();
  carlId = await addUser("carl", "correct horse", "Carl Oscar", "sea");
  marieId = await addUser("xixa", "another horse", "Marie", "plum");
  carl = await signIn("carl", "correct horse");
  marie = await signIn("xixa", "another horse");
  // Carl Oscar paired the bridge: its agent is his.
  const made = await request("/api/agents", {
    method: "POST",
    json: { name: "Printer bridge", scopes: ["read", "attempts", "printer"] },
    cookie: carl,
  });
  token = (await made.json<NewTokenResponse>()).token;
  const told = await asBridge("/api/printer/bridge", { method: "PUT", json: { printerState: "idle", progress: null } });
  expect(told.status).toBe(200);
});

/** What the bridge does for a print nothing matches: a build named after it, then the attempt in that build. */
async function printerPrints(name = "cable-clip-v3", printedAt = Date.now()) {
  const ownId = uuid();
  const attemptId = uuid();
  expect(
    (await asBridge("/api/items", { method: "POST", json: { id: ownId, title: name, stage: "building" } })).status,
  ).toBe(201);
  const response = await asBridge(`/api/items/${ownId}/attempts`, {
    method: "POST",
    json: { id: attemptId, printedAt, print: { name } },
  });
  expect(response.status).toBe(201);
  return { ownId, attemptId };
}

async function build(title: string, cookie = carl) {
  const id = uuid();
  expect((await request("/api/items", { method: "POST", cookie, json: { id, title, stage: "building" } })).status).toBe(
    201,
  );
  return id;
}

const itemOf = async (id: string, cookie = carl) =>
  (await (await request(`/api/items/${id}`, { cookie })).json<ItemResponse>()).item;
const startedBy = (attemptId: string, who: string | null, cookie = carl) =>
  request(`/api/attempts/${attemptId}/started-by`, { method: "PUT", cookie, json: { startedBy: who } });
const journal = async (query = "") =>
  (await (await request(`/api/journal${query}`, { cookie: carl })).json<JournalResponse>()).entries;

describe("a print from the printer", () => {
  it("is the printer's, not the person who paired the bridge", async () => {
    const { ownId, attemptId } = await printerPrints();
    const item = await itemOf(ownId);
    expect(item.fromPrinter).toBe(true);
    const attempt = item.attempts.find((one) => one.id === attemptId);
    expect(attempt).toMatchObject({ fromPrinter: true, startedBy: null });

    // The journal names nobody for it, and it isn't Carl Oscar's when the journal or search asks for his.
    const entry = (await journal()).find((one) => one.attemptId === attemptId);
    expect(entry).toMatchObject({ kind: "attempt", by: null });
    expect((await journal(`?person=${carlId}`)).map((one) => one.itemId)).not.toContain(ownId);
    const search = async (query: string) =>
      (await (await request(`/api/search?${query}`, { cookie: carl })).json<SearchResponse>()).builds.map(
        (hit) => hit.item.id,
      );
    expect(await search("q=cable")).toContain(ownId);
    expect(await search(`q=cable&person=${carlId}`)).not.toContain(ownId);

    // A person's own attempt is still theirs.
    const own = await build("Desk hook");
    const logged = await request(`/api/items/${own}/attempts`, { method: "POST", cookie: carl, json: { id: uuid() } });
    const mine = (await logged.json<AttemptResponse>()).attempt;
    expect(mine).toMatchObject({ fromPrinter: false, startedBy: null, createdBy: carlId });
    expect((await journal()).find((one) => one.attemptId === mine.id)).toMatchObject({ by: carlId });
  });

  it("is the printer's in what Claude reads of the build, too", async () => {
    const { ownId } = await printerPrints();
    const item = await itemOf(ownId);
    const story = buildStory(item, {
      people: new Map([
        [carlId, { name: "Carl Oscar" }],
        [marieId, { name: "Marie" }],
      ]),
      agents: new Map(),
    });
    expect(story).toContain("by the printer");
    expect(story).not.toContain("Carl Oscar");
  });

  it("takes who started it from a person, and gives it back", async () => {
    const { ownId, attemptId } = await printerPrints();
    const said = await startedBy(attemptId, marieId);
    expect(said.status).toBe(200);
    expect((await said.json<AttemptResponse>()).attempt).toMatchObject({ fromPrinter: true, startedBy: marieId });
    expect((await itemOf(ownId, marie)).attempts[0]?.startedBy).toBe(marieId);

    expect((await journal()).find((one) => one.attemptId === attemptId)).toMatchObject({ by: marieId });
    expect((await journal(`?person=${marieId}`)).map((one) => one.attemptId)).toContain(attemptId);
    expect((await journal(`?person=${carlId}`)).map((one) => one.attemptId)).not.toContain(attemptId);

    // The other device hears of it.
    const recorded = await env.DB.prepare(
      "SELECT count(*) AS n FROM changes WHERE entity = 'attempt' AND entity_id = ?",
    )
      .bind(attemptId)
      .first<{ n: number }>();
    expect(recorded?.n).toBeGreaterThan(1);

    // Undo: nobody again.
    expect((await startedBy(attemptId, null)).status).toBe(200);
    expect((await itemOf(ownId)).attempts[0]?.startedBy).toBeNull();
  });

  it("keeps who started it when it moves to another build, and back", async () => {
    const glass = await build("UÖBF glass markers");
    const { ownId, attemptId } = await printerPrints();
    await startedBy(attemptId, marieId);
    const moved = await request(`/api/attempts/${attemptId}/move`, {
      method: "POST",
      cookie: carl,
      json: { targetId: glass },
    });
    expect(moved.status).toBe(200);
    expect((await itemOf(glass)).attempts[0]).toMatchObject({ id: attemptId, fromPrinter: true, startedBy: marieId });
    expect((await request(`/api/attempts/${attemptId}/unmove`, { method: "POST", cookie: carl })).status).toBe(200);
    expect((await itemOf(ownId)).attempts[0]).toMatchObject({ id: attemptId, startedBy: marieId });
  });

  it("is said by people only, about a print from the printer, as one of them", async () => {
    const { attemptId } = await printerPrints();
    // Not the bridge's token: it can't know, and mustn't guess.
    const asIt = await asBridge(`/api/attempts/${attemptId}/started-by`, {
      method: "PUT",
      json: { startedBy: carlId },
    });
    expect(asIt.status).toBe(403);
    // Only someone of the two.
    expect((await startedBy(attemptId, uuid())).status).toBe(400);
    expect((await startedBy(attemptId, "")).status).toBe(400);
    // Only a print from the printer: a person's own attempt is theirs already.
    const own = await build("Desk hook");
    const logged = await request(`/api/items/${own}/attempts`, { method: "POST", cookie: carl, json: { id: uuid() } });
    const mine = (await logged.json<AttemptResponse>()).attempt;
    expect((await startedBy(mine.id, marieId)).status).toBe(409);
    expect((await startedBy(uuid(), marieId)).status).toBe(404);
    expect((await itemOf((await printerPrints("other")).ownId)).attempts[0]?.startedBy).toBeNull();
  });

  it("marks the bridge's agent as the printer", async () => {
    const agents = await (await request("/api/agents", { cookie: marie })).json<AgentsResponse>();
    expect(agents.agents.find((agent) => agent.name === "Printer bridge")?.printer).toBe(true);
    // And keeps it so after the bridge disconnects: its old prints stay the printer's.
    const { ownId } = await printerPrints();
    expect((await request("/api/printer/bridge", { method: "DELETE", cookie: carl })).status).toBe(200);
    expect((await itemOf(ownId)).attempts[0]?.fromPrinter).toBe(true);
  });
});

describe("hearing of a print from the printer", () => {
  const HOUR = 60 * 60 * 1000;
  const noon = Date.UTC(2026, 10, 10, 12);
  let sent: Array<{ endpoint: string; message: PushMessage }>;
  const deliver = async (_env: Env, _vapid: unknown, device: { endpoint: string }, message: PushMessage) => {
    sent.push({ endpoint: device.endpoint, message });
    return "sent" as const;
  };

  async function subscribe(cookie: string, name: string, alsoOthers = false) {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const keys = {
      p256dh: toBase64Url(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)),
      auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    };
    const endpoint = `https://push.example/${name}`;
    const response = await request("/api/push/subscription", {
      method: "PUT",
      cookie,
      json: { endpoint, keys, timeZone: "UTC", alsoOthers },
    });
    expect(response.status).toBe(204);
  }

  /** A print from the printer that came off the bed a few minutes ago. */
  async function offTheBed(name = "cable-clip-v3") {
    const { attemptId } = await printerPrints(name);
    await env.DB.prepare("UPDATE attempts SET printed_at = ?, ended_at = ? WHERE id = ?")
      .bind(noon - 3 * HOUR, noon - 5 * 60_000, attemptId)
      .run();
    return attemptId;
  }

  beforeEach(() => {
    sent = [];
  });
  afterEach(() => {
    sent = [];
  });

  it("tells both people, naming neither, while nobody has said who started it", async () => {
    await subscribe(carl, "carl-phone");
    await subscribe(marie, "marie-phone");
    await offTheBed();
    await sendNudges(env, noon, deliver);
    expect(sent.map((one) => one.endpoint).sort()).toEqual([
      "https://push.example/carl-phone",
      "https://push.example/marie-phone",
    ]);
    for (const { message } of sent) {
      expect(message.body).not.toContain("Carl Oscar");
      expect(message.body).not.toContain("Marie");
    }
  });

  it("follows the person once they are named: theirs, and the other's only if asked", async () => {
    await subscribe(carl, "carl-phone", true);
    await subscribe(marie, "marie-phone");
    const attemptId = await offTheBed();
    await startedBy(attemptId, marieId);
    await sendNudges(env, noon, deliver);
    const byEndpoint = new Map(sent.map((one) => [one.endpoint, one.message]));
    expect(byEndpoint.get("https://push.example/marie-phone")?.body).not.toContain("'s print");
    expect(byEndpoint.get("https://push.example/carl-phone")?.body).toContain("Marie's print");

    // Carl Oscar didn't ask to hear of Marie's prints on this one: only she is told.
    sent = [];
    await request("/api/push/subscription", {
      method: "PATCH",
      cookie: carl,
      json: { endpoint: "https://push.example/carl-phone", alsoOthers: false },
    });
    const next = await offTheBed("bath-boat");
    await startedBy(next, marieId);
    await sendNudges(env, noon, deliver);
    expect(sent.map((one) => one.endpoint)).toEqual(["https://push.example/marie-phone"]);
  });
});
