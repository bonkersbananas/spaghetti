import { beforeEach, describe, expect, it } from "vitest";
import type { AgentScope, NewTokenResponse } from "../../src/shared/agents.ts";
import type { ItemResponse, ItemsResponse } from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

const idea = async (note: string) => {
  const id = crypto.randomUUID();
  await request("/api/items", { method: "POST", json: { id, note }, cookie });
  return id;
};
const patch = (id: string, json: unknown, init: { cookie?: string; headers?: Record<string, string> } = { cookie }) =>
  request(`/api/items/${id}`, { method: "PATCH", json, ...init });
const queue = async () =>
  (await (await request("/api/items?stage=idea", { cookie })).json<ItemsResponse>()).items
    .filter((item) => item.upNext !== null)
    .sort((a, b) => (a.upNext ?? 0) - (b.upNext ?? 0))
    .map((item) => item.note);

describe("Up next", () => {
  it("queues ideas at the end, in the order they were marked, and takes them off", async () => {
    const [a, b, c] = [await idea("a"), await idea("b"), await idea("c")];
    await patch(c, { upNext: true });
    await patch(a, { upNext: true });
    await patch(b, { upNext: true });
    expect(await queue()).toEqual(["c", "a", "b"]);
    await patch(a, { upNext: false });
    expect(await queue()).toEqual(["c", "b"]);
    // Marking again puts it at the end, not back where it was.
    await patch(a, { upNext: true });
    expect(await queue()).toEqual(["c", "b", "a"]);
  });

  it("reorders: the ids given first, in that order, the queued ones left out after them", async () => {
    const [a, b, c] = [await idea("a"), await idea("b"), await idea("c")];
    for (const id of [a, b, c]) await patch(id, { upNext: true });
    const response = await request("/api/items/up-next/order", { method: "PUT", json: { ids: [c, a] }, cookie });
    expect(response.status).toBe(200);
    expect((await response.json<ItemsResponse>()).items.map((item) => item.note)).toEqual(["c", "a", "b"]);
    expect(await queue()).toEqual(["c", "a", "b"]);
    // An idea that isn't queued is ignored, and so is a repeat.
    const loose = await idea("loose");
    await request("/api/items/up-next/order", { method: "PUT", json: { ids: [loose, b, b] }, cookie });
    expect(await queue()).toEqual(["b", "c", "a"]);
  });

  it("starting a build takes the idea off the queue, and its undo can put it back in place", async () => {
    const [a, b, c] = [await idea("a"), await idea("b"), await idea("c")];
    for (const id of [a, b, c]) await patch(id, { upNext: true });
    const started = await (await patch(b, { stage: "building" })).json<ItemResponse>();
    expect(started.item.upNext).toBeNull();
    expect(await queue()).toEqual(["a", "c"]);
    // The undo sends the stage back with its old place.
    await patch(b, { stage: "idea", upNext: 2 });
    expect(await queue()).toEqual(["a", "b", "c"]);
  });

  it("a change that starts a build never leaves it queued, whatever upNext it carries", async () => {
    const id = await idea("a");
    await patch(id, { upNext: true });
    const started = await (await patch(id, { stage: "building", upNext: 1 })).json<ItemResponse>();
    expect(started.item).toMatchObject({ stage: "building", upNext: null });
    expect(await queue()).toEqual([]);
  });

  it("only ideas are queued", async () => {
    const build = crypto.randomUUID();
    await request("/api/items", { method: "POST", json: { id: build, stage: "building" }, cookie });
    const response = await patch(build, { upNext: true });
    expect((await response.json<ItemResponse>()).item.upNext).toBeNull();
  });

  it("keeps who it is for, trimmed, and finds the idea by it", async () => {
    const id = await idea("a bracket");
    await idea("a hook");
    const saved = await (await patch(id, { forWhom: "  Mila " })).json<ItemResponse>();
    expect(saved.item.forWhom).toBe("Mila");
    const found = await (await request("/api/search?q=Mila", { cookie })).json<{
      ideas: Array<{ item: { id: string } }>;
    }>();
    expect(found.ideas.map((hit) => hit.item.id)).toEqual([id]);
    expect((await (await patch(id, { forWhom: "" })).json<ItemResponse>()).item.forWhom).toBeNull();
    const gone = await (await request("/api/search?q=Mila", { cookie })).json<{ ideas: unknown[] }>();
    expect(gone.ideas).toHaveLength(0);
  });

  it("is capture work for a token: read-only tokens are refused", async () => {
    const id = await idea("a");
    const make = async (scopes: AgentScope[]) =>
      (
        await (
          await request("/api/agents", { method: "POST", json: { name: scopes.join(), scopes }, cookie })
        ).json<NewTokenResponse>()
      ).token;
    const as = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
    expect((await patch(id, { upNext: true }, as(await make(["read"])))).status).toBe(403);
    expect((await patch(id, { forWhom: "Mila" }, as(await make(["read"])))).status).toBe(403);
    expect((await patch(id, { upNext: true }, as(await make(["capture"])))).status).toBe(200);
    const order = (token: string) =>
      request("/api/items/up-next/order", { method: "PUT", json: { ids: [id] }, ...as(token) });
    expect((await order(await make(["read"]))).status).toBe(403);
    expect((await order(await make(["capture"]))).status).toBe(200);
  });
});
