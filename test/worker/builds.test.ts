import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  Attempt,
  AttemptResponse,
  Item,
  ItemResponse,
  ItemsResponse,
  TagResponse,
  TagsResponse,
} from "../../src/shared/api.ts";
import { PURGE_AFTER_MS, purgeDeleted } from "../../src/worker/photos.ts";
import { addUser, request, resetDb, signIn, uploadPhoto } from "./helpers.ts";

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

function postItem(body: Record<string, unknown>) {
  return request("/api/items", { method: "POST", cookie, json: { id: crypto.randomUUID(), ...body } });
}

async function createItem(body: Record<string, unknown> = {}): Promise<Item> {
  const response = await postItem(body);
  expect(response.status).toBe(201);
  return (await response.json<ItemResponse>()).item;
}

async function getItem(itemId: string): Promise<Item> {
  const response = await request(`/api/items/${itemId}`, { cookie });
  expect(response.status).toBe(200);
  return (await response.json<ItemResponse>()).item;
}

async function patchItem(itemId: string, json: Record<string, unknown>) {
  return request(`/api/items/${itemId}`, { method: "PATCH", cookie, json });
}

async function list(stage: string): Promise<Item[]> {
  const response = await request(`/api/items?stage=${stage}`, { cookie });
  expect(response.status).toBe(200);
  return (await response.json<ItemsResponse>()).items;
}

function postAttempt(itemId: string, body: Record<string, unknown> = {}) {
  return request(`/api/items/${itemId}/attempts`, {
    method: "POST",
    cookie,
    json: { id: crypto.randomUUID(), ...body },
  });
}

/** Attempts logged in the same millisecond would sort by id: tests that care give times a minute apart. */
const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000;

async function logAttempt(itemId: string, body: Record<string, unknown> = {}): Promise<Attempt> {
  const response = await postAttempt(itemId, body);
  expect(response.status).toBe(201);
  return (await response.json<AttemptResponse>()).attempt;
}

describe("signed out", () => {
  it("refuses every attempt and tag route", async () => {
    const id = crypto.randomUUID();
    const calls: Array<[string, string]> = [
      ["POST", `/api/items/${id}/attempts`],
      ["PATCH", `/api/attempts/${id}`],
      ["DELETE", `/api/attempts/${id}`],
      ["POST", `/api/attempts/${id}/restore`],
      ["GET", "/api/tags"],
      ["POST", "/api/tags"],
    ];
    for (const [method, path] of calls) {
      const response = await request(path, { method, json: method === "GET" ? undefined : {} });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("stages", () => {
  it("starts a build from scratch", async () => {
    const before = Date.now();
    const build = await createItem({ stage: "building", title: "Spool holder" });
    expect(build).toMatchObject({ stage: "building", finishedAt: null, coverPhotoId: null, attempts: [] });
    expect(build.startedAt).toBe(build.createdAt);
    expect(build.startedAt).toBeGreaterThanOrEqual(before);
    expect((await createItem()).startedAt).toBeNull();
    expect((await postItem({ stage: "done" })).status).toBe(400);
  });

  it("moves an idea to a build and keeps its id, note and photos", async () => {
    const idea = await createItem({ note: "A hook for the AMS" });
    const photoId = crypto.randomUUID();
    await uploadPhoto(idea.id, photoId, cookie);

    const response = await patchItem(idea.id, { stage: "building" });
    expect(response.status).toBe(200);
    const build = (await response.json<ItemResponse>()).item;
    expect(build).toMatchObject({ id: idea.id, stage: "building", note: "A hook for the AMS", finishedAt: null });
    expect(build.startedAt).toBeGreaterThan(0);
    expect(build.photos.map((photo) => photo.id)).toEqual([photoId]);

    // Done, then back to building (undo), then back to an idea (undo of starting).
    const done = (await (await patchItem(idea.id, { stage: "done" })).json<ItemResponse>()).item;
    expect(done.stage).toBe("done");
    expect(done.startedAt).toBe(build.startedAt);
    expect(done.finishedAt).toBeGreaterThanOrEqual(build.startedAt ?? 0);

    const again = (await (await patchItem(idea.id, { stage: "building" })).json<ItemResponse>()).item;
    expect(again).toMatchObject({ stage: "building", startedAt: build.startedAt, finishedAt: null });

    const shelved = (await (await patchItem(idea.id, { stage: "shelved" })).json<ItemResponse>()).item;
    expect(shelved.finishedAt).not.toBeNull();

    const back = (await (await patchItem(idea.id, { stage: "idea" })).json<ItemResponse>()).item;
    expect(back).toMatchObject({ stage: "idea", startedAt: null, finishedAt: null, note: "A hook for the AMS" });
    expect(back.photos.map((photo) => photo.id)).toEqual([photoId]);
  });

  it("lists builds and ideas apart, and refuses unknown stages", async () => {
    const idea = await createItem();
    const building = await createItem({ stage: "building" });
    const done = await createItem({ stage: "building" });
    await patchItem(done.id, { stage: "done" });
    const shelved = await createItem({ stage: "building" });
    await patchItem(shelved.id, { stage: "shelved" });

    const builds = await list("building,done,shelved");
    expect(builds.map((item) => item.id).sort()).toEqual([building.id, done.id, shelved.id].sort());
    expect((await list("idea")).map((item) => item.id)).toEqual([idea.id]);
    expect((await list("done")).map((item) => item.id)).toEqual([done.id]);
    expect((await (await request("/api/items", { cookie })).json<ItemsResponse>()).items).toHaveLength(4);

    for (const stage of ["printing", "idea,nope", "", "idea,"]) {
      expect((await request(`/api/items?stage=${stage}`, { cookie })).status, stage).toBe(400);
    }
    expect((await patchItem(idea.id, { stage: "printing" })).status).toBe(400);
  });

  it("lists more items than D1 binds parameters for", async () => {
    const now = Date.now();
    const userId = (await env.DB.prepare("SELECT id FROM users").first<{ id: string }>())?.id;
    const ids = Array.from({ length: 150 }, () => crypto.randomUUID());
    await env.DB.batch(
      ids.map((itemId, i) =>
        env.DB.prepare(
          "INSERT INTO items (id, stage, note, created_by, created_at, updated_at) VALUES (?, 'building', '', ?, ?, ?)",
        ).bind(itemId, userId, now - i, now - i),
      ),
    );
    const last = ids.at(-1) ?? "";
    await logAttempt(last);
    await uploadPhoto(last, crypto.randomUUID(), cookie);
    const builds = await list("building");
    expect(builds).toHaveLength(150);
    expect(builds.at(-1)).toMatchObject({ id: last, attempts: [{ itemId: last }], photos: [{ itemId: last }] });
  });

  it("makes an idea a build when an attempt is logged on it", async () => {
    const idea = await createItem({ note: "Cable clips" });
    await logAttempt(idea.id);
    const build = await getItem(idea.id);
    expect(build.stage).toBe("building");
    expect(build.startedAt).not.toBeNull();
    expect(build.attempts).toHaveLength(1);
    expect(build.updatedAt).toBeGreaterThanOrEqual(idea.updatedAt);

    // A finished build stays finished when another attempt is logged.
    await patchItem(idea.id, { stage: "done" });
    await logAttempt(idea.id);
    expect((await getItem(idea.id)).stage).toBe("done");
  });
});

describe("attempts", () => {
  it("is idempotent on id", async () => {
    const build = await createItem({ stage: "building" });
    const id = crypto.randomUUID();
    const first = await logAttempt(build.id, { id, note: "first try" });
    const retry = await postAttempt(build.id, { id, note: "again" });
    expect(retry.status).toBe(201);
    expect((await retry.json<AttemptResponse>()).attempt).toEqual(first);
    expect((await getItem(build.id)).attempts).toHaveLength(1);

    // The same id on another build is a conflict; on a missing build, 404.
    const other = await createItem({ stage: "building" });
    expect((await postAttempt(other.id, { id })).status).toBe(409);
    expect((await postAttempt(crypto.randomUUID())).status).toBe(404);
  });

  it("is printing until it gets an outcome", async () => {
    const build = await createItem({ stage: "building" });
    const printing = await logAttempt(build.id, { note: "Benchy" });
    expect(printing).toMatchObject({ outcome: null, finishedAt: null, note: "Benchy", failureTags: [] });

    const response = await request(`/api/attempts/${printing.id}`, {
      method: "PATCH",
      cookie,
      json: { outcome: "failed", failureTags: ["spaghetti", "bed-adhesion"] },
    });
    expect(response.status).toBe(200);
    const failed = (await response.json<AttemptResponse>()).attempt;
    expect(failed).toMatchObject({ outcome: "failed", failureTags: ["spaghetti", "bed-adhesion"], note: "Benchy" });
    expect(failed.finishedAt).toBeGreaterThanOrEqual(printing.createdAt);
    expect(failed.updatedAt).toBeGreaterThanOrEqual(printing.updatedAt);

    // Changing the outcome keeps the finish time; back to printing clears it.
    const partial = await request(`/api/attempts/${printing.id}`, {
      method: "PATCH",
      cookie,
      json: { outcome: "partial" },
    });
    expect((await partial.json<AttemptResponse>()).attempt.finishedAt).toBe(failed.finishedAt);
    const reopened = await request(`/api/attempts/${printing.id}`, {
      method: "PATCH",
      cookie,
      json: { outcome: null },
    });
    expect((await reopened.json<AttemptResponse>()).attempt).toMatchObject({ outcome: null, finishedAt: null });

    // Logged with an outcome, it is finished at once.
    const done = await logAttempt(build.id, { outcome: "success", successNotes: ["great-first-layer"] });
    expect(done.finishedAt).not.toBeNull();
  });

  it("keeps a backdated attempt's time but never one from the future", async () => {
    const build = await createItem({ stage: "building" });
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    expect((await logAttempt(build.id, { printedAt: yesterday })).printedAt).toBe(yesterday);
    expect((await logAttempt(build.id, { printedAt: Date.now() + 1e9 })).printedAt).toBeLessThanOrEqual(Date.now());
    const attempts = (await getItem(build.id)).attempts;
    expect(attempts[0]?.printedAt).toBe(yesterday);
  });

  it("starts from the last attempt's settings, without its results", async () => {
    const build = await createItem({ stage: "building" });
    await logAttempt(build.id, {
      outcome: "failed",
      printedAt: minutesAgo(10),
      settings: {
        filaments: [{ type: "PLA", brand: "Bambu", colorHex: "#00AE42", colorName: "Green" }],
        bedTemperature: 60,
        layerHeight: 0.2,
        actualMinutes: 42,
        failedAtLayer: 12,
        estimatedMinutes: 90,
        bogus: "dropped",
      },
    });
    const second = await logAttempt(build.id);
    expect(second.settings).toEqual({
      filaments: [{ type: "PLA", brand: "Bambu", colorHex: "#00ae42", colorName: "Green" }],
      bedTemperature: 60,
      layerHeight: 0.2,
    });
    expect(second.changes).toEqual([]);

    // Given settings replace them; an empty object is "nothing set".
    const third = await logAttempt(build.id, { settings: {} });
    expect(third.settings).toEqual({});
  });

  it("says what changed since the attempt before", async () => {
    const build = await createItem({ stage: "building" });
    const first = await logAttempt(build.id, {
      outcome: "failed",
      printedAt: minutesAgo(10),
      settings: { bedTemperature: 60 },
    });
    expect(first.changes).toEqual([]);
    const second = await logAttempt(build.id, {
      printedAt: minutesAgo(5),
      settings: { bedTemperature: 65, brim: true },
    });
    expect(second.changes.map((change) => change.text)).toEqual(["added a brim", "bed 60 → 65 °C"]);

    const item = await getItem(build.id);
    expect(item.attempts.map((attempt) => attempt.id)).toEqual([first.id, second.id]);
    expect(item.attempts[1]?.changes).toEqual(second.changes);

    // PATCH replaces the settings and the comparison follows.
    const patched = await request(`/api/attempts/${second.id}`, {
      method: "PATCH",
      cookie,
      json: { settings: { bedTemperature: 60, nozzleTemperature: 220 } },
    });
    expect((await patched.json<AttemptResponse>()).attempt.changes.map((change) => change.text)).toEqual([
      "nozzle 220 °C",
    ]);
  });

  it("validates settings and tags, and de-duplicates tags", async () => {
    const build = await createItem({ stage: "building" });
    const bad: Array<Record<string, unknown>> = [
      { id: "nope" },
      { outcome: "meh" },
      { settings: { bedTemperature: 900 } },
      { settings: { layerHeight: 0 } },
      { settings: { infillDensity: 101 } },
      { settings: { nozzle: "left" } },
      { settings: { filaments: [{ colorHex: "green" }] } },
      { settings: { filaments: Array.from({ length: 33 }, () => ({})) } },
      { settings: { processPreset: "x".repeat(121) } },
      { failureTags: ["Not A Slug"] },
      { failureTags: ["-spaghetti"] },
      { failureTags: ["x".repeat(49)] },
      { successNotes: Array.from({ length: 41 }, (_, i) => `tag-${i}`) },
    ];
    for (const body of bad) {
      expect((await postAttempt(build.id, body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    const attempt = await logAttempt(build.id, {
      failureTags: ["spaghetti", "warping", "spaghetti", "my-own-tag"],
      successNotes: ["nice-surface", "nice-surface"],
    });
    expect(attempt.failureTags).toEqual(["spaghetti", "warping", "my-own-tag"]);
    expect(attempt.successNotes).toEqual(["nice-surface"]);

    const patch = await request(`/api/attempts/${attempt.id}`, {
      method: "PATCH",
      cookie,
      json: { failureTags: ["Bad"] },
    });
    expect(patch.status).toBe(400);
    expect((await request(`/api/attempts/${crypto.randomUUID()}`, { method: "PATCH", cookie, json: {} })).status).toBe(
      404,
    );
  });

  it("deletes an attempt with its photos and restores both", async () => {
    const build = await createItem({ stage: "building" });
    const first = await logAttempt(build.id, { printedAt: minutesAgo(30), settings: { bedTemperature: 60 } });
    const middle = await logAttempt(build.id, { printedAt: minutesAgo(20), settings: { bedTemperature: 65 } });
    const last = await logAttempt(build.id, { printedAt: minutesAgo(10), settings: { bedTemperature: 70 } });
    const [own, shot] = [crypto.randomUUID(), crypto.randomUUID()];
    await uploadPhoto(build.id, own, cookie);
    expect((await uploadPhoto(build.id, shot, cookie, { attemptId: middle.id })).status).toBe(201);
    expect((await getItem(build.id)).photos.map((photo) => [photo.id, photo.attemptId])).toEqual([
      [own, null],
      [shot, middle.id],
    ]);

    expect((await request(`/api/attempts/${middle.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await request(`/api/attempts/${middle.id}`, { method: "DELETE", cookie })).status).toBe(404);
    expect((await request(`/api/attempts/${middle.id}`, { method: "PATCH", cookie, json: {} })).status).toBe(404);
    let item = await getItem(build.id);
    expect(item.attempts.map((attempt) => attempt.id)).toEqual([first.id, last.id]);
    expect(item.photos.map((photo) => photo.id)).toEqual([own]);
    // The comparison skips the deleted attempt.
    expect(item.attempts[1]?.changes.map((change) => change.text)).toEqual(["bed 60 → 70 °C"]);
    // Its photos can't be uploaded again meanwhile, and its id can't be reused.
    expect((await uploadPhoto(build.id, crypto.randomUUID(), cookie, { attemptId: middle.id })).status).toBe(404);
    expect((await postAttempt(build.id, { id: middle.id })).status).toBe(409);

    const restored = await request(`/api/attempts/${middle.id}/restore`, { method: "POST", cookie });
    expect(restored.status).toBe(200);
    expect((await restored.json<AttemptResponse>()).attempt.changes.map((change) => change.text)).toEqual([
      "bed 60 → 65 °C",
    ]);
    item = await getItem(build.id);
    expect(item.attempts.map((attempt) => attempt.id)).toEqual([first.id, middle.id, last.id]);
    expect(item.photos.map((photo) => photo.id)).toEqual([own, shot]);

    expect((await request(`/api/attempts/${crypto.randomUUID()}/restore`, { method: "POST", cookie })).status).toBe(
      404,
    );
  });

  it("refuses a photo for another build's attempt", async () => {
    const build = await createItem({ stage: "building" });
    const other = await createItem({ stage: "building" });
    const theirs = await logAttempt(other.id);
    expect((await uploadPhoto(build.id, crypto.randomUUID(), cookie, { attemptId: theirs.id })).status).toBe(404);
    expect((await uploadPhoto(build.id, crypto.randomUUID(), cookie, { attemptId: crypto.randomUUID() })).status).toBe(
      404,
    );
    expect((await getItem(build.id)).photos).toEqual([]);
  });
});

describe("cover photo", () => {
  it("is one of the build's shown photos, or none", async () => {
    const build = await createItem({ stage: "building" });
    const attempt = await logAttempt(build.id);
    const [own, shot, elsewhere] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await uploadPhoto(build.id, own, cookie);
    await uploadPhoto(build.id, shot, cookie, { attemptId: attempt.id });
    const other = await createItem();
    await uploadPhoto(other.id, elsewhere, cookie);

    const set = await patchItem(build.id, { coverPhotoId: shot, stage: "done" });
    expect(set.status).toBe(200);
    expect((await set.json<ItemResponse>()).item).toMatchObject({ coverPhotoId: shot, stage: "done" });

    expect((await patchItem(build.id, { coverPhotoId: elsewhere })).status).toBe(400);
    expect((await patchItem(build.id, { coverPhotoId: crypto.randomUUID() })).status).toBe(400);
    expect((await patchItem(build.id, { coverPhotoId: "nope" })).status).toBe(400);
    await request(`/api/photos/${own}`, { method: "DELETE", cookie });
    expect((await patchItem(build.id, { coverPhotoId: own })).status).toBe(400);

    // Hidden with its attempt, it reads as no cover; restoring brings it back.
    await request(`/api/attempts/${attempt.id}`, { method: "DELETE", cookie });
    expect((await getItem(build.id)).coverPhotoId).toBeNull();
    expect((await patchItem(build.id, { coverPhotoId: shot })).status).toBe(400);
    await request(`/api/attempts/${attempt.id}/restore`, { method: "POST", cookie });
    expect((await getItem(build.id)).coverPhotoId).toBe(shot);

    const cleared = await patchItem(build.id, { coverPhotoId: null });
    expect((await cleared.json<ItemResponse>()).item.coverPhotoId).toBeNull();
  });
});

describe("tags", () => {
  async function addTag(kind: string, label: string) {
    return request("/api/tags", { method: "POST", cookie, json: { kind, label } });
  }

  it("adds people's own tags once and lists them by label", async () => {
    const created = await addTag("failure", "  Nozzle hit the part! ");
    expect(created.status).toBe(201);
    expect((await created.json<TagResponse>()).tag).toEqual({
      kind: "failure",
      slug: "nozzle-hit-the-part",
      label: "Nozzle hit the part!",
    });
    const again = await addTag("failure", "nozzle hit the part");
    expect(again.status).toBe(200);
    expect((await again.json<TagResponse>()).tag.label).toBe("Nozzle hit the part!");

    // The same words can be a success note too.
    expect((await addTag("success", "Beautiful bridges")).status).toBe(201);

    const tags = (await (await request("/api/tags", { cookie })).json<TagsResponse>()).tags;
    expect(tags.map((tag) => [tag.kind, tag.slug])).toEqual([
      ["success", "beautiful-bridges"],
      ["failure", "nozzle-hit-the-part"],
    ]);
  });

  it("returns a built-in tag instead of adding it", async () => {
    const response = await addTag("failure", "Layer Shift");
    expect(response.status).toBe(200);
    expect((await response.json<TagResponse>()).tag).toEqual({
      kind: "failure",
      slug: "layer-shift",
      label: "Layer shift",
    });
    expect((await (await request("/api/tags", { cookie })).json<TagsResponse>()).tags).toEqual([]);
  });

  it("refuses empty, unusable and overlong labels and unknown kinds", async () => {
    for (const [kind, label] of [
      ["failure", "   "],
      ["failure", "!!!"],
      ["failure", "x".repeat(41)],
      ["meh", "Fine"],
    ] as const) {
      expect((await addTag(kind, label)).status, `${kind} ${label}`).toBe(400);
    }
  });
});

describe("purge", () => {
  it("removes attempts deleted a month ago with their photos", async () => {
    const build = await createItem({ stage: "building" });
    const kept = await logAttempt(build.id);
    const gone = await logAttempt(build.id);
    const [keptPhoto, gonePhoto] = [crypto.randomUUID(), crypto.randomUUID()];
    await uploadPhoto(build.id, keptPhoto, cookie, { attemptId: kept.id });
    await uploadPhoto(build.id, gonePhoto, cookie, { attemptId: gone.id });
    await request(`/api/attempts/${gone.id}`, { method: "DELETE", cookie });

    // A deleted build takes its attempts with it.
    const deletedBuild = await createItem({ stage: "building" });
    const deletedAttempt = await logAttempt(deletedBuild.id);
    const deletedPhoto = crypto.randomUUID();
    await uploadPhoto(deletedBuild.id, deletedPhoto, cookie, { attemptId: deletedAttempt.id });
    await request(`/api/items/${deletedBuild.id}`, { method: "DELETE", cookie });

    expect(await purgeDeleted(env)).toEqual({ photos: 0, attempts: 0, items: 0 });
    const result = await purgeDeleted(env, Date.now() + PURGE_AFTER_MS + 1000);
    expect(result).toEqual({ photos: 2, attempts: 2, items: 1 });

    expect(await env.PHOTOS.get(`photos/${keptPhoto}/large`)).not.toBeNull();
    for (const id of [gonePhoto, deletedPhoto]) {
      expect(await env.PHOTOS.get(`photos/${id}/large`)).toBeNull();
      expect(await env.PHOTOS.get(`photos/${id}/thumb`)).toBeNull();
    }
    expect((await request(`/api/attempts/${gone.id}/restore`, { method: "POST", cookie })).status).toBe(404);
    const item = await getItem(build.id);
    expect(item.attempts.map((attempt) => attempt.id)).toEqual([kept.id]);
    expect(item.photos.map((photo) => photo.id)).toEqual([keptPhoto]);
  });
});
