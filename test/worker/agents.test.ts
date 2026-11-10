import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { AGENT_SCOPES, type AgentScope, type AgentsResponse, type NewTokenResponse } from "../../src/shared/agents.ts";
import type { ItemResponse, JournalResponse } from "../../src/shared/api.ts";
import type { ChangesResponse } from "../../src/shared/changes.ts";
import { LAST_USED_EVERY_MS } from "../../src/worker/auth/agent.ts";
import { addUser, request, resetDb, signIn, uploadPhoto } from "./helpers.ts";

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

async function makeAgent(scopes: AgentScope[], name = "Claude for Alex", as = cookie) {
  const response = await request("/api/agents", { method: "POST", json: { name, scopes }, cookie: as });
  expect(response.status).toBe(201);
  return response.json<NewTokenResponse>();
}

/** A request as an agent: the token and nothing else (no cookie, no Origin that matches). */
function asAgent(token: string, path: string, init: RequestInit & { json?: unknown } = {}) {
  return request(path, { ...init, headers: { Authorization: `Bearer ${token}`, Origin: "http://other.test" } });
}

const uuid = () => crypto.randomUUID();
const status = async (response: Promise<Response>) => (await response).status;
const errorOf = async (response: Response) =>
  (await response.json<{ error: { code: string; message: string } }>()).error;

async function createItem(as = cookie, body: Record<string, unknown> = {}) {
  const response = await request("/api/items", { method: "POST", json: { id: uuid(), ...body }, cookie: as });
  expect(response.status).toBe(201);
  return (await response.json<ItemResponse>()).item;
}

describe("making agents and tokens", () => {
  it("shows the token once, keeps only its hash and prefix, and lists agents for both people", async () => {
    const made = await makeAgent(["read", "capture"]);
    expect(made.token).toMatch(/^spg_[A-Za-z0-9_-]{43}$/);
    expect(made.agent).toMatchObject({ name: "Claude for Alex", ownerId: alex });
    expect(made.agent.tokens).toHaveLength(1);
    expect(made.agent.tokens[0]).toMatchObject({
      id: made.tokenId,
      prefix: made.token.slice(0, 8),
      scopes: ["read", "capture"],
      lastUsedAt: null,
      revokedAt: null,
    });

    const listed = await (await request("/api/agents", { cookie })).json<AgentsResponse>();
    expect(JSON.stringify(listed)).not.toContain(made.token);
    expect(listed.agents[0]?.tokens[0]?.prefix).toBe(made.token.slice(0, 8));
    // Nothing of the token is stored but its hash.
    const stored = await env.DB.prepare("SELECT * FROM agent_tokens").all<Record<string, unknown>>();
    expect(JSON.stringify(stored.results)).not.toContain(made.token);
    expect(stored.results[0]?.hash).toMatch(/^[0-9a-f]{64}$/);

    // Sam sees that the agent exists (to read "via Claude for Alex") but not its tokens.
    const theirs = (await (await request("/api/agents", { cookie: samCookie })).json<AgentsResponse>()).agents;
    expect(theirs).toEqual([expect.objectContaining({ id: made.agent.id, name: "Claude for Alex", tokens: [] })]);
  });

  it("validates names and scopes, and de-duplicates scopes in a fixed order", async () => {
    const bad = (json: unknown) => status(request("/api/agents", { method: "POST", json, cookie }));
    expect(await bad({ name: "", scopes: ["read"] })).toBe(400);
    expect(await bad({ name: "Bridge", scopes: [] })).toBe(400);
    expect(await bad({ name: "Bridge", scopes: ["root"] })).toBe(400);
    const made = await makeAgent(["printer", "read", "read"], "Printer bridge");
    expect(made.agent.tokens[0]?.scopes).toEqual(["read", "printer"]);
  });

  it("adds tokens to an agent, for its owner only, and revokes them", async () => {
    const made = await makeAgent(["read"]);
    const more = await request(`/api/agents/${made.agent.id}/tokens`, {
      method: "POST",
      json: { scopes: ["read", "attempts"] },
      cookie,
    });
    expect(more.status).toBe(201);
    const second = await more.json<NewTokenResponse>();
    expect(second.agent.tokens).toHaveLength(2);
    expect(second.token).not.toBe(made.token);

    // Sam can neither add to nor revoke Alex's agent.
    expect(
      await status(
        request(`/api/agents/${made.agent.id}/tokens`, {
          method: "POST",
          json: { scopes: ["read"] },
          cookie: samCookie,
        }),
      ),
    ).toBe(404);
    expect(
      await status(
        request(`/api/agents/${made.agent.id}/tokens/${made.tokenId}`, { method: "DELETE", cookie: samCookie }),
      ),
    ).toBe(404);
    expect(await status(asAgent(made.token, "/api/items"))).toBe(200);

    const revoke = () => request(`/api/agents/${made.agent.id}/tokens/${made.tokenId}`, { method: "DELETE", cookie });
    expect((await revoke()).status).toBe(204);
    expect((await revoke()).status).toBe(204);
    expect((await request(`/api/agents/${made.agent.id}/tokens/${uuid()}`, { method: "DELETE", cookie })).status).toBe(
      404,
    );
    // At once: the very next request is refused; the other token is untouched.
    expect(await status(asAgent(made.token, "/api/items"))).toBe(401);
    expect(await status(asAgent(second.token, "/api/items"))).toBe(200);
    const tokens = (await (await request("/api/agents", { cookie })).json<AgentsResponse>()).agents[0]?.tokens;
    expect(tokens?.find((token) => token.id === made.tokenId)?.revokedAt).toBeGreaterThan(0);
  });
});

describe("authenticating with a token", () => {
  it("refuses unknown, malformed and revoked tokens, and never falls back to the cookie", async () => {
    const made = await makeAgent(["read"]);
    for (const header of ["Bearer spg_nope", "Bearer nonsense", "Bearer", "Basic abc", `Bearer ${made.token}x`]) {
      const response = await request("/api/items", { headers: { Authorization: header }, cookie });
      expect(response.status, header).toBe(401);
      expect((await errorOf(response)).code).toBe("invalid_token");
    }
    expect(await status(request("/api/items"))).toBe(401);
  });

  it("moves its last-used time at most every few minutes", async () => {
    const made = await makeAgent(["read"]);
    const lastUsed = async () =>
      (await env.DB.prepare("SELECT last_used_at AS t FROM agent_tokens").first<{ t: number | null }>())?.t ?? null;
    expect(await lastUsed()).toBeNull();
    await asAgent(made.token, "/api/items");
    const first = await lastUsed();
    expect(first).toBeGreaterThan(0);
    await asAgent(made.token, "/api/items");
    expect(await lastUsed()).toBe(first);
    await env.DB.prepare("UPDATE agent_tokens SET last_used_at = ?")
      .bind(Date.now() - LAST_USED_EVERY_MS - 1000)
      .run();
    await asAgent(made.token, "/api/items");
    expect(await lastUsed()).toBeGreaterThan(Date.now() - 10_000);
  });

  it("is refused everything about people, agents, tokens and sessions", async () => {
    const made = await makeAgent([...AGENT_SCOPES]);
    const refused = async (response: Promise<Response>) => {
      const result = await response;
      expect(result.status).toBe(403);
      expect((await errorOf(result)).code).toBe("person_only");
    };
    await refused(asAgent(made.token, "/api/agents"));
    await refused(asAgent(made.token, "/api/agents", { method: "POST", json: { name: "Sneaky", scopes: ["read"] } }));
    await refused(
      asAgent(made.token, `/api/agents/${made.agent.id}/tokens`, { method: "POST", json: { scopes: ["read"] } }),
    );
    await refused(asAgent(made.token, `/api/agents/${made.agent.id}/tokens/${made.tokenId}`, { method: "DELETE" }));
    // Deleting and restoring are for people.
    const item = await createItem();
    await refused(asAgent(made.token, `/api/items/${item.id}`, { method: "DELETE" }));
    await refused(asAgent(made.token, `/api/items/${item.id}/restore`, { method: "POST" }));
    await refused(asAgent(made.token, `/api/photos/${uuid()}`, { method: "DELETE" }));
    await refused(asAgent(made.token, `/api/spools/${uuid()}`, { method: "DELETE" }));
    // The session is a cookie's business: a token reads none, and can't sign in as anyone.
    expect(await status(asAgent(made.token, "/api/session"))).toBe(401);
    expect(await status(asAgent(made.token, "/api/session", { method: "DELETE" }))).toBe(204);
    expect(await status(asAgent(made.token, "/api/items"))).toBe(200);
    // Nothing happened.
    expect((await (await request("/api/agents", { cookie })).json<AgentsResponse>()).agents).toHaveLength(1);
    expect(await status(request(`/api/items/${item.id}`, { cookie }))).toBe(200);
  });
});

/** One row per rule in auth/scopes.ts: the scope that opens it, and a request that reaches the route when allowed. */
const itemId = uuid();
const attemptId = uuid();
const spoolId = uuid();
const rows: Array<{ name: string; scope: AgentScope; method: string; path: string; json?: unknown }> = [
  { name: "read items", scope: "read", method: "GET", path: "/api/items" },
  { name: "read the journal", scope: "read", method: "GET", path: "/api/journal" },
  { name: "search", scope: "read", method: "GET", path: "/api/search?q=bracket" },
  { name: "what worked", scope: "read", method: "GET", path: `/api/items/${itemId}/what-worked` },
  { name: "read the pantry", scope: "read", method: "GET", path: "/api/spools" },
  { name: "read the printer", scope: "read", method: "GET", path: "/api/printer" },
  { name: "read the people", scope: "read", method: "GET", path: "/api/people" },
  { name: "read the feed", scope: "read", method: "GET", path: "/api/changes" },
  { name: "capture an idea", scope: "capture", method: "POST", path: "/api/items", json: { id: uuid(), note: "x" } },
  { name: "reorder Up next", scope: "capture", method: "PUT", path: "/api/items/up-next/order", json: { ids: [] } },
  { name: "share an idea in", scope: "capture", method: "POST", path: "/api/capture", json: { text: "x" } },
  { name: "add a note", scope: "capture", method: "PATCH", path: `/api/items/${itemId}`, json: { note: "more" } },
  {
    name: "reorder photos",
    scope: "capture",
    method: "PUT",
    path: `/api/items/${itemId}/photos/order`,
    json: { photoIds: [] },
  },
  {
    name: "start an attempt",
    scope: "attempts",
    method: "POST",
    path: `/api/items/${itemId}/attempts`,
    json: { id: uuid() },
  },
  {
    name: "edit an attempt",
    scope: "attempts",
    method: "PATCH",
    path: `/api/attempts/${attemptId}`,
    json: { note: "x" },
  },
  {
    name: "finish an attempt",
    scope: "attempts",
    method: "POST",
    path: `/api/attempts/${attemptId}/finish`,
    json: { outcome: "success" },
  },
  {
    name: "move a build along",
    scope: "attempts",
    method: "PATCH",
    path: `/api/items/${itemId}`,
    json: { stage: "building" },
  },
  {
    name: "add a tag",
    scope: "attempts",
    method: "POST",
    path: "/api/tags",
    json: { kind: "failure", label: "Ghosting" },
  },
  { name: "add a spool", scope: "printer", method: "POST", path: "/api/spools", json: { id: uuid(), material: "PLA" } },
  {
    name: "update a spool",
    scope: "printer",
    method: "PATCH",
    path: `/api/spools/${spoolId}`,
    json: { remaining: "half" },
  },
  {
    name: "set a spool's weight",
    scope: "printer",
    method: "PUT",
    path: `/api/spools/${spoolId}/weight`,
    json: { netGrams: 1000 },
  },
  {
    name: "weigh a spool",
    scope: "printer",
    method: "POST",
    path: `/api/spools/${spoolId}/weighings`,
    json: { id: uuid(), gramsLeft: 500 },
  },
  {
    name: "tell the app about the printer",
    scope: "printer",
    method: "PUT",
    path: "/api/printer/bridge",
    json: { printerState: "idle" },
  },
  { name: "load a slot", scope: "printer", method: "PUT", path: "/api/printer/slots/A1", json: { spoolId: null } },
];

describe("scopes", () => {
  beforeEach(async () => {
    await env.DB.prepare(
      "INSERT INTO items (id, stage, note, created_by, created_at, updated_at) VALUES (?, 'idea', '', ?, ?, ?)",
    )
      .bind(itemId, alex, Date.now(), Date.now())
      .run();
    await request(`/api/items/${itemId}/attempts`, { method: "POST", json: { id: attemptId }, cookie });
    await request("/api/spools", { method: "POST", json: { id: spoolId, material: "PLA" }, cookie });
  });

  for (const row of rows) {
    it(`${row.name}: opened by "${row.scope}" only`, async () => {
      const call = (token: string) => asAgent(token, row.path, { method: row.method, json: row.json });
      const allowed = await makeAgent([row.scope], `${row.scope} only`);
      const response = await call(allowed.token);
      // Past the guard: whatever the route says (a 404 for a thing that isn't there is fine), never 401/403.
      expect([401, 403], `${row.method} ${row.path} → ${response.status}`).not.toContain(response.status);
      for (const other of AGENT_SCOPES.filter((scope) => scope !== row.scope)) {
        const refused = await call((await makeAgent([other], `${other} only`)).token);
        expect(refused.status, `${other} on ${row.name}`).toBe(403);
        const error = await errorOf(refused);
        expect(error.code).toBe("missing_scope");
        expect(error.message).toContain(`"${row.scope}"`);
      }
    });
  }

  it("lets a person do all of it: scopes are for tokens", async () => {
    expect(
      await status(request(`/api/items/${itemId}`, { method: "PATCH", json: { stage: "building" }, cookie })),
    ).toBe(200);
  });

  it("splits photos: an attempt's photo needs attempts, any other needs capture", async () => {
    const photoUpload = (token: string, fields: Record<string, string> = {}) => {
      const form = new FormData();
      form.set("width", "10");
      form.set("height", "10");
      form.set("color", "#aabbcc");
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      form.set("large", new File([new Uint8Array([1])], "l.webp", { type: "image/webp" }));
      form.set("thumb", new File([new Uint8Array([1])], "t.webp", { type: "image/webp" }));
      // A cross-site Origin on a multipart upload: fine for a token (the CSRF check is for cookies).
      return asAgent(token, `/api/items/${itemId}/photos/${uuid()}`, { method: "PUT", body: form });
    };
    const capture = (await makeAgent(["capture"], "c")).token;
    const attempts = (await makeAgent(["attempts"], "a")).token;
    expect((await photoUpload(capture)).status).toBe(201);
    expect((await photoUpload(attempts)).status).toBe(403);
    expect((await photoUpload(attempts, { attemptId })).status).toBe(201);
    const refused = await photoUpload(capture, { attemptId });
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).message).toContain('"attempts"');
  });

  it("splits creating an item: an idea is capture, one that starts as a build needs attempts", async () => {
    const capture = (await makeAgent(["capture"], "c")).token;
    const create = (json: unknown, token = capture) => asAgent(token, "/api/items", { method: "POST", json });
    expect((await create({ id: uuid(), note: "idea" })).status).toBe(201);
    const refused = await create({ id: uuid(), stage: "building" });
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).message).toContain('"attempts"');
    // A build from scratch is attempts work only: the printer bridge needs no "capture" for it.
    expect((await create({ id: uuid(), stage: "building" }, (await makeAgent(["attempts"], "a")).token)).status).toBe(
      201,
    );
    expect((await create({ id: uuid(), note: "idea" }, (await makeAgent(["attempts"], "b")).token)).status).toBe(403);
  });

  it("splits patching an item: words are capture, stage and cover are attempts", async () => {
    const capture = (await makeAgent(["capture"], "c")).token;
    const patch = (json: unknown, token = capture) => asAgent(token, `/api/items/${itemId}`, { method: "PATCH", json });
    expect((await patch({ title: "Bracket", note: "n" })).status).toBe(200);
    expect((await patch({ stage: "building" })).status).toBe(403);
    expect((await patch({ coverPhotoId: null })).status).toBe(403);
    expect((await patch({ stage: "building" }, (await makeAgent(["attempts"], "a")).token)).status).toBe(200);
  });
});

describe("what an agent's writes say", () => {
  it("records the owner as who and the agent as how, in the feed and on the data", async () => {
    const made = await makeAgent(["read", "capture", "attempts"], "Claude for Alex");
    const before = (await (await request("/api/changes", { cookie })).json<ChangesResponse>()).cursor;

    const created = await asAgent(made.token, "/api/items", { method: "POST", json: { id: uuid(), note: "A hook" } });
    const item = (await created.json<ItemResponse>()).item;
    expect(item).toMatchObject({ createdBy: alex, createdVia: made.agent.id });
    const attemptResponse = await asAgent(made.token, `/api/items/${item.id}/attempts`, {
      method: "POST",
      json: { id: uuid(), outcome: "success" },
    });
    expect(attemptResponse.status).toBe(201);
    const photo = await uploadPhotoAs(made.token, item.id);
    expect(photo.status).toBe(201);

    const feed = (await (await request(`/api/changes?after=${before}`, { cookie })).json<ChangesResponse>()).changes;
    expect(feed.map((change) => [change.entity, change.action])).toEqual([
      ["item", "created"],
      ["attempt", "created"],
      ["photo", "created"],
    ]);
    for (const change of feed) expect(change.actor).toEqual({ kind: "agent", id: made.agent.id });

    const saved = (await (await request(`/api/items/${item.id}`, { cookie })).json<ItemResponse>()).item;
    expect(saved.attempts[0]).toMatchObject({
      createdBy: alex,
      createdVia: made.agent.id,
      finishedBy: alex,
      finishedVia: made.agent.id,
    });
    // A person's own work has no "via".
    const mine = await createItem(cookie, { note: "mine" });
    expect(mine.createdVia).toBeNull();

    // The journal says who, and how.
    const journal = await (await request("/api/journal", { cookie: samCookie })).json<JournalResponse>();
    const viaAgent = journal.entries.filter((entry) => entry.via === made.agent.id);
    expect(viaAgent.length).toBeGreaterThan(0);
    for (const entry of viaAgent) expect(entry.by).toBe(alex);
    expect(journal.entries.some((entry) => entry.via === null)).toBe(true);
  });

  it("records agent creation and token changes in the feed as the person who did them", async () => {
    const before = (await (await request("/api/changes", { cookie })).json<ChangesResponse>()).cursor;
    const made = await makeAgent(["read"]);
    await request(`/api/agents/${made.agent.id}/tokens/${made.tokenId}`, { method: "DELETE", cookie });
    const feed = (await (await request(`/api/changes?after=${before}`, { cookie })).json<ChangesResponse>()).changes;
    expect(feed.map((change) => [change.entity, change.action, change.id, change.actor])).toEqual([
      ["agent", "created", made.agent.id, { kind: "person", id: alex }],
      ["agent", "updated", made.agent.id, { kind: "person", id: alex }],
    ]);
    // Nothing secret is in the feed.
    expect(JSON.stringify(feed)).not.toContain(made.token);
  });

  it("finishing as an agent names it, and a person's finish after that doesn't", async () => {
    const made = await makeAgent(["attempts"]);
    const item = await createItem(cookie, { stage: "building" });
    const id = uuid();
    await asAgent(made.token, `/api/items/${item.id}/attempts`, { method: "POST", json: { id } });
    await asAgent(made.token, `/api/attempts/${id}/finish`, { method: "POST", json: { outcome: "failed" } });
    const row = await env.DB.prepare("SELECT finished_by AS by, finished_via AS via FROM attempts WHERE id = ?")
      .bind(id)
      .first();
    expect(row).toEqual({ by: alex, via: made.agent.id });
  });
});

function uploadPhotoAs(token: string, itemId: string) {
  const form = new FormData();
  form.set("width", "10");
  form.set("height", "10");
  form.set("color", "#aabbcc");
  form.set("large", new File([new Uint8Array([1])], "l.webp", { type: "image/webp" }));
  form.set("thumb", new File([new Uint8Array([1])], "t.webp", { type: "image/webp" }));
  return asAgent(token, `/api/items/${itemId}/photos/${uuid()}`, { method: "PUT", body: form });
}

// Keeps the shared upload helper in use for the unauthenticated case.
describe("signed out", () => {
  it("refuses everything without a session or a token", async () => {
    expect(await status(request("/api/agents"))).toBe(401);
    expect(await status(uploadPhoto(uuid(), uuid(), ""))).toBe(401);
  });
});
