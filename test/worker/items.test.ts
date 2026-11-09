import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Item, ItemResponse, ItemsResponse, PhotoResponse } from "../../src/shared/api.ts";
import { PURGE_AFTER_MS, purgeDeleted } from "../../src/worker/photos.ts";
import { addUser, request, resetDb, signIn, uploadPhoto } from "./helpers.ts";

let cookie: string;
let alexId: string;

beforeEach(async () => {
  await resetDb();
  alexId = await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

async function createItem(body: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const response = await request("/api/items", { method: "POST", cookie, json: { id, ...body } });
  expect(response.status).toBe(201);
  return (await response.json<ItemResponse>()).item;
}

async function list(): Promise<Item[]> {
  return (await (await request("/api/items?stage=idea", { cookie })).json<ItemsResponse>()).items;
}

describe("signed out", () => {
  it("refuses every items and photos route", async () => {
    const id = crypto.randomUUID();
    const calls: Array<[string, string]> = [
      ["GET", "/api/items"],
      ["POST", "/api/items"],
      ["GET", `/api/items/${id}`],
      ["PATCH", `/api/items/${id}`],
      ["DELETE", `/api/items/${id}`],
      ["POST", `/api/items/${id}/restore`],
      ["PUT", `/api/items/${id}/photos/${id}`],
      ["PUT", `/api/items/${id}/photos/order`],
      ["GET", `/api/photos/${id}/large`],
      ["DELETE", `/api/photos/${id}`],
      ["POST", `/api/photos/${id}/restore`],
    ];
    for (const [method, path] of calls) {
      const response = await request(path, { method, json: method === "GET" ? undefined : {} });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it("doesn't serve a stored photo without a session", async () => {
    const item = await createItem();
    const photoId = crypto.randomUUID();
    await uploadPhoto(item.id, photoId, cookie);
    expect((await request(`/api/photos/${photoId}/thumb`)).status).toBe(401);
  });
});

describe("items", () => {
  it("creates an idea with only a note, recording who captured it", async () => {
    const item = await createItem({ note: "A hook for the AMS" });
    expect(item).toMatchObject({
      stage: "idea",
      title: null,
      note: "A hook for the AMS",
      createdBy: alexId,
      photos: [],
    });
  });

  it("is idempotent: a retried capture gets the same idea back", async () => {
    const id = crypto.randomUUID();
    const first = await request("/api/items", { method: "POST", cookie, json: { id, note: "once" } });
    const again = await request("/api/items", { method: "POST", cookie, json: { id, note: "twice" } });
    expect(again.status).toBe(201);
    expect((await again.json<ItemResponse>()).item.note).toBe("once");
    expect((await first.json<ItemResponse>()).item.id).toBe(id);
    expect(await list()).toHaveLength(1);
  });

  it("keeps an offline capture's time but never takes one from the future", async () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    expect((await createItem({ createdAt: yesterday })).createdAt).toBe(yesterday);
    expect((await createItem({ createdAt: Date.now() + 1e9 })).createdAt).toBeLessThanOrEqual(Date.now());
  });

  it("rejects ids that aren't UUIDs and overlong text", async () => {
    const bad = await request("/api/items", { method: "POST", cookie, json: { id: "../etc" } });
    expect(bad.status).toBe(400);
    const long = await request("/api/items", {
      method: "POST",
      cookie,
      json: { id: crypto.randomUUID(), title: "x".repeat(201) },
    });
    expect(long.status).toBe(400);
  });

  it("lists newest first", async () => {
    const older = await createItem({ note: "older", createdAt: Date.now() - 60_000 });
    const newer = await createItem({ note: "newer" });
    expect((await list()).map((item) => item.id)).toEqual([newer.id, older.id]);
  });

  it("updates the title and note; a blank title becomes null", async () => {
    const item = await createItem({ note: "draft" });
    const response = await request(`/api/items/${item.id}`, {
      method: "PATCH",
      cookie,
      json: { title: "  Filament dryer box ", note: "With a hygrometer window" },
    });
    expect(response.status).toBe(200);
    const updated = (await response.json<ItemResponse>()).item;
    expect(updated).toMatchObject({ title: "Filament dryer box", note: "With a hygrometer window" });
    expect(updated.updatedAt).toBeGreaterThanOrEqual(item.updatedAt);

    const cleared = await request(`/api/items/${item.id}`, { method: "PATCH", cookie, json: { title: "   " } });
    expect((await cleared.json<ItemResponse>()).item.title).toBeNull();
  });

  it("deletes at once and restores with undo", async () => {
    const item = await createItem({ note: "keep me" });
    const photoId = crypto.randomUUID();
    await uploadPhoto(item.id, photoId, cookie);

    expect((await request(`/api/items/${item.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await list()).toEqual([]);
    expect((await request(`/api/items/${item.id}`, { cookie })).status).toBe(404);
    expect((await request(`/api/items/${item.id}`, { method: "PATCH", cookie, json: { note: "x" } })).status).toBe(404);
    // A retried capture of a deleted idea doesn't bring it back.
    const retry = await request("/api/items", { method: "POST", cookie, json: { id: item.id } });
    expect(retry.status).toBe(409);

    const restored = await request(`/api/items/${item.id}/restore`, { method: "POST", cookie });
    expect(restored.status).toBe(200);
    const back = (await restored.json<ItemResponse>()).item;
    expect(back.note).toBe("keep me");
    expect(back.photos.map((photo) => photo.id)).toEqual([photoId]);
    expect(await list()).toHaveLength(1);
  });

  it("is 404 for an unknown idea", async () => {
    const id = crypto.randomUUID();
    expect((await request(`/api/items/${id}`, { cookie })).status).toBe(404);
    expect((await request(`/api/items/${id}`, { method: "DELETE", cookie })).status).toBe(404);
    expect((await request(`/api/items/${id}/restore`, { method: "POST", cookie })).status).toBe(404);
  });
});

describe("photos", () => {
  it("stores both variants in R2 and serves them with immutable caching", async () => {
    const item = await createItem();
    const photoId = crypto.randomUUID();
    const takenAt = Date.UTC(2026, 9, 1, 12);
    const response = await uploadPhoto(item.id, photoId, cookie, { takenAt: String(takenAt) });
    expect(response.status).toBe(201);
    const { photo } = await response.json<PhotoResponse>();
    expect(photo).toMatchObject({ id: photoId, itemId: item.id, width: 2048, height: 1536, color: "#a08060", takenAt });

    const stored = await env.PHOTOS.get(`photos/${photoId}/large`);
    expect(new Uint8Array(await (stored?.arrayBuffer() ?? new ArrayBuffer(0)))).toEqual(new Uint8Array([1, 2, 3, 4]));

    const thumb = await request(`/api/photos/${photoId}/thumb`, { cookie });
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("Content-Type")).toBe("image/webp");
    expect(thumb.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(new Uint8Array(await thumb.arrayBuffer())).toEqual(new Uint8Array([5, 6]));

    const etag = thumb.headers.get("ETag") ?? "";
    const again = await request(`/api/photos/${photoId}/thumb`, { cookie, headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);

    expect((await request(`/api/photos/${photoId}/huge`, { cookie })).status).toBe(404);
    expect((await request(`/api/photos/${crypto.randomUUID()}/large`, { cookie })).status).toBe(404);
  });

  it("appends photos in order and is idempotent on retry", async () => {
    const item = await createItem();
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    await uploadPhoto(item.id, a, cookie);
    await uploadPhoto(item.id, b, cookie);
    const retry = await uploadPhoto(item.id, a, cookie);
    expect(retry.status).toBe(200);
    const [listed] = await list();
    expect(listed?.photos.map((photo) => [photo.id, photo.position])).toEqual([
      [a, 0],
      [b, 1],
    ]);
  });

  it("brings a deleted photo back when it is uploaded again", async () => {
    const item = await createItem();
    const photoId = crypto.randomUUID();
    await uploadPhoto(item.id, photoId, cookie);
    await request(`/api/photos/${photoId}`, { method: "DELETE", cookie });
    expect((await list())[0]?.photos).toEqual([]);
    expect((await uploadPhoto(item.id, photoId, cookie)).status).toBe(200);
    expect((await list())[0]?.photos.map((p) => p.id)).toEqual([photoId]);
  });

  it("refuses other formats, bad fields and photos for missing ideas", async () => {
    const item = await createItem();
    const photoId = crypto.randomUUID();
    expect((await uploadPhoto(item.id, photoId, cookie, {}, "image/heic")).status).toBe(415);
    expect((await uploadPhoto(item.id, photoId, cookie, { color: "tomato" })).status).toBe(400);
    expect((await uploadPhoto(crypto.randomUUID(), photoId, cookie)).status).toBe(404);
    expect((await uploadPhoto(item.id, "nope", cookie)).status).toBe(400);
  });

  it("reorders, removes and restores photos", async () => {
    const item = await createItem();
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const id of ids) await uploadPhoto(item.id, id, cookie);

    const reordered = await request(`/api/items/${item.id}/photos/order`, {
      method: "PUT",
      cookie,
      json: { photoIds: [ids[2], ids[0]] },
    });
    expect(reordered.status).toBe(200);
    // The one left out keeps its place at the end.
    expect((await reordered.json<ItemResponse>()).item.photos.map((p) => p.id)).toEqual([ids[2], ids[0], ids[1]]);

    expect((await request(`/api/photos/${ids[0]}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await list())[0]?.photos.map((p) => p.id)).toEqual([ids[2], ids[1]]);
    // Still served while it can be restored.
    expect((await request(`/api/photos/${ids[0]}/large`, { cookie })).status).toBe(200);

    expect((await request(`/api/photos/${ids[0]}/restore`, { method: "POST", cookie })).status).toBe(200);
    expect((await list())[0]?.photos.map((p) => p.id)).toEqual([ids[2], ids[0], ids[1]]);
  });
});

describe("purge", () => {
  it("removes ideas and photos deleted a month ago, with their R2 objects", async () => {
    const kept = await createItem();
    const gone = await createItem();
    const [keptPhoto, removedPhoto, gonePhoto] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await uploadPhoto(kept.id, keptPhoto, cookie);
    await uploadPhoto(kept.id, removedPhoto, cookie);
    await uploadPhoto(gone.id, gonePhoto, cookie);
    await request(`/api/photos/${removedPhoto}`, { method: "DELETE", cookie });
    await request(`/api/items/${gone.id}`, { method: "DELETE", cookie });

    // Nothing is old enough yet.
    expect(await purgeDeleted(env)).toEqual({ photos: 0, items: 0 });

    const result = await purgeDeleted(env, Date.now() + PURGE_AFTER_MS + 1000);
    expect(result).toEqual({ photos: 2, items: 1 });
    expect(await env.PHOTOS.get(`photos/${keptPhoto}/large`)).not.toBeNull();
    for (const id of [removedPhoto, gonePhoto]) {
      expect(await env.PHOTOS.get(`photos/${id}/large`)).toBeNull();
      expect(await env.PHOTOS.get(`photos/${id}/thumb`)).toBeNull();
    }
    expect((await request(`/api/items/${gone.id}/restore`, { method: "POST", cookie })).status).toBe(404);
    expect((await list())[0]?.photos.map((p) => p.id)).toEqual([keptPhoto]);
  });
});
