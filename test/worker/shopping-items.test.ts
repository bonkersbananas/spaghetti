import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem, ShoppingItemResponse, ShoppingItemsResponse } from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;
let samCookie: string;

beforeEach(async () => {
  // Adding a link reads its page in the background (shopping-prices.test.ts): here no page answers.
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 404 }));
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  await addUser("sam", "battery staple", "Sam Okafor", "basil");
  cookie = await signIn("alex", "correct horse");
  samCookie = await signIn("sam", "battery staple");
});

afterEach(() => vi.restoreAllMocks());

const glue = "https://eu.store.bambulab.com/products/liquid-glue-for-build-plate";
const prisjakt = "https://www.prisjakt.nu/produkt.php?p=12345";

async function add(json: Record<string, unknown>, as = cookie): Promise<ShoppingItem> {
  const response = await request("/api/shopping-items", {
    method: "POST",
    cookie: as,
    json: { id: crypto.randomUUID(), ...json },
  });
  expect(response.status).toBe(201);
  return (await response.json<ShoppingItemResponse>()).shoppingItem;
}

async function list(): Promise<ShoppingItem[]> {
  return (await (await request("/api/shopping-items", { cookie })).json<ShoppingItemsResponse>()).shoppingItems;
}

const patch = async (id: string, json: unknown, as = cookie) =>
  request(`/api/shopping-items/${id}`, { method: "PATCH", cookie: as, json });

describe("/api/shopping-items", () => {
  it("needs a session", async () => {
    expect((await request("/api/shopping-items")).status).toBe(401);
  });

  it("starts empty", async () => {
    expect(await list()).toEqual([]);
  });

  it("needs a name or a link, and only web links", async () => {
    for (const json of [
      { id: crypto.randomUUID() },
      { id: crypto.randomUUID(), name: "  " },
      { id: crypto.randomUUID(), name: "Glue", link: "javascript:alert(1)" },
      { id: crypto.randomUUID(), name: "Glue", priceLink: "not a link" },
      { name: "No id" },
    ]) {
      const response = await request("/api/shopping-items", { method: "POST", cookie, json });
      expect(response.status, JSON.stringify(json)).toBe(400);
    }
  });

  it("adds with a name, a link or both, newest on top, and a retry changes nothing", async () => {
    const first = await add({ name: "PLA Basic, black ×2" });
    expect(first).toMatchObject({ name: "PLA Basic, black ×2", link: null, priceLink: null, boughtAt: null });
    const id = crypto.randomUUID();
    const second = await add({ id, link: glue, priceLink: prisjakt });
    expect(second).toMatchObject({ name: "", link: glue, priceLink: prisjakt });
    expect(second.position).toBeLessThan(first.position);
    expect(await add({ id, name: "Something else" })).toMatchObject({ name: "", link: glue });
    expect((await list()).map((item) => item.id)).toEqual([second.id, first.id]);
  });

  it("ticks things off and back on: bought ones go last, back on the list goes to the top", async () => {
    await add({ name: "A" });
    const b = await add({ name: "B" });
    await add({ name: "C" });
    // C, B, A
    const ticked = await patch(b.id, { bought: true }, samCookie);
    expect(ticked.status).toBe(200);
    const bought = (await ticked.json<ShoppingItemResponse>()).shoppingItem;
    expect(bought.boughtAt).toEqual(expect.any(Number));
    expect(bought.boughtBy).not.toBe(bought.createdBy);
    expect((await list()).map((item) => item.name)).toEqual(["C", "A", "B"]);

    // Ticking it again keeps who and when.
    const again = (await (await patch(b.id, { bought: true })).json<ShoppingItemResponse>()).shoppingItem;
    expect(again).toMatchObject({ boughtAt: bought.boughtAt, boughtBy: bought.boughtBy });

    const back = (await (await patch(b.id, { bought: false })).json<ShoppingItemResponse>()).shoppingItem;
    expect(back).toMatchObject({ boughtAt: null, boughtBy: null });
    expect((await list()).map((item) => item.name)).toEqual(["B", "C", "A"]);
  });

  it("renames and changes or clears links", async () => {
    const item = await add({ link: glue });
    const response = await patch(item.id, { name: "Liquid glue", priceLink: prisjakt });
    expect((await response.json<ShoppingItemResponse>()).shoppingItem).toMatchObject({
      name: "Liquid glue",
      link: glue,
      priceLink: prisjakt,
    });
    const cleared = await patch(item.id, { link: "", priceLink: null });
    expect((await cleared.json<ShoppingItemResponse>()).shoppingItem).toMatchObject({ link: null, priceLink: null });
    expect((await patch(item.id, { link: "ftp://example.com" })).status).toBe(400);
    expect((await patch(crypto.randomUUID(), { name: "Gone" })).status).toBe(404);
  });

  it("sorts what's still to buy: named things trade places, the rest stay put, unknown and bought ids are ignored", async () => {
    const a = await add({ name: "A" });
    const b = await add({ name: "B" });
    const c = await add({ name: "C" });
    const d = await add({ name: "D" });
    await patch(d.id, { bought: true });
    // C, B, A to buy; D bought.
    const response = await request("/api/shopping-items/order", {
      method: "PUT",
      cookie,
      json: { ids: [a.id, crypto.randomUUID(), d.id, c.id] },
    });
    expect(response.status).toBe(200);
    const sorted = (await response.json<ShoppingItemsResponse>()).shoppingItems;
    // A and C swap the places they held; B (not named) keeps its own; D is still bought, at the end.
    expect(sorted.map((item) => item.name)).toEqual(["A", "B", "C", "D"]);
    expect(sorted.find((item) => item.id === d.id)?.boughtAt).toEqual(expect.any(Number));
    expect((await list()).map((item) => item.id)).toEqual([a.id, b.id, c.id, d.id]);
  });

  it("keeps something added after the list was read where it was added", async () => {
    const a = await add({ name: "A" });
    const b = await add({ name: "B" });
    // Someone reorders the list they saw (B, A) while the other person adds E on top.
    const e = await add({ name: "E" });
    await request("/api/shopping-items/order", { method: "PUT", cookie, json: { ids: [a.id, b.id] } });
    expect((await list()).map((item) => item.id)).toEqual([e.id, a.id, b.id]);
  });

  it("sorts things that share a place (one restored after a delete)", async () => {
    const a = await add({ name: "A" });
    await request(`/api/shopping-items/${a.id}`, { method: "DELETE", cookie });
    const b = await add({ name: "B" });
    await request(`/api/shopping-items/${a.id}/restore`, { method: "POST", cookie });
    expect((await list()).map((item) => item.position)).toEqual([a.position, a.position]);
    for (const ids of [
      [b.id, a.id],
      [a.id, b.id],
    ]) {
      const response = await request("/api/shopping-items/order", { method: "PUT", cookie, json: { ids } });
      expect((await response.json<ShoppingItemsResponse>()).shoppingItems.map((item) => item.id)).toEqual(ids);
      expect((await list()).map((item) => item.id)).toEqual(ids);
    }
  });

  it("deletes with an undo that puts it back where it was", async () => {
    const a = await add({ name: "A" });
    const b = await add({ name: "B" });
    expect((await request(`/api/shopping-items/${a.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await list()).map((item) => item.id)).toEqual([b.id]);
    expect((await request(`/api/shopping-items/${a.id}`, { method: "DELETE", cookie })).status).toBe(404);
    // A deleted id can't be added again as new.
    const retry = await request("/api/shopping-items", { method: "POST", cookie, json: { id: a.id, name: "A" } });
    expect(retry.status).toBe(409);
    const restored = await request(`/api/shopping-items/${a.id}/restore`, { method: "POST", cookie });
    expect(restored.status).toBe(200);
    expect((await list()).map((item) => item.id)).toEqual([b.id, a.id]);
  });
});
