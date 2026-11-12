import { beforeEach, describe, expect, it } from "vitest";
import type { Item, ItemResponse, TwistResponse, TwistsResponse } from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

const uuid = () => crypto.randomUUID();

async function idea(note: string, title = "Gridfinity bin"): Promise<Item> {
  const response = await request("/api/items", { method: "POST", cookie, json: { id: uuid(), title, note } });
  expect(response.status).toBe(201);
  return (await response.json<ItemResponse>()).item;
}

const change = (kind: string, value: string, extra: Record<string, unknown> = {}) => ({
  id: uuid(),
  kind,
  value,
  ...extra,
});

describe("twists", () => {
  it("makes one from nothing but a name, and lists it", async () => {
    const id = uuid();
    const response = await request("/api/twists", { method: "POST", cookie, json: { id, name: "  42 mm bin " } });
    expect(response.status).toBe(201);
    const { twist } = await response.json<TwistResponse>();
    expect(twist).toMatchObject({ id, name: "42 mm bin", note: "", changes: [], fromItemId: null, recipeId: null });
    expect(twist.source).toEqual({ url: null, title: null, designer: null, license: null, place: null, photo: null });
    const list = await (await request("/api/twists", { cookie })).json<TwistsResponse>();
    expect(list.twists.map((entry) => entry.id)).toEqual([id]);
  });

  it("takes the idea's model link and title when made from it", async () => {
    const source = await idea("Print this https://makerworld.com/en/models/12345-gridfinity-base ok");
    const id = uuid();
    const response = await request("/api/twists", {
      method: "POST",
      cookie,
      json: { id, name: "42 mm bin", fromItemId: source.id },
    });
    const { twist } = await response.json<TwistResponse>();
    expect(twist.source.url).toContain("makerworld.com/en/models/12345");
    expect(twist.source.place).toBe("MakerWorld");
    expect(twist.source.title).toBe("Gridfinity bin");
    expect(twist.fromItemId).toBe(source.id);
  });

  it("lets the request's own source win, and refuses a link that isn't safe", async () => {
    const source = await idea("https://makerworld.com/en/models/1-a");
    const own = await request("/api/twists", {
      method: "POST",
      cookie,
      json: {
        id: uuid(),
        name: "Hook",
        fromItemId: source.id,
        sourceUrl: "https://www.printables.com/model/99-hook",
        designer: "Some Maker",
      },
    });
    const { twist } = await own.json<TwistResponse>();
    expect(twist.source).toMatchObject({ place: "Printables", designer: "Some Maker" });
    const unsafe = await request("/api/twists", {
      method: "POST",
      cookie,
      json: { id: uuid(), name: "Bad", sourceUrl: "http://localhost/x" },
    });
    expect(unsafe.status).toBe(400);
  });

  it("is idempotent on id, and 404s for an idea that isn't there", async () => {
    const id = uuid();
    const json = { id, name: "Bin" };
    expect((await request("/api/twists", { method: "POST", cookie, json })).status).toBe(201);
    expect((await request("/api/twists", { method: "POST", cookie, json })).status).toBe(201);
    const missing = await request("/api/twists", {
      method: "POST",
      cookie,
      json: { id: uuid(), name: "Bin", fromItemId: uuid() },
    });
    expect(missing.status).toBe(404);
  });

  it("keeps the changes in order and replaces the whole list on a patch", async () => {
    const id = uuid();
    const first = [change("scale", "84 %", { note: "fits 42 mm" }), change("tolerance", "+0.2 mm")];
    const made = await request("/api/twists", { method: "POST", cookie, json: { id, name: "Bin", changes: first } });
    expect((await made.json<TwistResponse>()).twist.changes.map((entry) => entry.value)).toEqual(["84 %", "+0.2 mm"]);
    const next = [change("text", "Marie"), first[0]];
    const patched = await request(`/api/twists/${id}`, { method: "PATCH", cookie, json: { changes: next } });
    const { twist } = await patched.json<TwistResponse>();
    expect(twist.changes.map((entry) => entry.value)).toEqual(["Marie", "84 %"]);
    expect(twist.changes[1]).toMatchObject({ kind: "scale", label: "", note: "fits 42 mm" });
  });

  it("refuses too many changes and unknown kinds", async () => {
    const many = Array.from({ length: 21 }, () => change("other", "x"));
    const tooMany = await request("/api/twists", {
      method: "POST",
      cookie,
      json: { id: uuid(), name: "A", changes: many },
    });
    expect(tooMany.status).toBe(400);
    const odd = await request("/api/twists", {
      method: "POST",
      cookie,
      json: { id: uuid(), name: "A", changes: [change("sparkle", "1")] },
    });
    expect(odd.status).toBe(400);
  });

  it("points at a recipe that exists, and clears it with null", async () => {
    const id = uuid();
    await request("/api/twists", { method: "POST", cookie, json: { id, name: "Bin" } });
    const missing = await request(`/api/twists/${id}`, { method: "PATCH", cookie, json: { recipeId: uuid() } });
    expect(missing.status).toBe(404);
    const cleared = await request(`/api/twists/${id}`, { method: "PATCH", cookie, json: { recipeId: null } });
    expect((await cleared.json<TwistResponse>()).twist.recipeId).toBeNull();
  });

  it("deletes softly and restores", async () => {
    const id = uuid();
    await request("/api/twists", { method: "POST", cookie, json: { id, name: "Bin" } });
    expect((await request(`/api/twists/${id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await request(`/api/twists/${id}`, { cookie })).status).toBe(404);
    expect((await (await request("/api/twists", { cookie })).json<TwistsResponse>()).twists).toEqual([]);
    expect((await request(`/api/twists/${id}/restore`, { method: "POST", cookie })).status).toBe(200);
    expect((await request(`/api/twists/${id}`, { cookie })).status).toBe(200);
  });
});
