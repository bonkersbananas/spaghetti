import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentScope } from "../../src/shared/agents.ts";
import { toBase64Url } from "../../src/shared/base64url.ts";
import type { ChangesResponse } from "../../src/shared/changes.ts";
import type { Comment, CommentsResponse, UnreadCommentsResponse } from "../../src/shared/comments.ts";
import { purgeDeleted } from "../../src/worker/photos.ts";
import { sendCommentPush } from "../../src/worker/push/comments.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let alexId: string;
let samId: string;
let alex: string;
let sam: string;
let pushes: Array<{ url: string }>;

beforeEach(async () => {
  await resetDb();
  alexId = await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  samId = await addUser("sam", "battery staple", "Sam Okafor", "sea");
  alex = await signIn("alex", "correct horse");
  sam = await signIn("sam", "battery staple");
  pushes = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://push.example/")) return real(input, init);
    pushes.push({ url });
    return new Response(null, { status: 201 });
  });
});
afterEach(() => vi.restoreAllMocks());

const uuid = () => crypto.randomUUID();

async function item(stage: "idea" | "building" = "idea", title = "Tugboat", as = alex) {
  const id = uuid();
  const response = await request("/api/items", { method: "POST", cookie: as, json: { id, title, stage } });
  expect(response.status).toBe(201);
  return id;
}

async function say(itemId: string, body: string, as = alex, id = uuid()) {
  const response = await request(`/api/items/${itemId}/comments`, { method: "POST", cookie: as, json: { id, body } });
  return { response, id };
}

const thread = async (itemId: string, as = alex) =>
  (await request(`/api/items/${itemId}/comments`, { cookie: as })).json<CommentsResponse>();
const unread = async (as: string) =>
  (await request("/api/comments/unread", { cookie: as })).json<UnreadCommentsResponse>();

describe("writing in a thread", () => {
  it("saves a comment with its author, oldest first, and a retry returns the same one", async () => {
    const itemId = await item();
    const first = await say(itemId, "  Could you print this in the blue PETG?  ", sam);
    expect(first.response.status).toBe(201);
    await say(itemId, "Yes, tonight.", alex);
    const retry = await say(itemId, "Could you print this in the blue PETG?", sam, first.id);
    expect(retry.response.status).toBe(201);

    const { comments } = await thread(itemId);
    expect(comments.map((c) => [c.authorId, c.body, c.editedAt])).toEqual([
      [samId, "Could you print this in the blue PETG?", null],
      [alexId, "Yes, tonight.", null],
    ]);
  });

  it("refuses empty, too long, and missing items", async () => {
    const itemId = await item();
    expect((await say(itemId, "   ")).response.status).toBe(400);
    expect((await say(itemId, "x".repeat(2001))).response.status).toBe(400);
    expect((await say(uuid(), "hi")).response.status).toBe(404);
    expect((await request(`/api/items/${uuid()}/comments`, { cookie: alex })).status).toBe(404);
  });

  it("records the change in the feed, for the item", async () => {
    const itemId = await item();
    const before = (await (await request("/api/changes", { cookie: alex })).json<ChangesResponse>()).cursor;
    const { id } = await say(itemId, "Hello", sam);
    const feed = await (await request(`/api/changes?after=${before}`, { cookie: alex })).json<ChangesResponse>();
    expect(feed.changes).toEqual([
      expect.objectContaining({
        entity: "comment",
        id,
        itemId,
        action: "created",
        actor: { kind: "person", id: samId },
      }),
    ]);
  });
});

describe("editing and deleting", () => {
  it("lets you edit your own comment, shown as edited, and not the other person's", async () => {
    const itemId = await item();
    const { id } = await say(itemId, "Frist", alex);
    const edit = (as: string, body: string) =>
      request(`/api/comments/${id}`, { method: "PATCH", cookie: as, json: { body } });
    expect((await edit(sam, "Hijack")).status).toBe(403);
    const response = await edit(alex, "First");
    expect(response.status).toBe(200);
    const { comment } = await response.json<{ comment: Comment }>();
    expect(comment.body).toBe("First");
    expect(comment.editedAt).toBeGreaterThan(0);
    // The same text again isn't an edit.
    const again = await (await edit(alex, "First")).json<{ comment: Comment }>();
    expect(again.comment.editedAt).toBe(comment.editedAt);
    expect((await edit(alex, " ")).status).toBe(400);
  });

  it("deletes softly, restores it, and only for the author", async () => {
    const itemId = await item();
    const { id } = await say(itemId, "Oops", alex);
    expect((await request(`/api/comments/${id}`, { method: "DELETE", cookie: sam })).status).toBe(403);
    expect((await request(`/api/comments/${id}`, { method: "DELETE", cookie: alex })).status).toBe(204);
    expect((await thread(itemId)).comments).toEqual([]);
    expect((await request(`/api/comments/${id}`, { method: "DELETE", cookie: alex })).status).toBe(404);
    expect((await request(`/api/comments/${id}/restore`, { method: "POST", cookie: sam })).status).toBe(403);
    expect((await request(`/api/comments/${id}/restore`, { method: "POST", cookie: alex })).status).toBe(200);
    expect((await thread(itemId)).comments.map((c) => c.body)).toEqual(["Oops"]);
    const row = await env.DB.prepare("SELECT deleted_at FROM comments WHERE id = ?").bind(id).first();
    expect(row?.deleted_at).toBeNull();
  });

  it("purges comments deleted more than 30 days ago, and with their item", async () => {
    const itemId = await item();
    const { id } = await say(itemId, "Old", alex);
    await request(`/api/comments/${id}`, { method: "DELETE", cookie: alex });
    await purgeDeleted(env, Date.now() + 10 * 24 * 3600_000);
    expect((await env.DB.prepare("SELECT id FROM comments").all()).results).toHaveLength(1);
    await purgeDeleted(env, Date.now() + 31 * 24 * 3600_000);
    expect((await env.DB.prepare("SELECT id FROM comments").all()).results).toHaveLength(0);

    const other = await item();
    await say(other, "Goes with it", sam);
    await request(`/api/items/${other}`, { method: "DELETE", cookie: alex });
    await purgeDeleted(env, Date.now() + 31 * 24 * 3600_000);
    expect((await env.DB.prepare("SELECT id FROM comments").all()).results).toHaveLength(0);
  });
});

describe("read state", () => {
  it("is per person: the other person's comments are unread until you read, yours never are", async () => {
    const itemId = await item();
    await say(itemId, "From Sam", sam);
    expect((await unread(alex)).threads).toEqual([expect.objectContaining({ itemId, count: 1 })]);
    expect((await unread(sam)).threads).toEqual([]);
    expect((await thread(itemId, alex)).readAt).toBeNull();

    const read = await request(`/api/items/${itemId}/comments/read`, { method: "POST", cookie: alex });
    expect(read.status).toBe(200);
    expect((await unread(alex)).threads).toEqual([]);
    expect((await thread(itemId, alex)).readAt).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await say(itemId, "Another from Sam", sam);
    expect((await unread(alex)).threads).toEqual([expect.objectContaining({ itemId, count: 1 })]);
  });

  it("counts writing as having read the thread, and ignores deleted comments and deleted items", async () => {
    const itemId = await item();
    await say(itemId, "Question", sam);
    await say(itemId, "Answer", alex);
    expect((await unread(alex)).threads).toEqual([]);

    const second = await item();
    const { id } = await say(second, "Gone", sam);
    expect((await unread(alex)).threads).toHaveLength(1);
    await request(`/api/comments/${id}`, { method: "DELETE", cookie: sam });
    expect((await unread(alex)).threads).toEqual([]);
    await request(`/api/comments/${id}/restore`, { method: "POST", cookie: sam });
    await request(`/api/items/${second}`, { method: "DELETE", cookie: alex });
    expect((await unread(alex)).threads).toEqual([]);
  });
});

describe("agents", () => {
  async function agent(scopes: AgentScope[]) {
    const response = await request("/api/agents", {
      method: "POST",
      json: { name: "Claude for Alex", scopes },
      cookie: alex,
    });
    return (await response.json<{ token: string }>()).token;
  }
  const asAgent = (token: string, path: string, init: RequestInit & { json?: unknown } = {}) =>
    request(path, { ...init, headers: { Authorization: `Bearer ${token}`, Origin: "http://other.test" } });

  it("writes and edits its own comments for its owner, and can't delete", async () => {
    const itemId = await item();
    const token = await agent(["read", "capture"]);
    const id = uuid();
    const made = await asAgent(token, `/api/items/${itemId}/comments`, {
      method: "POST",
      json: { id, body: "Printed it" },
    });
    expect(made.status).toBe(201);
    const { comment } = await made.json<{ comment: Comment }>();
    expect(comment).toMatchObject({ authorId: alexId, via: expect.any(String) });
    const edit = await asAgent(token, `/api/comments/${id}`, { method: "PATCH", json: { body: "Printed it twice" } });
    expect(edit.status).toBe(200);
    expect((await asAgent(token, `/api/comments/${id}`, { method: "DELETE" })).status).toBe(403);
    const feed = await (await request("/api/changes?after=0", { cookie: sam })).json<ChangesResponse>();
    expect(feed.changes.find((c) => c.entity === "comment")?.actor.kind).toBe("agent");
    // An agent's comment doesn't count as Alex reading: Sam sees it as new, and Alex's own read state is untouched.
    expect((await unread(sam)).threads).toHaveLength(1);
    // A person can still edit what their agent wrote for them.
    expect(
      (await request(`/api/comments/${id}`, { method: "PATCH", cookie: alex, json: { body: "Fixed" } })).status,
    ).toBe(200);
  });

  it("needs the capture or attempts scope to write, and read to read the thread", async () => {
    const itemId = await item();
    const readOnly = await agent(["read"]);
    expect(
      (await asAgent(readOnly, `/api/items/${itemId}/comments`, { method: "POST", json: { id: uuid(), body: "x" } }))
        .status,
    ).toBe(403);
    expect((await asAgent(readOnly, `/api/items/${itemId}/comments`)).status).toBe(200);
    expect((await asAgent(readOnly, "/api/comments/unread")).status).toBe(403);
    expect((await asAgent(readOnly, `/api/items/${itemId}/comments/read`, { method: "POST" })).status).toBe(403);
    const printer = await agent(["printer"]);
    expect(
      (await asAgent(printer, `/api/items/${itemId}/comments`, { method: "POST", json: { id: uuid(), body: "x" } }))
        .status,
    ).toBe(403);
  });
});

describe("the story", () => {
  it("includes the thread", async () => {
    const itemId = await item("building");
    await say(itemId, "Could you use the blue PETG?", sam);
    await say(itemId, "Started it tonight", alex);
    const markdown = await (await request(`/api/builds/${itemId}/story.md`, { cookie: alex })).text();
    expect(markdown).toContain("## Comments");
    expect(markdown).toMatch(/\*\*Sam Okafor\*\* \(.*\): Could you use the blue PETG\?/);
    expect(markdown).toMatch(/\*\*Alex Rivera\*\* \(.*\): Started it tonight/);
  });
});

describe("the push", () => {
  async function subscribe(cookie: string, name: string, timeZone = "UTC") {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const keys = {
      p256dh: toBase64Url(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)),
      auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    };
    const response = await request("/api/push/subscription", {
      method: "PUT",
      cookie,
      json: { endpoint: `https://push.example/${name}`, keys, timeZone },
    });
    expect(response.status).toBe(204);
  }
  // A fixed clock, so what these tests say about "noon" and "night" doesn't depend on when CI runs: comments are
  // written at the faked instant, and sendCommentPush is given times within the hour after them.
  const AFTERNOON = Date.UTC(2026, 2, 10, 12, 30);
  const LATE_EVENING = Date.UTC(2026, 2, 10, 22, 30);
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AFTERNOON);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  /** 12:00 UTC on the faked day: awake hours, half an hour before the comments of the afternoon. */
  const noon = () => Date.UTC(2026, 2, 10, 12, 0);

  it("tells the other person once for a burst, and nobody for the author's own devices", async () => {
    await subscribe(alex, "alex-phone");
    await subscribe(sam, "sam-phone");
    const itemId = await item();
    await say(itemId, "One", sam);
    await say(itemId, "Two", sam);
    await say(itemId, "Three", sam);
    expect(await sendCommentPush(env, itemId, samId, noon())).toEqual({ sent: 1 });
    expect(pushes.map((p) => p.url)).toEqual(["https://push.example/alex-phone"]);
    expect(await sendCommentPush(env, itemId, samId, noon())).toEqual({ sent: 0 });
    expect(pushes).toHaveLength(1);
  });

  it("stays quiet at night, and the comments aren't pushed in the morning either", async () => {
    await subscribe(alex, "alex-phone");
    const itemId = await item();
    // Written at 22:30 UTC: 23:00 is within the hour after it, so the comment is claimed in the quiet hours.
    vi.setSystemTime(LATE_EVENING);
    await say(itemId, "Late", sam);
    const night = Date.UTC(2026, 2, 10, 23, 0);
    expect(await sendCommentPush(env, itemId, samId, night)).toEqual({ sent: 0 });
    expect(await sendCommentPush(env, itemId, samId, noon())).toEqual({ sent: 0 });
    expect(pushes).toEqual([]);
  });

  it("doesn't push a deleted comment", async () => {
    await subscribe(alex, "alex-phone");
    const itemId = await item();
    const { id } = await say(itemId, "Never mind", sam);
    await request(`/api/comments/${id}`, { method: "DELETE", cookie: sam });
    expect(await sendCommentPush(env, itemId, samId, noon())).toEqual({ sent: 0 });
    expect(pushes).toEqual([]);
  });
});

describe("the unread list names the newest comment, for Today's line", () => {
  it("carries its author, the start of its text and the thread's title and stage", async () => {
    const itemId = await item("building", "Tugboat");
    await say(itemId, "First thought", sam);
    const { id } = await say(itemId, "Started it tonight", sam);
    const { threads } = await unread(alex);
    expect(threads).toEqual([
      expect.objectContaining({
        itemId,
        count: 2,
        latestId: id,
        latestAuthorId: samId,
        latestBody: "Started it tonight",
        title: "Tugboat",
        stage: "building",
      }),
    ]);
  });
});
