import { beforeEach, describe, expect, it } from "vitest";
import type {
  AttemptResponse,
  FinishAttemptResponse,
  Item,
  ItemResponse,
  SearchResponse,
} from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

const uuid = () => crypto.randomUUID();

async function build(title = "Bath tugboat"): Promise<Item> {
  const response = await request("/api/items", {
    method: "POST",
    cookie,
    json: { id: uuid(), title, stage: "building" },
  });
  return (await response.json<ItemResponse>()).item;
}

async function putParts(itemId: string, parts: unknown[]) {
  return request(`/api/items/${itemId}/parts`, { method: "PUT", cookie, json: { parts } });
}

describe("PUT /api/items/:id/parts", () => {
  it("adds parts in order, and a build without parts has none", async () => {
    const item = await build();
    expect(item.parts).toEqual([]);
    const hull = uuid();
    const deck = uuid();
    const response = await putParts(item.id, [
      { id: hull, name: "  Hull   half ", quantity: 2 },
      { id: deck, name: "Deck", quantity: 1 },
    ]);
    expect(response.status).toBe(200);
    const { item: saved } = await response.json<ItemResponse>();
    expect(saved.parts.map((p) => [p.id, p.name, p.quantity, p.position])).toEqual([
      [hull, "Hull half", 2, 0],
      [deck, "Deck", 1, 1],
    ]);
    // The list comes back with the item everywhere.
    const read = await request(`/api/items/${item.id}`, { cookie });
    expect((await read.json<ItemResponse>()).item.parts).toHaveLength(2);
  });

  it("changes parts that exist and repeats harmlessly", async () => {
    const item = await build();
    const id = uuid();
    await putParts(item.id, [{ id, name: "Hull", quantity: 1 }]);
    await putParts(item.id, [{ id, name: "Hull half", quantity: 2 }]);
    const again = await putParts(item.id, [{ id, name: "Hull half", quantity: 2 }]);
    const { item: saved } = await again.json<ItemResponse>();
    expect(saved.parts).toHaveLength(1);
    expect(saved.parts[0]).toMatchObject({ name: "Hull half", quantity: 2, position: 0 });
  });

  it("refuses a nameless part, a zero quantity and another build's photo or part", async () => {
    const item = await build();
    const other = await build("Other");
    expect((await putParts(item.id, [{ id: uuid(), name: "  ", quantity: 1 }])).status).toBe(400);
    expect((await putParts(item.id, [{ id: uuid(), name: "A", quantity: 0 }])).status).toBe(400);
    expect((await putParts(item.id, [{ id: uuid(), name: "A", quantity: 1, photoId: uuid() }])).status).toBe(400);
    const id = uuid();
    await putParts(other.id, [{ id, name: "Theirs", quantity: 1 }]);
    await putParts(item.id, [{ id, name: "Mine now", quantity: 3 }]);
    const theirs = await request(`/api/items/${other.id}`, { cookie });
    expect((await theirs.json<ItemResponse>()).item.parts[0]?.name).toBe("Theirs");
    expect((await putParts(uuid(), [{ id: uuid(), name: "A", quantity: 1 }])).status).toBe(404);
  });

  it("removes a part, and the same call puts it back", async () => {
    const item = await build();
    const id = uuid();
    await putParts(item.id, [{ id, name: "Deck", quantity: 1 }]);
    const removed = await request(`/api/items/${item.id}/parts/${id}`, { method: "DELETE", cookie });
    expect(removed.status).toBe(204);
    expect((await request(`/api/items/${item.id}/parts/${id}`, { method: "DELETE", cookie })).status).toBe(404);
    expect(((await (await request(`/api/items/${item.id}`, { cookie })).json()) as ItemResponse).item.parts).toEqual(
      [],
    );
    await putParts(item.id, [{ id, name: "Deck", quantity: 1, position: 0 }]);
    expect(
      ((await (await request(`/api/items/${item.id}`, { cookie })).json()) as ItemResponse).item.parts,
    ).toHaveLength(1);
  });

  it("records a change for the item", async () => {
    const item = await build();
    const before = await request("/api/changes", { cookie });
    const { cursor } = await before.json<{ cursor: number }>();
    await putParts(item.id, [{ id: uuid(), name: "Deck", quantity: 1 }]);
    const after = await request(`/api/changes?after=${cursor}`, { cookie });
    const feed = await after.json<{ changes: Array<{ entity: string; itemId: string; action: string }> }>();
    expect(feed.changes).toContainEqual(
      expect.objectContaining({ entity: "item", itemId: item.id, action: "updated" }),
    );
  });
});

describe("attempts and parts", () => {
  async function logAttempt(itemId: string, body: Record<string, unknown>) {
    const response = await request(`/api/items/${itemId}/attempts`, {
      method: "POST",
      cookie,
      json: { id: uuid(), settings: {}, ...body },
    });
    expect(response.status).toBe(201);
    return (await response.json<AttemptResponse>()).attempt;
  }

  it("keeps the counts an attempt is logged with, and PATCH replaces them", async () => {
    const item = await build();
    const hull = uuid();
    await putParts(item.id, [{ id: hull, name: "Hull half", quantity: 2 }]);
    const attempt = await logAttempt(item.id, { outcome: "success", parts: [{ partId: hull, count: 2 }] });
    expect(attempt.parts).toEqual([{ partId: hull, count: 2 }]);
    const patched = await request(`/api/attempts/${attempt.id}`, {
      method: "PATCH",
      cookie,
      json: { parts: [{ partId: hull, count: 1 }] },
    });
    expect((await patched.json<AttemptResponse>()).attempt.parts).toEqual([{ partId: hull, count: 1 }]);
    const plain = await logAttempt(item.id, { outcome: "success" });
    expect(plain.parts).toEqual([]);
  });

  it("a spaghetti counts none unless counts are sent", async () => {
    const item = await build();
    const hull = uuid();
    await putParts(item.id, [{ id: hull, name: "Hull half", quantity: 2 }]);
    const printing = await logAttempt(item.id, { outcome: null, parts: [{ partId: hull, count: 2 }] });
    const failed = await request(`/api/attempts/${printing.id}`, {
      method: "PATCH",
      cookie,
      json: { outcome: "failed" },
    });
    expect((await failed.json<AttemptResponse>()).attempt.parts).toEqual([{ partId: hull, count: 0 }]);
    // The person says one came out.
    const some = await request(`/api/attempts/${printing.id}`, {
      method: "PATCH",
      cookie,
      json: { parts: [{ partId: hull, count: 1 }] },
    });
    expect((await some.json<AttemptResponse>()).attempt.parts).toEqual([{ partId: hull, count: 1 }]);
  });

  it("finishing keeps the plate's counts when it worked, zeroes them when it failed, and takes counts sent", async () => {
    const item = await build();
    const hull = uuid();
    await putParts(item.id, [{ id: hull, name: "Hull half", quantity: 2 }]);
    const worked = await logAttempt(item.id, { outcome: null, parts: [{ partId: hull, count: 2 }] });
    const finished = await request(`/api/attempts/${worked.id}/finish`, {
      method: "POST",
      cookie,
      json: { outcome: "success" },
    });
    expect((await finished.json<FinishAttemptResponse>()).attempt.parts).toEqual([{ partId: hull, count: 2 }]);

    const failed = await logAttempt(item.id, { outcome: null, parts: [{ partId: hull, count: 2 }] });
    const spaghetti = await request(`/api/attempts/${failed.id}/finish`, {
      method: "POST",
      cookie,
      json: { outcome: "failed" },
    });
    expect((await spaghetti.json<FinishAttemptResponse>()).attempt.parts).toEqual([{ partId: hull, count: 0 }]);

    const partly = await logAttempt(item.id, { outcome: null, parts: [{ partId: hull, count: 2 }] });
    const sent = await request(`/api/attempts/${partly.id}/finish`, {
      method: "POST",
      cookie,
      json: { outcome: "partial", parts: [{ partId: hull, count: 1 }] },
    });
    expect((await sent.json<FinishAttemptResponse>()).attempt.parts).toEqual([{ partId: hull, count: 1 }]);
  });
});

describe("parts in search and the story", () => {
  it("finds a build by a part's name, and follows renames and removals", async () => {
    const item = await build("Bath tugboat");
    const id = uuid();
    const find = async (q: string) =>
      (await (await request(`/api/search?q=${q}`, { cookie })).json<SearchResponse>()).builds.map((hit) => hit.item.id);
    expect(await find("rudder")).toEqual([]);
    await putParts(item.id, [{ id, name: "Rudder", quantity: 1 }]);
    expect(await find("rudder")).toEqual([item.id]);
    await putParts(item.id, [{ id, name: "Keel", quantity: 1 }]);
    expect(await find("rudder")).toEqual([]);
    expect(await find("keel")).toEqual([item.id]);
    await request(`/api/items/${item.id}/parts/${id}`, { method: "DELETE", cookie });
    expect(await find("keel")).toEqual([]);
  });

  it("keeps 'for whom' searchable beside the part names", async () => {
    const item = await build("Bath tugboat");
    await request(`/api/items/${item.id}`, { method: "PATCH", cookie, json: { forWhom: "Mila" } });
    await putParts(item.id, [{ id: uuid(), name: "Rudder", quantity: 1 }]);
    await request(`/api/items/${item.id}`, { method: "PATCH", cookie, json: { forWhom: "Noor" } });
    const hit = async (q: string) =>
      (await (await request(`/api/search?q=${q}`, { cookie })).json<SearchResponse>()).builds.length;
    expect(await hit("rudder")).toBe(1);
    expect(await hit("noor")).toBe(1);
    expect(await hit("mila")).toBe(0);
  });

  it("names the parts an attempt printed in search results and the story", async () => {
    const item = await build("Bath tugboat");
    const hull = uuid();
    const deck = uuid();
    await putParts(item.id, [
      { id: hull, name: "Hull half", quantity: 2 },
      { id: deck, name: "Deck", quantity: 1 },
    ]);
    await request(`/api/items/${item.id}/attempts`, {
      method: "POST",
      cookie,
      json: {
        id: uuid(),
        outcome: "success",
        note: "tight fit",
        settings: {},
        parts: [{ partId: hull, count: 1 }],
      },
    });
    const search = await (await request("/api/search?q=tight", { cookie })).json<SearchResponse>();
    expect(search.attempts[0]?.partsLabel).toBe("Hull half");
    const story = await (await request(`/api/builds/${item.id}/story.md`, { cookie })).text();
    expect(story).toContain("## Parts");
    expect(story).toContain(`- Hull half ×2: 1 of 2 (part_id: ${hull})`);
    expect(story).toContain(`- Deck ×1: 0 of 1`);
    expect(story).toContain("### Attempt 1 · Hull half: Worked");
  });

  it("has no Parts section for a simple build", async () => {
    const item = await build("Bath tugboat");
    const story = await (await request(`/api/builds/${item.id}/story.md`, { cookie })).text();
    expect(story).not.toContain("## Parts");
  });
});
