import { beforeEach, describe, expect, it } from "vitest";
import type { Item, ItemResponse } from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn, uploadPhoto } from "./helpers.ts";

let alex: string;
let sam: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  await addUser("sam", "battery staple", "Sam Okafor", "blue");
  alex = await signIn("alex", "correct horse");
  sam = await signIn("sam", "battery staple");
});

const uuid = () => crypto.randomUUID();
const get = async (id: string) => (await request(`/api/items/${id}`, { cookie: alex })).json<ItemResponse>();

async function make(json: Record<string, unknown>, as = alex): Promise<Item> {
  const response = await request("/api/items", { method: "POST", cookie: as, json: { id: uuid(), ...json } });
  return (await response.json<ItemResponse>()).item;
}

async function attempt(itemId: string, note = ""): Promise<string> {
  const id = uuid();
  const response = await request(`/api/items/${itemId}/attempts`, {
    method: "POST",
    cookie: alex,
    json: { id, outcome: "failed", note },
  });
  expect(response.status).toBe(201);
  return id;
}

const move = (id: string, json: unknown, as = alex) =>
  request(`/api/items/${id}/move`, { method: "POST", cookie: as, json });

describe("moving a capture into a build", () => {
  it("takes the photos with their time and order and adds the note after the build's", async () => {
    const idea = await make({ note: "It warped at the corners" });
    const first = uuid();
    const second = uuid();
    await uploadPhoto(idea.id, first, alex, { takenAt: "1700000000000" });
    await uploadPhoto(idea.id, second, alex);
    const build = await make({ title: "Towel hook", note: "Printed in PETG", stage: "building" });
    await uploadPhoto(build.id, uuid(), alex);
    const before = (await get(idea.id)).item.photos;

    const response = await move(idea.id, { targetId: build.id });
    expect(response.status).toBe(200);
    const { item } = await response.json<ItemResponse>();
    expect(item.note).toBe("Printed in PETG\n\nIt warped at the corners");
    expect(item.photos.map((photo) => photo.id).slice(1)).toEqual([first, second]);
    expect(item.photos.slice(1).map((photo) => photo.attemptId)).toEqual([null, null]);
    const moved = item.photos.find((photo) => photo.id === first);
    expect(moved?.takenAt).toBe(1_700_000_000_000);
    expect(moved?.createdAt).toBe(before.find((photo) => photo.id === first)?.createdAt);
    expect((await request(`/api/items/${idea.id}`, { cookie: alex })).status).toBe(404);
  });

  it("puts them on an attempt, and the note on its note", async () => {
    const idea = await make({ title: "Lifted", note: "Corner lifted" });
    const photo = uuid();
    await uploadPhoto(idea.id, photo, alex);
    const build = await make({ title: "Towel hook", note: "Build note", stage: "building" });
    const attemptId = await attempt(build.id, "Attempt note");

    const { item } = await (await move(idea.id, { targetId: build.id, attemptId })).json<ItemResponse>();
    expect(item.note).toBe("Build note");
    expect(item.attempts[0]?.note).toBe("Attempt note\n\nLifted\n\nCorner lifted");
    expect(item.photos.find((p) => p.id === photo)?.attemptId).toBe(attemptId);
  });

  it("lets the other person do it too", async () => {
    const idea = await make({ note: "Sam's thought" }, sam);
    const build = await make({ stage: "building" });
    expect((await move(idea.id, { targetId: build.id }, alex)).status).toBe(200);
  });

  it("keeps an idea that has comments, and refuses what isn't an idea or a build", async () => {
    const idea = await make({ note: "Talked about" });
    const build = await make({ stage: "building" });
    await request(`/api/items/${idea.id}/comments`, {
      method: "POST",
      cookie: sam,
      json: { id: uuid(), body: "Nice" },
    });
    const refused = await move(idea.id, { targetId: build.id });
    expect(refused.status).toBe(409);
    expect((await get(idea.id)).item.note).toBe("Talked about");

    const other = await make({});
    expect((await move(other.id, { targetId: idea.id })).status).toBe(409);
    expect((await move(build.id, { targetId: build.id })).status).toBe(409);
    expect((await move(other.id, { targetId: uuid() })).status).toBe(404);
    expect((await move(other.id, { targetId: build.id, attemptId: uuid() })).status).toBe(404);
  });

  it("undoes: the idea, its note, its photos and the build's note are as they were", async () => {
    const idea = await make({ title: "Loose", note: "Warping" });
    const photos = [uuid(), uuid()];
    for (const id of photos) await uploadPhoto(idea.id, id, alex);
    const build = await make({ note: "Mine", stage: "building" });
    const attemptId = await attempt(build.id, "Tried");
    const places = (await get(idea.id)).item.photos.map((photo) => ({ id: photo.id, position: photo.position }));

    await move(idea.id, { targetId: build.id, attemptId });
    const undone = await request(`/api/items/${idea.id}/unmove`, {
      method: "POST",
      cookie: alex,
      json: { targetId: build.id, attemptId, photos: places, note: "Warping" },
    });
    expect(undone.status).toBe(200);
    const { item } = await undone.json<ItemResponse>();
    expect(item).toMatchObject({ title: "Loose", note: "Warping", stage: "idea" });
    expect(item.photos.map((photo) => [photo.id, photo.position, photo.attemptId])).toEqual(
      places.map((place) => [place.id, place.position, null]),
    );
    const after = (await get(build.id)).item;
    expect(after.attempts[0]?.note).toBe("Tried");
    expect(after.photos).toEqual([]);
  });
});

describe("the limits of a move", () => {
  it("won't make a note too long to save, and won't undo a move that didn't happen", async () => {
    const idea = await make({ note: "x".repeat(15_000) });
    const build = await make({ note: "y".repeat(10_000), stage: "building" });
    expect((await move(idea.id, { targetId: build.id })).status).toBe(409);
    expect((await get(idea.id)).item.note).toHaveLength(15_000);

    const unmove = (json: unknown) => request(`/api/items/${idea.id}/unmove`, { method: "POST", cookie: alex, json });
    // A live idea is not touched by an undo.
    expect((await unmove({ targetId: build.id, photos: [], note: "overwritten" })).status).toBe(404);
    expect((await get(idea.id)).item.note).toHaveLength(15_000);
  });

  it("undoes only once, and only with an attempt of the build", async () => {
    const idea = await make({ note: "Warping" });
    const build = await make({ stage: "building" });
    const other = await make({ stage: "building" });
    const elsewhere = await attempt(other.id, "Not this one");
    await move(idea.id, { targetId: build.id });
    const unmove = (json: unknown) => request(`/api/items/${idea.id}/unmove`, { method: "POST", cookie: alex, json });
    expect((await unmove({ targetId: build.id, attemptId: elsewhere, photos: [], note: "Warping" })).status).toBe(404);
    expect((await unmove({ targetId: build.id, photos: [], note: "Warping" })).status).toBe(200);
    expect((await unmove({ targetId: build.id, photos: [], note: "again" })).status).toBe(404);
    expect((await get(idea.id)).item.note).toBe("Warping");
  });
});
