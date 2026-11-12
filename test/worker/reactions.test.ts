import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ItemResponse, ItemsResponse } from "../../src/shared/api.ts";
import type { ChangesResponse } from "../../src/shared/changes.ts";
import type { CommentsResponse } from "../../src/shared/comments.ts";
import type { EmojiUse, Reaction } from "../../src/shared/reactions.ts";
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

const enc = encodeURIComponent;
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
    const own = await react(`/api/items/${itemId}/reactions/${enc("❤️")}`, true);
    expect(own.status).toBe(200);
    expect(kinds(own.body?.reactions)).toEqual([["❤️", alexId]]);
    await react(`/api/items/${itemId}/reactions/${enc("❤️")}`, true);
    const theirs = await react(`/api/items/${itemId}/reactions/${enc("❤️")}`, true, sam);
    await react(`/api/items/${itemId}/reactions/${enc("🤌")}`, true, sam);
    expect(kinds(theirs.body?.reactions)).toEqual([
      ["❤️", alexId],
      ["❤️", samId],
    ]);

    const { item } = await (await request(`/api/items/${itemId}`, { cookie: alex })).json<ItemResponse>();
    expect(kinds(item.reactions)).toEqual([
      ["❤️", alexId],
      ["❤️", samId],
      ["🤌", samId],
    ]);
    const { items } = await (await request("/api/items?stage=idea", { cookie: sam })).json<ItemsResponse>();
    expect(kinds(items.find((listed) => listed.id === itemId)?.reactions)).toHaveLength(3);
  });

  it("takes back only your own reaction", async () => {
    const itemId = await idea();
    await react(`/api/items/${itemId}/reactions/${enc("🔥")}`, true);
    await react(`/api/items/${itemId}/reactions/${enc("🔥")}`, true, sam);
    const back = await react(`/api/items/${itemId}/reactions/${enc("🔥")}`, false, sam);
    expect(kinds(back.body?.reactions)).toEqual([["🔥", alexId]]);
    // Taking back one that isn't there changes nothing.
    expect((await react(`/api/items/${itemId}/reactions/${enc("🔥")}`, false, sam)).status).toBe(200);
  });

  it("refuses a reaction outside the set, and a deleted idea", async () => {
    const itemId = await idea();
    for (const bad of ["thumbsdown", "love", "ab", "👍👍", "👍a", "%20", enc("❤️❤️"), enc("🔥".repeat(30)), enc("❤")]) {
      expect((await react(`/api/items/${itemId}/reactions/${bad}`, true)).status).toBe(400);
    }
    // Skin tones, flags and ZWJ sequences are one emoji each.
    for (const good of ["👍🏽", "🇸🇪", "👩‍👩‍👧‍👦", "🏳️‍🌈"]) {
      expect((await react(`/api/items/${itemId}/reactions/${enc(good)}`, true)).status).toBe(200);
    }
    await request(`/api/items/${itemId}`, { method: "DELETE", cookie: alex });
    expect((await react(`/api/items/${itemId}/reactions/${enc("❤️")}`, true)).status).toBe(404);
    expect((await react(`/api/items/${uuid()}/reactions/${enc("❤️")}`, true)).status).toBe(404);
  });

  it("records one item change per real change, none for repeats", async () => {
    const itemId = await idea();
    const start = (await feed()).cursor;
    await react(`/api/items/${itemId}/reactions/${enc("🤩")}`, true, sam);
    await react(`/api/items/${itemId}/reactions/${enc("🤩")}`, true, sam);
    await react(`/api/items/${itemId}/reactions/${enc("🤩")}`, false, sam);
    await react(`/api/items/${itemId}/reactions/${enc("🤩")}`, false, sam);
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
    const response = await request(`/api/items/${itemId}/reactions/${enc("❤️")}`, {
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
    await react(`/api/comments/${first}/reactions/${enc("👏")}`, true);
    await react(`/api/comments/${second}/reactions/${enc("🫠")}`, true);
    await react(`/api/comments/${second}/reactions/${enc("🫠")}`, true, sam);
    const thread = await (await request(`/api/items/${itemId}/comments`, { cookie: alex })).json<CommentsResponse>();
    expect(thread.comments.map((c) => kinds(c.reactions))).toEqual([
      [["👏", alexId]],
      [
        ["🫠", alexId],
        ["🫠", samId],
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
    await react(`/api/comments/${id}/reactions/${enc("❤️")}`, true);
    const { changes } = await feed(start);
    expect(changes.map((change) => [change.entity, change.action, change.id, change.itemId])).toEqual([
      ["comment", "updated", id, itemId],
    ]);
    const edited = await request(`/api/comments/${id}`, { method: "PATCH", cookie: sam, json: { body: "Red?" } });
    expect(kinds((await edited.json<{ comment: { reactions: Reaction[] } }>()).comment.reactions)).toEqual([
      ["❤️", alexId],
    ]);
    await request(`/api/comments/${id}`, { method: "DELETE", cookie: sam });
    expect((await react(`/api/comments/${id}/reactions/${enc("🔥")}`, true)).status).toBe(404);
  });

  it("go when what they belong to is purged", async () => {
    const itemId = await idea();
    const id = await comment(itemId);
    await react(`/api/items/${itemId}/reactions/${enc("❤️")}`, true);
    await react(`/api/comments/${id}/reactions/${enc("❤️")}`, true);
    await request(`/api/comments/${id}`, { method: "DELETE", cookie: alex });
    await purgeDeleted(env, Date.now() + 31 * 24 * 60 * 60 * 1000);
    const left = await env.DB.prepare("SELECT target_id FROM reactions").all<{ target_id: string }>();
    expect(left.results.map((row) => row.target_id)).toEqual([itemId]);
    await request(`/api/items/${itemId}`, { method: "DELETE", cookie: alex });
    await purgeDeleted(env, Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM reactions").first<{ n: number }>())?.n).toBe(0);
  });

  it("tells which emoji are used most, and which you gave last", async () => {
    const itemId = await idea();
    const other = await idea();
    for (const [path, emoji, as] of [
      [itemId, "🔥", alex],
      [itemId, "🍝", alex],
      [other, "🔥", sam],
      [other, "🎉", sam],
    ] as const) {
      await react(`/api/items/${path}/reactions/${enc(emoji)}`, true, as);
    }
    const mine = await (await request("/api/reactions/used", { cookie: alex })).json<EmojiUse>();
    expect(mine.popular[0]).toBe("🔥");
    expect(mine.popular).toHaveLength(3);
    expect(mine.recent).toEqual(["🍝", "🔥"]);
  });
});
