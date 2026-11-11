import { beforeEach, describe, expect, it } from "vitest";
import type { ChangesResponse } from "../../src/shared/changes.ts";
import type { WishlistResponse, WishlistsResponse } from "../../src/shared/wishlist.ts";
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

async function idea(title = "Tugboat", as = alex) {
  const id = crypto.randomUUID();
  const response = await request("/api/items", { method: "POST", cookie: as, json: { id, title } });
  expect(response.status).toBe(201);
  return id;
}

const add = (itemId: string, as = alex, json: unknown = {}) =>
  request(`/api/wishlists/me/items/${itemId}`, { method: "PUT", cookie: as, json });
const remove = (itemId: string, as = alex) =>
  request(`/api/wishlists/me/items/${itemId}`, { method: "DELETE", cookie: as });
const order = (ids: string[], as = alex) =>
  request("/api/wishlists/me/order", { method: "PUT", cookie: as, json: { ids } });
const all = async (as = alex) => (await request("/api/wishlists", { cookie: as })).json<WishlistsResponse>();
const mine = async (as = alex) => (await all(as)).wishlists[0];
const ids = (list?: { entries: Array<{ itemId: string }> }) => list?.entries.map((entry) => entry.itemId);

describe("wishlists", () => {
  it("lists everyone's, yours first, shared by default", async () => {
    const tug = await idea("Tugboat");
    await add(tug, sam);
    const { wishlists } = await all(alex);
    expect(wishlists.map((list) => list.personId)).toEqual([alexId, samId]);
    expect(wishlists[0]).toEqual({ personId: alexId, private: false, entries: [] });
    expect(wishlists[1]?.private).toBe(false);
    expect(ids(wishlists[1])).toEqual([tug]);
  });

  it("adds to the end, once, and answers with the list", async () => {
    const [a, b] = [await idea("A"), await idea("B")];
    expect((await add(a)).status).toBe(200);
    const again = await add(a);
    expect(ids((await again.json<WishlistResponse>()).wishlist)).toEqual([a]);
    const response = await add(b);
    const { wishlist } = await response.json<WishlistResponse>();
    expect(wishlist.entries.map((entry) => [entry.itemId, entry.position])).toEqual([
      [a, 1],
      [b, 2],
    ]);
  });

  it("puts one back at its place, for the undo", async () => {
    const [a, b, c] = [await idea("A"), await idea("B"), await idea("C")];
    for (const id of [a, b, c]) await add(id);
    await remove(b);
    expect(ids(await mine())).toEqual([a, c]);
    await add(b, alex, { position: 2 });
    expect(ids(await mine())).toEqual([a, b, c]);
  });

  it("reorders: the ones given first, the rest after in their turn", async () => {
    const [a, b, c] = [await idea("A"), await idea("B"), await idea("C")];
    for (const id of [a, b, c]) await add(id);
    const response = await order([c, a]);
    expect(ids((await response.json<WishlistResponse>()).wishlist)).toEqual([c, a, b]);
    // Ids that aren't on the list are ignored.
    await order([crypto.randomUUID(), b]);
    expect(ids(await mine())).toEqual([b, c, a]);
  });

  it("only takes ideas, and hides one that became a build until that is undone, in its place", async () => {
    const [a, b, c] = [await idea("A"), await idea("B"), await idea("C")];
    for (const id of [a, b, c]) await add(id);
    await request(`/api/items/${b}`, { method: "PATCH", cookie: alex, json: { stage: "building" } });
    expect(ids(await mine())).toEqual([a, c]);
    expect((await add(b)).status).toBe(200); // already on it: nothing changes
    const build = await idea("Build");
    await request(`/api/items/${build}`, { method: "PATCH", cookie: alex, json: { stage: "building" } });
    expect((await add(build)).status).toBe(409);
    // Reordering what shows keeps the hidden one's slot.
    await order([c, a]);
    await request(`/api/items/${b}`, { method: "PATCH", cookie: alex, json: { stage: "idea" } });
    expect(ids(await mine())).toEqual([c, b, a]);
  });

  it("hides deleted ideas and brings them back when restored", async () => {
    const [a, b] = [await idea("A"), await idea("B")];
    await add(a);
    await add(b);
    await request(`/api/items/${a}`, { method: "DELETE", cookie: alex });
    expect(ids(await mine())).toEqual([b]);
    expect((await add(a)).status).toBe(404);
    await request(`/api/items/${a}/restore`, { method: "POST", cookie: alex });
    expect(ids(await mine())).toEqual([a, b]);
  });

  it("keeps a private list from the others, but not from its owner", async () => {
    const a = await idea();
    await add(a, sam);
    const response = await request("/api/wishlists/me", { method: "PATCH", cookie: sam, json: { private: true } });
    expect((await response.json<WishlistResponse>()).wishlist.private).toBe(true);
    expect((await all(alex)).wishlists[1]).toEqual({ personId: samId, private: true, entries: [] });
    expect(ids(await mine(sam))).toEqual([a]);
    await request("/api/wishlists/me", { method: "PATCH", cookie: sam, json: { private: false } });
    expect(ids((await all(alex)).wishlists[1])).toEqual([a]);
  });

  it("each person changes only their own", async () => {
    const a = await idea();
    await add(a, alex);
    await remove(a, sam);
    await order([a], sam);
    expect(ids(await mine(alex))).toEqual([a]);
    expect(ids(await mine(sam))).toEqual([]);
  });

  it("records each write in the feed with the owner and no idea", async () => {
    const start = await (await request("/api/changes", { cookie: alex })).json<ChangesResponse>();
    const a = await idea();
    await add(a);
    await add(a); // a retry records nothing
    await order([a]);
    await request("/api/wishlists/me", { method: "PATCH", cookie: alex, json: { private: true } });
    await remove(a);
    await remove(a); // nothing left to take off
    const feed = await (await request(`/api/changes?after=${start.cursor}`, { cookie: sam })).json<ChangesResponse>();
    const wish = feed.changes.filter((change) => change.entity === "wishlist");
    expect(wish.map((change) => [change.action, change.id, change.itemId])).toEqual([
      ["created", alexId, null],
      ["updated", alexId, null],
      ["updated", alexId, null],
      ["deleted", alexId, null],
    ]);
  });

  it("refuses bad bodies and a full list", async () => {
    const a = await idea();
    expect((await add(a, alex, { position: 0 })).status).toBe(400);
    expect((await request("/api/wishlists/me", { method: "PATCH", cookie: alex, json: {} })).status).toBe(400);
    const many = await Promise.all(Array.from({ length: 50 }, (_, index) => idea(`Idea ${index}`)));
    for (const id of many) await add(id);
    const full = await add(a);
    expect(full.status).toBe(409);
  });

  it("is read-only for agent tokens", async () => {
    const response = await request("/api/agents", {
      method: "POST",
      json: { name: "Claude for Alex", scopes: ["read", "capture"] },
      cookie: alex,
    });
    const { token } = await response.json<{ token: string }>();
    const asAgent = (path: string, init: RequestInit = {}) =>
      request(path, { ...init, headers: { Authorization: `Bearer ${token}`, Origin: "http://other.test" } });
    const a = await idea();
    expect((await asAgent("/api/wishlists")).status).toBe(200);
    expect((await asAgent(`/api/wishlists/me/items/${a}`, { method: "PUT" })).status).toBe(403);
  });
});
