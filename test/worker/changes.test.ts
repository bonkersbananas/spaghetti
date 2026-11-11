import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ItemResponse } from "../../src/shared/api.ts";
import { CHANGES_KEEP_MS, CHANGES_PAGE, type Change, type ChangesResponse } from "../../src/shared/changes.ts";
import { purgeDeleted } from "../../src/worker/photos.ts";
import { addUser, request, resetDb, signIn, uploadPhoto } from "./helpers.ts";

let cookie: string;
let alex: string;
let sam: string;
let samCookie: string;

beforeEach(async () => {
  await resetDb();
  alex = await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  sam = await addUser("sam", "battery staple", "Sam Lund", "basil");
  cookie = await signIn("alex", "correct horse");
  samCookie = await signIn("sam", "battery staple");
});

async function feed(after?: number, as = cookie): Promise<ChangesResponse> {
  const response = await request(`/api/changes${after === undefined ? "" : `?after=${after}`}`, { cookie: as });
  expect(response.status).toBe(200);
  return response.json<ChangesResponse>();
}

/** The cursor now: the changes of the next step are everything after it. */
const mark = async () => (await feed()).cursor;

/** Runs one write and returns exactly the changes it recorded. */
async function recorded(write: () => Promise<Response>, expectedStatus: number | number[] = [200, 201, 204]) {
  const before = await mark();
  const response = await write();
  expect([expectedStatus].flat()).toContain(response.status);
  return (await feed(before)).changes;
}

const post = (path: string, json?: unknown, as = cookie) => request(path, { method: "POST", json, cookie: as });
const patch = (path: string, json: unknown, as = cookie) => request(path, { method: "PATCH", json, cookie: as });
const put = (path: string, json: unknown, as = cookie) => request(path, { method: "PUT", json, cookie: as });
const del = (path: string, as = cookie) => request(path, { method: "DELETE", cookie: as });

const shape = (changes: Change[]) =>
  changes.map((change) => [change.entity, change.action, change.id, change.itemId] as const);

async function createItem(body: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const response = await post("/api/items", { id, ...body });
  expect(response.status).toBe(201);
  return (await response.json<ItemResponse>()).item;
}

describe("the change feed", () => {
  it("is for signed-in people only", async () => {
    expect((await request("/api/changes")).status).toBe(401);
    expect((await request("/api/changes?after=0")).status).toBe(401);
    expect((await request("/api/changes", { cookie: "sg_session=nope" })).status).toBe(401);
  });

  it("starts at the end without a cursor, and answers 'nothing new' cheaply", async () => {
    const empty = await feed();
    expect(empty).toEqual({ changes: [], cursor: 0, more: false, reset: false });
    const item = await createItem();
    const start = await feed();
    expect(start.changes).toEqual([]);
    expect(start.cursor).toBeGreaterThan(0);
    expect(await feed(start.cursor)).toEqual({ changes: [], cursor: start.cursor, more: false, reset: false });
    const caught = await feed(0);
    expect(shape(caught.changes)).toEqual([["item", "created", item.id, item.id]]);
    expect(caught.cursor).toBe(start.cursor);
  });

  it("rejects a cursor that isn't a number", async () => {
    expect((await request("/api/changes?after=soon", { cookie })).status).toBe(400);
    expect((await request("/api/changes?after=-1", { cookie })).status).toBe(400);
  });

  it("lists changes oldest first with a cursor that only moves forward, and pages", async () => {
    const before = await mark();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await createItem()).id);
    const all = await feed(before);
    expect(all.changes.map((change) => change.id)).toEqual(ids);
    const seqs = all.changes.map((change) => change.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(3);
    expect(all.cursor).toBe(seqs[2]);
    // Asking again from the middle gets only what's after it.
    expect((await feed(seqs[0])).changes.map((change) => change.id)).toEqual(ids.slice(1));

    // More than a page: `more` says so, and following the cursor gets the rest.
    const inserts = Array.from({ length: CHANGES_PAGE + 5 }, (_, index) =>
      env.DB.prepare(
        "INSERT INTO changes (entity, entity_id, item_id, action, actor_kind, actor_id, at) VALUES ('item', ?, ?, 'updated', 'person', ?, ?)",
      ).bind(`bulk-${index}`, `bulk-${index}`, alex, Date.now()),
    );
    await env.DB.batch(inserts);
    const first = await feed(all.cursor);
    expect(first.changes).toHaveLength(CHANGES_PAGE);
    expect(first.more).toBe(true);
    const second = await feed(first.cursor);
    expect(second.changes).toHaveLength(5);
    expect(second.more).toBe(false);
    expect(second.changes[0]?.seq).toBeGreaterThan(first.cursor);
  });

  it("names who did it and when", async () => {
    const before = await mark();
    const item = await createItem({ note: "a bracket" });
    const [change] = (await feed(before)).changes;
    expect(change).toMatchObject({ entity: "item", action: "created", actor: { kind: "person", id: alex } });
    expect(Math.abs((change?.at ?? 0) - Date.now())).toBeLessThan(10_000);
    const [theirs] = await recorded(() => patch(`/api/items/${item.id}`, { title: "Bracket" }, samCookie));
    expect(theirs?.actor).toEqual({ kind: "person", id: sam });
  });

  it("tells a cursor it can't follow to start over", async () => {
    await createItem();
    const head = await mark();
    expect(await feed(head + 50)).toEqual({ changes: [], cursor: head, more: false, reset: true });
    // Old rows pruned by the daily cron: a cursor from before them can't be followed either.
    await env.DB.prepare("UPDATE changes SET at = ?")
      .bind(Date.now() - CHANGES_KEEP_MS - 1000)
      .run();
    await createItem();
    await createItem();
    await purgeDeleted(env);
    const left = await feed(0);
    expect(left.reset).toBe(true);
    expect(left.cursor).toBeGreaterThan(head);
    expect((await feed(left.cursor)).reset).toBe(false);
  });
});

describe("what writes record", () => {
  it("items: one change each for create, edit, reorder, delete and restore, none for repeats", async () => {
    const id = crypto.randomUUID();
    expect(shape(await recorded(() => post("/api/items", { id, note: "idea" })))).toEqual([
      ["item", "created", id, id],
    ]);
    // A retried capture finds its item already there.
    expect(await recorded(() => post("/api/items", { id, note: "idea" }))).toEqual([]);
    expect(shape(await recorded(() => patch(`/api/items/${id}`, { title: "Bracket" })))).toEqual([
      ["item", "updated", id, id],
    ]);
    expect(shape(await recorded(() => patch(`/api/items/${id}`, { stage: "building" })))).toEqual([
      ["item", "updated", id, id],
    ]);
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    expect(shape(await recorded(() => uploadPhoto(id, first, cookie)))).toEqual([["photo", "created", first, id]]);
    expect(shape(await recorded(() => uploadPhoto(id, second, cookie)))).toEqual([["photo", "created", second, id]]);
    expect(shape(await recorded(() => put(`/api/items/${id}/photos/order`, { photoIds: [second, first] })))).toEqual([
      ["item", "updated", id, id],
    ]);
    expect(shape(await recorded(() => del(`/api/items/${id}`)))).toEqual([["item", "deleted", id, id]]);
    // Nothing to delete twice, nothing to edit once it's gone: refused, and nothing recorded.
    expect(await recorded(() => del(`/api/items/${id}`), 404)).toEqual([]);
    expect(await recorded(() => patch(`/api/items/${id}`, { title: "x" }), 404)).toEqual([]);
    expect(shape(await recorded(() => post(`/api/items/${id}/restore`)))).toEqual([["item", "restored", id, id]]);
    // Restoring what isn't deleted is harmless and silent.
    expect(await recorded(() => post(`/api/items/${id}/restore`))).toEqual([]);
    expect(await recorded(() => post(`/api/items/${crypto.randomUUID()}/restore`), 404)).toEqual([]);
  });

  it("photos: upload once, remove and bring back, and a retried upload is silent", async () => {
    const item = await createItem();
    const photoId = crypto.randomUUID();
    expect(shape(await recorded(() => uploadPhoto(item.id, photoId, samCookie)))).toEqual([
      ["photo", "created", photoId, item.id],
    ]);
    expect(await recorded(() => uploadPhoto(item.id, photoId, samCookie))).toEqual([]);
    expect(shape(await recorded(() => del(`/api/photos/${photoId}`)))).toEqual([
      ["photo", "deleted", photoId, item.id],
    ]);
    expect(await recorded(() => del(`/api/photos/${photoId}`), 404)).toEqual([]);
    expect(shape(await recorded(() => post(`/api/photos/${photoId}/restore`)))).toEqual([
      ["photo", "restored", photoId, item.id],
    ]);
    expect(await recorded(() => post(`/api/photos/${photoId}/restore`))).toEqual([]);
    // Removed, then brought back by its upload landing late.
    await del(`/api/photos/${photoId}`);
    expect(shape(await recorded(() => uploadPhoto(item.id, photoId, samCookie)))).toEqual([
      ["photo", "restored", photoId, item.id],
    ]);
  });

  it("attempts: log, edit, finish, delete and restore; logging one also moves an idea to builds, in the same change", async () => {
    const idea = await createItem({ note: "bracket" });
    const attemptId = crypto.randomUUID();
    expect(
      shape(await recorded(() => post(`/api/items/${idea.id}/attempts`, { id: attemptId, outcome: null }, samCookie))),
    ).toEqual([["attempt", "created", attemptId, idea.id]]);
    expect(await recorded(() => post(`/api/items/${idea.id}/attempts`, { id: attemptId, outcome: null }))).toEqual([]);
    const item = (await (await request(`/api/items/${idea.id}`, { cookie })).json<ItemResponse>()).item;
    expect(item.stage).toBe("building");
    expect(shape(await recorded(() => patch(`/api/attempts/${attemptId}`, { note: "stringing" })))).toEqual([
      ["attempt", "updated", attemptId, idea.id],
    ]);
    const finished = await recorded(() => post(`/api/attempts/${attemptId}/finish`, { outcome: "success" }));
    expect(shape(finished)).toEqual([["attempt", "updated", attemptId, idea.id]]);
    // The same finish again says nothing new.
    expect(await recorded(() => post(`/api/attempts/${attemptId}/finish`, { outcome: "success" }))).toEqual([]);
    expect(shape(await recorded(() => del(`/api/attempts/${attemptId}`)))).toEqual([
      ["attempt", "deleted", attemptId, idea.id],
    ]);
    expect(await recorded(() => del(`/api/attempts/${attemptId}`), 404)).toEqual([]);
    expect(await recorded(() => patch(`/api/attempts/${attemptId}`, { note: "x" }), 404)).toEqual([]);
    expect(shape(await recorded(() => post(`/api/attempts/${attemptId}/restore`)))).toEqual([
      ["attempt", "restored", attemptId, idea.id],
    ]);
    expect(await recorded(() => post(`/api/attempts/${attemptId}/restore`))).toEqual([]);
    // A finish that adds a note is a change; photos on an attempt are the item's.
    const photoId = crypto.randomUUID();
    expect(shape(await recorded(() => uploadPhoto(idea.id, photoId, cookie, { attemptId })))).toEqual([
      ["photo", "created", photoId, idea.id],
    ]);
  });

  it("slicer files: add, replace, remove and bring back", async () => {
    const build = await createItem({ stage: "building" });
    const attemptId = crypto.randomUUID();
    await post(`/api/items/${build.id}/attempts`, { id: attemptId });
    const form = (id: string) => {
      const body = new FormData();
      body.set("id", id);
      body.set("name", "bracket.gcode.3mf");
      body.set("size", "4");
      body.set("plate", "1");
      body.set("plateCount", "1");
      body.set("prefill", "{}");
      body.set("file", new File([new Uint8Array([1, 2, 3, 4])], "bracket.gcode.3mf"));
      return body;
    };
    const send = (id: string) => () =>
      request(`/api/attempts/${attemptId}/file`, { method: "PUT", body: form(id), cookie });
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    expect(shape(await recorded(send(first)))).toEqual([["file", "created", first, build.id]]);
    expect(shape(await recorded(send(first)))).toEqual([["file", "updated", first, build.id]]);
    expect(shape(await recorded(send(second)))).toEqual([["file", "created", second, build.id]]);
    expect(shape(await recorded(() => del(`/api/attempts/${attemptId}/file`)))).toEqual([
      ["file", "deleted", second, build.id],
    ]);
    expect(await recorded(() => del(`/api/attempts/${attemptId}/file`), 404)).toEqual([]);
    expect(shape(await recorded(() => post(`/api/attempts/${attemptId}/file/restore`)))).toEqual([
      ["file", "restored", second, build.id],
    ]);
    expect(await recorded(() => post(`/api/attempts/${attemptId}/file/restore`), 404)).toEqual([]);
  });

  it("spools and the pantry: add, edit, photo, delete, restore, slots, printer setup", async () => {
    const spoolId = crypto.randomUUID();
    const other = crypto.randomUUID();
    expect(shape(await recorded(() => post("/api/spools", { id: spoolId, material: "PLA" })))).toEqual([
      ["spool", "created", spoolId, null],
    ]);
    expect(await recorded(() => post("/api/spools", { id: spoolId, material: "PLA" }))).toEqual([]);
    await post("/api/spools", { id: other, material: "PETG" });
    expect(shape(await recorded(() => patch(`/api/spools/${spoolId}`, { remaining: "half" })))).toEqual([
      ["spool", "updated", spoolId, null],
    ]);
    const photo = new FormData();
    photo.set("width", "100");
    photo.set("height", "100");
    photo.set("color", "#aabbcc");
    photo.set("large", new File([new Uint8Array([1])], "l.webp", { type: "image/webp" }));
    photo.set("thumb", new File([new Uint8Array([1])], "t.webp", { type: "image/webp" }));
    expect(
      shape(
        await recorded(() =>
          request(`/api/spools/${spoolId}/photo/${crypto.randomUUID()}`, { method: "PUT", body: photo, cookie }),
        ),
      ),
    ).toEqual([["spool", "updated", spoolId, null]]);

    expect(shape(await recorded(() => put("/api/printer/slots/A1", { spoolId })))).toEqual([
      ["slot", "updated", "A1", null],
    ]);
    // Moving a spool to another slot is one change, for the slot it goes to.
    expect(shape(await recorded(() => put("/api/printer/slots/B2", { spoolId })))).toEqual([
      ["slot", "updated", "B2", null],
    ]);
    expect(shape(await recorded(() => put("/api/printer/slots/B2", { spoolId: null })))).toEqual([
      ["slot", "updated", "B2", null],
    ]);
    // An empty slot emptied again has nothing to say.
    expect(await recorded(() => put("/api/printer/slots/B2", { spoolId: null }))).toEqual([]);
    expect(
      shape(
        await recorded(() =>
          put("/api/printer", {
            nozzles: { main: { diameter: 0.4, hardened: true }, auxiliary: { diameter: 0.4, hardened: false } },
            plates: ["Textured PEI"],
            amsUnits: 1,
          }),
        ),
      ),
    ).toEqual([["printer", "updated", "x2d", null]]);

    expect(shape(await recorded(() => del(`/api/spools/${spoolId}`)))).toEqual([["spool", "deleted", spoolId, null]]);
    expect(await recorded(() => del(`/api/spools/${spoolId}`), 404)).toEqual([]);
    expect(shape(await recorded(() => post(`/api/spools/${spoolId}/restore`)))).toEqual([
      ["spool", "restored", spoolId, null],
    ]);
    expect(await recorded(() => post(`/api/spools/${spoolId}/restore`))).toEqual([]);
  });

  it("recipes: save, rename, delete and restore; repeats are silent", async () => {
    const item = await createItem({ stage: "building" });
    const attemptId = crypto.randomUUID();
    await post(`/api/items/${item.id}/attempts`, {
      id: attemptId,
      outcome: "success",
      settings: { filaments: [{ type: "PLA" }] },
    });
    const id = crypto.randomUUID();
    const body = { id, name: "Silk PLA", sourceAttemptId: attemptId };
    expect(shape(await recorded(() => post("/api/recipes", body)))).toEqual([["recipe", "created", id, null]]);
    expect(await recorded(() => post("/api/recipes", body))).toEqual([]);
    expect(shape(await recorded(() => patch(`/api/recipes/${id}`, { note: "Slow outer wall" })))).toEqual([
      ["recipe", "updated", id, null],
    ]);
    expect(shape(await recorded(() => del(`/api/recipes/${id}`)))).toEqual([["recipe", "deleted", id, null]]);
    expect(await recorded(() => del(`/api/recipes/${id}`), 404)).toEqual([]);
    expect(shape(await recorded(() => post(`/api/recipes/${id}/restore`)))).toEqual([["recipe", "restored", id, null]]);
  });

  it("shopping list: add, tick off, sort, delete and restore; repeats are silent", async () => {
    const id = crypto.randomUUID();
    const body = { id, name: "Liquid glue" };
    expect(shape(await recorded(() => post("/api/shopping-items", body)))).toEqual([["shopping", "created", id, null]]);
    expect(await recorded(() => post("/api/shopping-items", body))).toEqual([]);
    expect(shape(await recorded(() => patch(`/api/shopping-items/${id}`, { bought: true })))).toEqual([
      ["shopping", "updated", id, null],
    ]);
    expect(shape(await recorded(() => patch(`/api/shopping-items/${id}`, { bought: false })))).toEqual([
      ["shopping", "updated", id, null],
    ]);
    const other = crypto.randomUUID();
    await post("/api/shopping-items", { id: other, name: "Brush" });
    // The list is Brush, Liquid glue: putting the glue first is a change; asking for the order it has is not.
    expect(shape(await recorded(() => put("/api/shopping-items/order", { ids: [id, other] })))).toEqual([
      ["shopping", "updated", id, null],
    ]);
    expect(await recorded(() => put("/api/shopping-items/order", { ids: [id, other] }))).toEqual([]);
    expect(shape(await recorded(() => del(`/api/shopping-items/${id}`)))).toEqual([["shopping", "deleted", id, null]]);
    expect(await recorded(() => del(`/api/shopping-items/${id}`), 404)).toEqual([]);
    expect(shape(await recorded(() => post(`/api/shopping-items/${id}/restore`)))).toEqual([
      ["shopping", "restored", id, null],
    ]);
  });

  it("tags: a new one is a change, an existing or built-in one is not", async () => {
    expect(shape(await recorded(() => post("/api/tags", { kind: "failure", label: "Ghosting" })))).toEqual([
      ["tag", "created", "failure:ghosting", null],
    ]);
    expect(await recorded(() => post("/api/tags", { kind: "failure", label: "Ghosting" }))).toEqual([]);
    expect(await recorded(() => post("/api/tags", { kind: "failure", label: "Warping" }))).toEqual([]);
  });

  it("is rolled back with the write: a refused write leaves no change behind", async () => {
    const before = await mark();
    const item = await createItem();
    // A photo for an item that doesn't exist, an attempt on one that's gone: all refused.
    expect((await uploadPhoto(crypto.randomUUID(), crypto.randomUUID(), cookie)).status).toBe(404);
    await del(`/api/items/${item.id}`);
    expect((await post(`/api/items/${item.id}/attempts`, { id: crypto.randomUUID() })).status).toBe(404);
    expect(shape((await feed(before)).changes)).toEqual([
      ["item", "created", item.id, item.id],
      ["item", "deleted", item.id, item.id],
    ]);
  });

  it("session and sign-in are not data: they record nothing", async () => {
    const before = await mark();
    await signIn("alex", "correct horse");
    expect((await feed(before)).changes).toEqual([]);
  });
});
