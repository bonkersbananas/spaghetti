import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ItemResponse, ItemsResponse } from "../../src/shared/api.ts";
import type { ChangesResponse } from "../../src/shared/changes.ts";
import type { CommentsResponse } from "../../src/shared/comments.ts";
import type { Reaction } from "../../src/shared/reactions.ts";
import { purgeDeleted } from "../../src/worker/photos.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let alexId: string;
let samId: string;
let alex: string;
let sam: string;

beforeEach(async () => {
  await resetDb();
  alexId = await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  samId = await addUser("sam", "battery staple", "Sam Okafor", "sea");
  alex = await signIn("alex", "correct horse");
  sam = await signIn("sam", "battery staple");
});

const uuid = () => crypto.randomUUID();

async function idea(as = alex) {
  const id = uuid();
  const response = await request("/api/items", { method: "POST", cookie: as, json: { id, title: "Tugboat" } });
  expect(response.status).toBe(201);
  return id;
}

async function comment(itemId: string, as = alex) {
  const id = uuid();
  const response = await request(`/api/items/${itemId}/comments`, {
    method: "POST",
    cookie: as,
    json: { id, body: "Blue PETG?" },
  });
  expect(response.status).toBe(201);
  return id;
}

async function react(path: string, on: boolean, as = alex) {
  const response = await request(path, { method: on ? "PUT" : "DELETE", cookie: as });
  return { status: response.status, body: response.ok ? await response.json<{ reactions: Reaction[] }>() : null };
}

const kinds = (list: Reaction[] | undefined) => (list ?? []).map((reaction) => [reaction.kind, reaction.userId]);

async function feed(after?: number) {
  const response = await request(`/api/changes${after === undefined ? "" : `?after=${after}`}`, { cookie: alex });
  return response.json<ChangesResponse>();
}

describe("reacting to an idea", () => {
  it("anyone gives a reaction once, their own idea too, and giving it again is harmless", async () => {
    const itemId = await idea();
    const own = await react(`/api/items/${itemId}/reactions/love`, true);
    expect(own.status).toBe(200);
    expect(kinds(own.body?.reactions)).toEqual([["love", alexId]]);
    await react(`/api/items/${itemId}/reactions/love`, true);
    const theirs = await react(`/api/items/${itemId}/reactions/love`, true, sam);
    await react(`/api/items/${itemId}/reactions/chef`, true, sam);
    expect(kinds(theirs.body?.reactions)).toEqual([
      ["love", alexId],
      ["love", samId],
    ]);

    const { item } = await (await request(`/api/items/${itemId}`, { cookie: alex })).json<ItemResponse>();
    expect(kinds(item.reactions)).toEqual([
      ["love", alexId],
      ["love", samId],
      ["chef", samId],
    ]);
    const { items } = await (await request("/api/items?stage=idea", { cookie: sam })).json<ItemsResponse>();
    expect(kinds(items.find((listed) => listed.id === itemId)?.reactions)).toHaveLength(3);
  });

  it("takes back only your own reaction", async () => {
    const itemId = await idea();
    await react(`/api/items/${itemId}/reactions/hot`, true);
    await react(`/api/items/${itemId}/reactions/hot`, true, sam);
    const back = await react(`/api/items/${itemId}/reactions/hot`, false, sam);
    expect(kinds(back.body?.reactions)).toEqual([["hot", alexId]]);
    // Taking back one that isn't there changes nothing.
    expect((await react(`/api/items/${itemId}/reactions/hot`, false, sam)).status).toBe(200);
  });

  it("refuses a reaction outside the set, and a deleted idea", async () => {
    const itemId = await idea();
    expect((await react(`/api/items/${itemId}/reactions/thumbsdown`, true)).status).toBe(400);
    await request(`/api/items/${itemId}`, { method: "DELETE", cookie: alex });
    expect((await react(`/api/items/${itemId}/reactions/love`, true)).status).toBe(404);
    expect((await react(`/api/items/${uuid()}/reactions/love`, true)).status).toBe(404);
  });

  it("records one item change per real change, none for repeats", async () => {
    const itemId = await idea();
    const start = (await feed()).cursor;
    await react(`/api/items/${itemId}/reactions/want`, true, sam);
    await react(`/api/items/${itemId}/reactions/want`, true, sam);
    await react(`/api/items/${itemId}/reactions/want`, false, sam);
    await react(`/api/items/${itemId}/reactions/want`, false, sam);
    const { changes } = await feed(start);
    expect(changes.map((change) => [change.entity, change.action, change.id, change.itemId, change.actor.id])).toEqual([
      ["item", "updated", itemId, itemId, samId],
      ["item", "updated", itemId, itemId, samId],
    ]);
  });

  it("is for people only, never an agent's token", async () => {
    const itemId = await idea();
    const made = await request("/api/agents", {
      method: "POST",
      json: { name: "Claude for Alex", scopes: ["read", "capture", "attempts"] },
      cookie: alex,
    });
    const { token } = await made.json<{ token: string }>();
    const response = await request(`/api/items/${itemId}/reactions/love`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, Origin: "http://other.test" },
    });
    expect(response.status).toBe(403);
  });
});

describe("reacting to a comment", () => {
  it("shows each comment's reactions in the thread, yours on your own comment too", async () => {
    const itemId = await idea();
    const first = await comment(itemId, sam);
    const second = await comment(itemId, alex);
    await react(`/api/comments/${first}/reactions/bravo`, true);
    await react(`/api/comments/${second}/reactions/melt`, true);
    await react(`/api/comments/${second}/reactions/melt`, true, sam);
    const thread = await (await request(`/api/items/${itemId}/comments`, { cookie: alex })).json<CommentsResponse>();
    expect(thread.comments.map((c) => kinds(c.reactions))).toEqual([
      [["bravo", alexId]],
      [
        ["melt", alexId],
        ["melt", samId],
      ],
    ]);
    // A comment's reactions aren't the idea's.
    const { item } = await (await request(`/api/items/${itemId}`, { cookie: alex })).json<ItemResponse>();
    expect(item.reactions).toEqual([]);
  });

  it("records a comment change, keeps reactions through an edit, and refuses a deleted comment", async () => {
    const itemId = await idea();
    const id = await comment(itemId, sam);
    const start = (await feed()).cursor;
    await react(`/api/comments/${id}/reactions/love`, true);
    const { changes } = await feed(start);
    expect(changes.map((change) => [change.entity, change.action, change.id, change.itemId])).toEqual([
      ["comment", "updated", id, itemId],
    ]);
    const edited = await request(`/api/comments/${id}`, { method: "PATCH", cookie: sam, json: { body: "Red?" } });
    expect(kinds((await edited.json<{ comment: { reactions: Reaction[] } }>()).comment.reactions)).toEqual([
      ["love", alexId],
    ]);
    await request(`/api/comments/${id}`, { method: "DELETE", cookie: sam });
    expect((await react(`/api/comments/${id}/reactions/hot`, true)).status).toBe(404);
  });

  it("go when what they belong to is purged", async () => {
    const itemId = await idea();
    const id = await comment(itemId);
    await react(`/api/items/${itemId}/reactions/love`, true);
    await react(`/api/comments/${id}/reactions/love`, true);
    await request(`/api/comments/${id}`, { method: "DELETE", cookie: alex });
    await purgeDeleted(env, Date.now() + 31 * 24 * 60 * 60 * 1000);
    const left = await env.DB.prepare("SELECT target_id FROM reactions").all<{ target_id: string }>();
    expect(left.results.map((row) => row.target_id)).toEqual([itemId]);
    await request(`/api/items/${itemId}`, { method: "DELETE", cookie: alex });
    await purgeDeleted(env, Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM reactions").first<{ n: number }>())?.n).toBe(0);
  });
});
