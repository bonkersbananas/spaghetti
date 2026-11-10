import { beforeEach, describe, expect, it } from "vitest";
import type { DeletedResponse, Item, ItemResponse, ItemsResponse } from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

async function idea(title: string, ageMs = 60_000): Promise<Item> {
  const response = await request("/api/items", {
    method: "POST",
    cookie,
    json: { id: crypto.randomUUID(), title, createdAt: Date.now() - ageMs },
  });
  return (await response.json<ItemResponse>()).item;
}

async function start(item: Item): Promise<Item> {
  const response = await request(`/api/items/${item.id}`, { method: "PATCH", cookie, json: { stage: "building" } });
  return (await response.json<ItemResponse>()).item;
}

async function attempt(itemId: string) {
  const response = await request(`/api/items/${itemId}/attempts`, {
    method: "POST",
    cookie,
    json: { id: crypto.randomUUID(), outcome: null },
  });
  expect(response.status).toBe(201);
}

describe("scrapping a build", () => {
  it("sends a build that began as an idea back to Ideas, with its attempts deleted", async () => {
    const started = await start(await idea("Flexi hummingbird"));
    await attempt(started.id);

    const scrapped = await request(`/api/items/${started.id}/scrap`, { method: "POST", cookie });
    expect(scrapped.status).toBe(200);
    const { item } = await scrapped.json<ItemResponse>();
    expect(item).toMatchObject({ stage: "idea", startedAt: null, finishedAt: null, attempts: [] });

    const ideas = await (await request("/api/items?stage=idea", { cookie })).json<ItemsResponse>();
    expect(ideas.items.map((entry) => entry.id)).toContain(started.id);
  });

  it("refuses a build that never was an idea", async () => {
    const response = await request("/api/items", {
      method: "POST",
      cookie,
      json: { id: crypto.randomUUID(), title: "From scratch", stage: "building" },
    });
    const { item } = await response.json<ItemResponse>();
    const scrapped = await request(`/api/items/${item.id}/scrap`, { method: "POST", cookie });
    expect(scrapped.status).toBe(409);
  });

  it("undoes: the build and its attempts come back as they were", async () => {
    const started = await start(await idea("Flexi hummingbird"));
    await attempt(started.id);
    const before = (await (await request(`/api/items/${started.id}`, { cookie })).json<ItemResponse>()).item;

    await request(`/api/items/${started.id}/scrap`, { method: "POST", cookie });
    const undone = await request(`/api/items/${started.id}/unscrap`, {
      method: "POST",
      cookie,
      json: {
        stage: before.stage,
        startedAt: before.startedAt,
        finishedAt: before.finishedAt,
        coverPhotoId: before.coverPhotoId,
        attemptIds: before.attempts.map((entry) => entry.id),
      },
    });
    expect(undone.status).toBe(200);
    const { item } = await undone.json<ItemResponse>();
    expect(item.stage).toBe("building");
    expect(item.startedAt).toBe(before.startedAt);
    expect(item.attempts).toHaveLength(1);
  });
});

describe("unscrap of something that is not a scrapped idea", () => {
  it("is refused, and a deleted attempt it names stays deleted", async () => {
    const started = await start(await idea("Flexi hummingbird"));
    await attempt(started.id);
    const before = (await (await request(`/api/items/${started.id}`, { cookie })).json<ItemResponse>()).item;
    const deletedId = before.attempts[0]?.id as string;
    await request(`/api/attempts/${deletedId}`, { method: "DELETE", cookie });

    const undone = await request(`/api/items/${started.id}/unscrap`, {
      method: "POST",
      cookie,
      json: {
        stage: "building",
        startedAt: Date.now(),
        finishedAt: null,
        coverPhotoId: null,
        attemptIds: [deletedId],
      },
    });
    expect(undone.status).toBe(404);
    const after = (await (await request(`/api/items/${started.id}`, { cookie })).json<ItemResponse>()).item;
    expect(after.attempts).toHaveLength(0);
  });
});

describe("recently deleted", () => {
  it("lists deleted ideas, builds and attempts, but not empty ones or what is not deleted", async () => {
    const gone = await idea("Gone idea");
    await request(`/api/items/${gone.id}`, { method: "DELETE", cookie });
    const empty = await request("/api/items", {
      method: "POST",
      cookie,
      json: { id: crypto.randomUUID(), stage: "building" },
    });
    const { item: blank } = await empty.json<ItemResponse>();
    await request(`/api/items/${blank.id}`, { method: "DELETE", cookie });
    const kept = await start(await idea("Kept build"));
    await attempt(kept.id);
    const { item } = await (await request(`/api/items/${kept.id}`, { cookie })).json<ItemResponse>();
    const attemptId = item.attempts[0]?.id;
    await request(`/api/attempts/${attemptId}`, { method: "DELETE", cookie });

    const response = await request("/api/deleted", { cookie });
    expect(response.status).toBe(200);
    const body = await response.json<DeletedResponse>();
    expect(body.items.map((entry) => entry.id)).toEqual([gone.id]);
    expect(body.attempts.map((entry) => entry.id)).toEqual([attemptId]);
    expect(body.attempts[0]?.itemTitle).toBe("Kept build");
  });

  it("is for people: signed out is refused", async () => {
    expect((await request("/api/deleted")).status).toBe(401);
  });
});
