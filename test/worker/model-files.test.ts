import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentScope, NewTokenResponse } from "../../src/shared/agents.ts";
import type { AttemptResponse, ItemFileResponse, ItemResponse, RecipeResponse } from "../../src/shared/api.ts";
import type { Change } from "../../src/shared/changes.ts";
import { DEFAULT_SLICING } from "../../src/shared/slicing/defaults.ts";
import type { SlicingSettings } from "../../src/shared/slicing/settings.ts";
import type { FileSlice } from "../../src/shared/slicing/types.ts";
import { PURGE_AFTER_MS, purgeDeleted } from "../../src/worker/photos.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

/** Models: an .stl or plain .3mf kept as it is, sliced in the browser, its .gcode.3mf kept beside it (decision 0046). */

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

const uuid = () => crypto.randomUUID();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const STL = new TextEncoder().encode("solid cube\nendsolid cube\n");
const SLICED = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]);

async function idea() {
  const response = await request("/api/items", { method: "POST", cookie, json: { id: uuid(), note: "x" } });
  return (await response.json<ItemResponse>()).item;
}

function modelForm(options: { name?: string; bytes?: Uint8Array | null } = {}) {
  const name = options.name ?? "Benchy.stl";
  const bytes = options.bytes === undefined ? STL : options.bytes;
  const body = new FormData();
  body.set("name", name);
  body.set("size", String(bytes?.length ?? 0));
  body.set("plate", "1");
  body.set("plateCount", "1");
  body.set("prefill", "{}");
  body.set("kind", "model");
  if (bytes) body.set("file", new File([bytes], name));
  return body;
}

const settings = {
  machine: "Bambu Lab X2D 0.4 nozzle",
  process: "0.20mm Standard @BBL X2D",
  filaments: ["Bambu PLA Basic @BBL X2D 0.4 nozzle"],
  layerHeight: 0.2,
  materials: ["PLA"],
  bedType: "Textured PEI Plate",
  supports: false,
  scale: 100,
  engine: "1",
  orca: "2.5.0-dev",
} satisfies FileSlice["settings"];

function slicedForm(
  slice: Partial<FileSlice> = {},
  options: { sliced?: boolean; thumb?: boolean; bytes?: Uint8Array; minutes?: number; keep?: boolean } = {},
) {
  const body = new FormData();
  body.set("slice", JSON.stringify({ status: "sliced", settings, at: Date.now(), ...slice }));
  if (options.sliced !== false && (slice.status ?? "sliced") === "sliced") {
    body.set("sliced", new File([options.bytes ?? SLICED], "Benchy.gcode.3mf"));
    body.set(
      "prefill",
      JSON.stringify({ estimatedMinutes: options.minutes ?? 38, layerHeight: 0.2, weightGrams: 11.3 }),
    );
    body.set("objects", JSON.stringify(["Benchy.stl"]));
    body.set("slicer", "OrcaSlicer 2.5.0-dev");
  }
  if (options.thumb !== false) body.set("thumb", new File([PNG], "plate_1.png", { type: "image/png" }));
  if (options.keep) body.set("keep", "previous");
  return body;
}

const putModel = (itemId: string, fileId: string, body = modelForm()) =>
  request(`/api/items/${itemId}/files/${fileId}`, { method: "PUT", body, cookie });
/** `as` null sends no cookie. */
const putSliced = (fileId: string, body: FormData, as: string | null = cookie) =>
  request(`/api/files/${fileId}/sliced`, { method: "PUT", body, ...(as ? { cookie: as } : {}) });

describe("models kept with an idea", () => {
  it("keeps the original as it is, not sliced yet, and serves it", async () => {
    const item = await idea();
    const id = uuid();
    const saved = await putModel(item.id, id);
    expect(saved.status).toBe(201);
    expect((await saved.json<ItemFileResponse>()).file).toMatchObject({
      id,
      name: "Benchy.stl",
      kind: "model",
      slice: null,
      stored: true,
      hasThumb: false,
      prefill: {},
    });
    const bytes = await request(`/api/files/${id}`, { cookie });
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get("content-type")).toBe("model/stl");
    expect(bytes.headers.get("content-disposition")).toContain("Benchy.stl");
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(STL);
    expect((await request(`/api/files/${id}/sliced`, { cookie })).status).toBe(404);
    // A slicer file is still a slicer file, and says so.
    const slicer = new FormData();
    for (const [key, value] of modelForm({ name: "Bin.gcode.3mf" }).entries())
      if (key !== "kind") slicer.set(key, value);
    const kept = await putModel(item.id, uuid(), slicer);
    expect((await kept.json<ItemFileResponse>()).file).toMatchObject({ kind: "slicer", slice: null });
  });

  it("refuses a model without its bytes", async () => {
    const item = await idea();
    const response = await putModel(item.id, uuid(), modelForm({ bytes: null }));
    expect(response.status).toBe(400);
    expect((await itemOf(item.id)).files).toEqual([]);
  });

  it("keeps the sliced file beside the original, with its picture, what it said and how it was sliced", async () => {
    const item = await idea();
    const id = uuid();
    await putModel(item.id, id);
    const response = await putSliced(id, slicedForm({ cautions: ["floating"] }));
    expect(response.status).toBe(200);
    const { file } = await response.json<ItemFileResponse>();
    expect(file).toMatchObject({
      kind: "model",
      hasThumb: true,
      slicer: "OrcaSlicer 2.5.0-dev",
      objects: ["Benchy.stl"],
      prefill: { estimatedMinutes: 38, layerHeight: 0.2, weightGrams: 11.3 },
      slice: { status: "sliced", bytes: SLICED.length, cautions: ["floating"], settings },
    });
    expect((await itemOf(item.id)).files?.[0]).toEqual(file);

    const sliced = await request(`/api/files/${id}/sliced`, { cookie });
    expect(sliced.status).toBe(200);
    expect(sliced.headers.get("content-disposition")).toContain('filename="Benchy.gcode.3mf"');
    expect(sliced.headers.get("cache-control")).toBe("private, no-cache");
    expect(new Uint8Array(await sliced.arrayBuffer())).toEqual(SLICED);
    expect((await request(`/api/files/${id}/thumb`, { cookie })).status).toBe(200);
    // The original stays as it was.
    expect(new Uint8Array(await (await request(`/api/files/${id}`, { cookie })).arrayBuffer())).toEqual(STL);

    const feed = await (await request("/api/changes?after=0", { cookie })).json<{ changes: Change[] }>();
    expect(
      feed.changes
        .filter((change) => change.entity === "file")
        .map((change) => [change.action, change.id, change.itemId]),
    ).toEqual([
      ["created", id, item.id],
      ["updated", id, item.id],
    ]);
  });

  it("keeps what its slice stored when the model is sent again by its id (an outbox retry)", async () => {
    const item = await idea();
    const id = uuid();
    await putModel(item.id, id);
    const { file: sliced } = await (await putSliced(id, slicedForm())).json<ItemFileResponse>();
    expect((await putModel(item.id, id)).status).toBe(200);
    const file = (await itemOf(item.id)).files?.[0];
    expect(file).toMatchObject({
      hasThumb: true,
      slicer: "OrcaSlicer 2.5.0-dev",
      objects: ["Benchy.stl"],
      prefill: { estimatedMinutes: 38, layerHeight: 0.2, weightGrams: 11.3 },
      slice: { status: "sliced" },
    });
    expect(file).toEqual(sliced);
  });

  it("keeps why a slice failed, and drops the sliced file it had", async () => {
    const item = await idea();
    const id = uuid();
    await putModel(item.id, id);
    await putSliced(id, slicedForm());
    const failed = await putSliced(
      id,
      slicedForm(
        { status: "failed", problem: "too-big", dimensions: [312, 80, 40], volume: [256, 256, 261], fitScale: 78 },
        { thumb: false },
      ),
    );
    expect(failed.status).toBe(200);
    const { file } = await failed.json<ItemFileResponse>();
    expect(file.slice).toMatchObject({ status: "failed", problem: "too-big", fitScale: 78, dimensions: [312, 80, 40] });
    // What the earlier slice said, and its picture, stay until a slice replaces them.
    expect(file).toMatchObject({ hasThumb: true, prefill: { estimatedMinutes: 38 } });
    expect((await request(`/api/files/${id}/sliced`, { cookie })).status).toBe(404);
    expect(await env.PHOTOS.get(`files/${id}/sliced`)).toBeNull();
  });

  it("refuses what it can't use", async () => {
    const item = await idea();
    const id = uuid();
    await putModel(item.id, id);
    expect((await putSliced(uuid(), slicedForm())).status).toBe(404);
    expect((await putSliced("not-a-uuid", slicedForm())).status).toBe(400);
    expect((await putSliced(id, slicedForm({}, { sliced: false }))).status).toBe(400);
    const nonsense = new FormData();
    nonsense.set("slice", JSON.stringify({ status: "melted", settings, at: 1 }));
    expect((await putSliced(id, nonsense)).status).toBe(400);
    const bad = slicedForm();
    bad.set("thumb", new File([PNG], "x.txt", { type: "text/plain" }));
    expect((await putSliced(id, bad)).status).toBe(415);
    expect((await putSliced(id, slicedForm(), null)).status).toBe(401);
    // Only a model is sliced.
    const slicer = uuid();
    const form = modelForm({ name: "Bin.gcode.3mf" });
    form.delete("kind");
    await putModel(item.id, slicer, form);
    expect((await putSliced(slicer, slicedForm())).status).toBe(409);
    // A removed model isn't sliced any more.
    await request(`/api/items/${item.id}/files/${id}`, { method: "DELETE", cookie });
    expect((await putSliced(id, slicedForm())).status).toBe(404);
  });

  it("purges the original, the picture, the sliced file and the slice kept for an undo together", async () => {
    const item = await idea();
    const id = uuid();
    await putModel(item.id, id);
    await putSliced(id, slicedForm());
    await putSliced(id, slicedForm({}, { keep: true }));
    expect(await env.PHOTOS.get(`files/${id}/previous`)).not.toBeNull();
    await request(`/api/items/${item.id}/files/${id}`, { method: "DELETE", cookie });
    await purgeDeleted(env, Date.now() + PURGE_AFTER_MS + 60_000);
    for (const part of ["file", "thumb", "sliced", "previous", "previous-thumb"]) {
      expect(await env.PHOTOS.get(`files/${id}/${part}`)).toBeNull();
    }
  });
});

/** Fine, in orange PLA, with supports where needed: settings people chose (decision 0047). */
const fine: SlicingSettings = {
  ...DEFAULT_SLICING,
  layerHeight: 0.12,
  supports: "where-needed",
  filaments: [{ material: "PLA", colorHex: "#f2754e", colorName: "Orange", finish: "basic", spoolId: "spool-1" }],
};

const patchFile = (fileId: string, json: unknown, as: string | null = cookie) =>
  request(`/api/files/${fileId}`, { method: "PATCH", json, ...(as ? { cookie: as } : {}) });
const restore = (fileId: string) => request(`/api/files/${fileId}/sliced/restore`, { method: "POST", cookie });

describe("a model's slicing settings", () => {
  it("are kept with the model, whole, and put back to the defaults with null", async () => {
    const item = await idea();
    const id = uuid();
    await putModel(item.id, id);
    const response = await patchFile(id, {
      slicing: { ...fine, filaments: [{ ...fine.filaments[0], colorHex: "#F2754E" }] },
    });
    expect(response.status).toBe(200);
    // Normalized: the colour as the settings write it.
    expect((await response.json<ItemFileResponse>()).file.slicing).toEqual(fine);
    expect((await itemOf(item.id)).files?.[0]?.slicing).toEqual(fine);
    const cleared = await patchFile(id, { slicing: null });
    expect((await cleared.json<ItemFileResponse>()).file.slicing).toBeNull();

    const feed = await (await request("/api/changes?after=0", { cookie })).json<{ changes: Change[] }>();
    expect(feed.changes.filter((change) => change.entity === "file").map((change) => change.action)).toEqual([
      "created",
      "updated",
      "updated",
    ]);
  });

  it("refuse settings a slicer can't use, and anything but a model", async () => {
    const item = await idea();
    const id = uuid();
    await putModel(item.id, id);
    // A layer the 0.4 mm nozzle can't print, a setting that isn't one, a half wall, nothing at all.
    for (const slicing of [
      { ...fine, layerHeight: 0.32 },
      { ...fine, speed: "fast" },
      { ...fine, walls: 2.5 },
      { ...fine, filaments: [] },
      {},
    ]) {
      expect((await patchFile(id, { slicing })).status).toBe(400);
    }
    expect((await patchFile(id, {})).status).toBe(400);
    expect((await patchFile(uuid(), { slicing: fine })).status).toBe(404);
    expect((await patchFile("not-a-uuid", { slicing: fine })).status).toBe(400);
    const slicer = uuid();
    const form = modelForm({ name: "Bin.gcode.3mf" });
    form.delete("kind");
    await putModel(item.id, slicer, form);
    expect((await patchFile(slicer, { slicing: fine })).status).toBe(409);
    expect((await patchFile(id, { slicing: fine }, null)).status).toBe(401);
  });

  it("are what a slice says it was made with, checked like any", async () => {
    const item = await idea();
    const id = uuid();
    await putModel(item.id, id);
    const saved = await putSliced(id, slicedForm({ settings: { ...settings, slicing: fine } }));
    expect((await saved.json<ItemFileResponse>()).file.slice?.settings.slicing).toEqual(fine);
    const wrong = await putSliced(id, slicedForm({ settings: { ...settings, slicing: { ...fine, nozzle: 0.5 } } }));
    expect(wrong.status).toBe(400);
  });
});

describe("a model in the build's story (MCP's get_build)", () => {
  it("says what it was sliced with, in full, and a change it isn't sliced with yet", async () => {
    const item = await idea();
    const id = uuid();
    await putModel(item.id, id);
    await putSliced(id, slicedForm({ settings: { ...settings, layerHeight: 0.12, slicing: fine } }));
    const sliced = await (await request(`/api/builds/${item.id}/story.md`, { cookie })).text();
    expect(sliced).toContain(
      "Benchy.stl (a model, sliced by Spaghetti with OrcaSlicer 2.5.0-dev for the X2D: Fine (0.12 mm layers), 2 walls and 15% crosshatch infill, tree supports where needed, a brim where needed, PLA Basic orange, Textured PEI Plate, 0.4 mm nozzle, est. 38 min)",
    );
    await patchFile(id, { slicing: { ...fine, layerHeight: 0.24, supports: "off" } });
    const changed = await (await request(`/api/builds/${item.id}/story.md`, { cookie })).text();
    expect(changed).toContain(
      "; to be sliced next with Draft (0.24 mm layers), 2 walls and 15% crosshatch infill, no supports",
    );
  });
});

describe("slicing a model again", () => {
  it("keeps the slice it replaces for one undo, which brings back its file, picture, figures and settings", async () => {
    const item = await idea();
    const id = uuid();
    await putModel(item.id, id);
    await putSliced(id, slicedForm({ settings: { ...settings, slicing: DEFAULT_SLICING } }, { minutes: 72 }));
    await patchFile(id, { slicing: fine });
    const again = await putSliced(
      id,
      slicedForm(
        { settings: { ...settings, layerHeight: 0.12, slicing: fine } },
        { bytes: new Uint8Array([7, 7]), minutes: 48, keep: true },
      ),
    );
    expect(again.status).toBe(200);
    const { file } = await again.json<ItemFileResponse>();
    expect(file).toMatchObject({ prefill: { estimatedMinutes: 48 }, slicing: fine });
    expect(file.previous).toMatchObject({
      prefill: { estimatedMinutes: 72 },
      slice: { status: "sliced", settings: { slicing: DEFAULT_SLICING } },
      hasThumb: true,
    });
    expect(new Uint8Array(await (await request(`/api/files/${id}/sliced`, { cookie })).arrayBuffer())).toEqual(
      new Uint8Array([7, 7]),
    );
    const kept = await env.PHOTOS.get(`files/${id}/previous`);
    expect(new Uint8Array((await kept?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(SLICED);

    const undone = await restore(id);
    expect(undone.status).toBe(200);
    const restored = (await undone.json<ItemFileResponse>()).file;
    expect(restored).toMatchObject({
      prefill: { estimatedMinutes: 72 },
      slicing: DEFAULT_SLICING,
      previous: null,
      slice: { status: "sliced", settings: { slicing: DEFAULT_SLICING } },
    });
    expect(new Uint8Array(await (await request(`/api/files/${id}/sliced`, { cookie })).arrayBuffer())).toEqual(SLICED);
    expect(await env.PHOTOS.get(`files/${id}/previous`)).toBeNull();
    expect((await itemOf(item.id)).files?.[0]).toEqual(restored);
    // Once: the slice it undid isn't kept.
    expect((await restore(id)).status).toBe(409);
  });

  it("brings back the slice before a change it couldn't slice", async () => {
    const item = await idea();
    const id = uuid();
    await putModel(item.id, id);
    await putSliced(id, slicedForm());
    const failed = await putSliced(
      id,
      slicedForm({ status: "failed", problem: "too-big", fitScale: 80 }, { thumb: false, keep: true }),
    );
    expect((await failed.json<ItemFileResponse>()).file).toMatchObject({
      slice: { status: "failed" },
      previous: { slice: { status: "sliced" } },
    });
    expect((await request(`/api/files/${id}/sliced`, { cookie })).status).toBe(404);
    const back = await (await restore(id)).json<ItemFileResponse>();
    expect(back.file).toMatchObject({ slice: { status: "sliced" }, prefill: { estimatedMinutes: 38 }, previous: null });
    expect((await request(`/api/files/${id}/sliced`, { cookie })).status).toBe(200);
  });

  it("forgets the kept slice once another is made without keeping one", async () => {
    const item = await idea();
    const id = uuid();
    await putModel(item.id, id);
    await putSliced(id, slicedForm());
    await putSliced(id, slicedForm({}, { keep: true }));
    const plain = await (await putSliced(id, slicedForm())).json<ItemFileResponse>();
    expect(plain.file.previous).toBeNull();
    expect(await env.PHOTOS.get(`files/${id}/previous`)).toBeNull();
    expect((await restore(id)).status).toBe(409);
  });

  it("keeps no slice for an undo when the new sliced file came in parts, over the one it replaces", async () => {
    const item = await idea();
    const id = uuid();
    await putModel(item.id, id);
    await putSliced(id, slicedForm({}, { keep: true }));
    await putSliced(id, slicedForm({}, { keep: true, bytes: new Uint8Array([5, 5]) }));
    // A big one is in the bucket already (POST /api/uploads), over the slice that was there.
    const big = new Uint8Array([9, 9, 9]);
    await env.PHOTOS.put(`files/${id}/sliced`, big);
    const body = slicedForm({}, { keep: true, sliced: false });
    body.set("uploaded", "1");
    body.set("prefill", JSON.stringify({ estimatedMinutes: 90, layerHeight: 0.2, weightGrams: 30 }));
    const saved = await putSliced(id, body);
    expect(saved.status).toBe(200);
    const { file } = await saved.json<ItemFileResponse>();
    expect(file).toMatchObject({ prefill: { estimatedMinutes: 90 }, previous: null });
    expect(file.slice).toMatchObject({ status: "sliced", bytes: 3 });
    expect(await env.PHOTOS.get(`files/${id}/previous`)).toBeNull();
    expect((await restore(id)).status).toBe(409);
  });

  it("is for people: an agent can't change settings or undo", async () => {
    const item = await idea();
    const id = uuid();
    await putModel(item.id, id);
    const made = await request("/api/agents", {
      method: "POST",
      cookie,
      json: { name: "Claude", scopes: ["read", "capture", "attempts", "printer"] satisfies AgentScope[] },
    });
    const { token } = await made.json<NewTokenResponse>();
    const headers = { Authorization: `Bearer ${token}`, Origin: "http://other.test" };
    expect((await request(`/api/files/${id}`, { method: "PATCH", headers, json: { slicing: fine } })).status).toBe(403);
    expect((await request(`/api/files/${id}/sliced/restore`, { method: "POST", headers })).status).toBe(403);
  });
});

describe("a model an attempt was printed from", () => {
  it("is kept on the attempt and sliced beside it, and replacing it takes its sliced file too", async () => {
    const item = await idea();
    await request(`/api/items/${item.id}`, { method: "PATCH", cookie, json: { stage: "building" } });
    const attemptId = uuid();
    const made = await request(`/api/items/${item.id}/attempts`, {
      method: "POST",
      cookie,
      json: { id: attemptId, outcome: null, printedAt: Date.now() },
    });
    expect(made.status).toBe(201);
    const id = uuid();
    const body = modelForm();
    body.set("id", id);
    const kept = await request(`/api/attempts/${attemptId}/file`, { method: "PUT", body, cookie });
    expect(kept.status).toBe(201);
    expect((await kept.json<AttemptResponse>()).attempt.file).toMatchObject({ id, kind: "model", slice: null });
    expect((await putSliced(id, slicedForm())).status).toBe(200);
    const attempt = (await itemOf(item.id)).attempts[0];
    expect(attempt?.file).toMatchObject({ id, slice: { status: "sliced" }, prefill: { estimatedMinutes: 38 } });

    const next = new FormData();
    for (const [key, value] of modelForm({ name: "Bin.gcode.3mf" }).entries()) if (key !== "kind") next.set(key, value);
    next.set("id", uuid());
    expect((await request(`/api/attempts/${attemptId}/file`, { method: "PUT", body: next, cookie })).status).toBe(201);
    expect(await env.PHOTOS.get(`files/${id}/sliced`)).toBeNull();
  });
});

describe("a recipe from an attempt printed from a model", () => {
  it("keeps the slicing settings that worked, the kind of filament and not the spool", async () => {
    const item = await idea();
    await request(`/api/items/${item.id}`, { method: "PATCH", cookie, json: { stage: "building" } });
    const attemptId = uuid();
    await request(`/api/items/${item.id}/attempts`, {
      method: "POST",
      cookie,
      json: { id: attemptId, outcome: "success", settings: { filaments: [{ type: "PLA", colorName: "Orange" }] } },
    });
    const id = uuid();
    const body = modelForm();
    body.set("id", id);
    await request(`/api/attempts/${attemptId}/file`, { method: "PUT", body, cookie });
    await putSliced(id, slicedForm({ settings: { ...settings, layerHeight: 0.12, slicing: fine } }));
    const saved = await request("/api/recipes", {
      method: "POST",
      cookie,
      json: { id: uuid(), name: "Fine knobs", sourceAttemptId: attemptId },
    });
    expect(saved.status).toBe(201);
    const { recipe } = await saved.json<RecipeResponse>();
    const { spoolId: _spool, ...orange } = fine.filaments[0] as NonNullable<(typeof fine.filaments)[0]>;
    expect(recipe.slicing).toEqual({ ...fine, filaments: [orange] });
  });

  it("keeps none from a model taken off the attempt, which waits for the purge", async () => {
    const item = await idea();
    await request(`/api/items/${item.id}`, { method: "PATCH", cookie, json: { stage: "building" } });
    const attemptId = uuid();
    await request(`/api/items/${item.id}/attempts`, {
      method: "POST",
      cookie,
      json: { id: attemptId, outcome: "success", settings: { filaments: [{ type: "PLA", colorName: "Orange" }] } },
    });
    const id = uuid();
    const body = modelForm();
    body.set("id", id);
    await request(`/api/attempts/${attemptId}/file`, { method: "PUT", body, cookie });
    await putSliced(id, slicedForm({ settings: { ...settings, layerHeight: 0.12, slicing: fine } }));
    expect((await request(`/api/attempts/${attemptId}/file`, { method: "DELETE", cookie })).status).toBe(204);
    const saved = await request("/api/recipes", {
      method: "POST",
      cookie,
      json: { id: uuid(), name: "Knobs", sourceAttemptId: attemptId },
    });
    expect(saved.status).toBe(201);
    expect((await saved.json<RecipeResponse>()).recipe.slicing).toBeNull();
  });
});

describe("models, for agents", () => {
  it("can keep a model like any file, but never send a slice", async () => {
    const item = await idea();
    const made = await request("/api/agents", {
      method: "POST",
      cookie,
      json: { name: "Claude", scopes: ["read", "capture", "attempts", "printer"] satisfies AgentScope[] },
    });
    const { token } = await made.json<NewTokenResponse>();
    const asAgent = (path: string, init: RequestInit) =>
      request(path, { ...init, headers: { Authorization: `Bearer ${token}`, Origin: "http://other.test" } });
    const id = uuid();
    expect((await asAgent(`/api/items/${item.id}/files/${id}`, { method: "PUT", body: modelForm() })).status).toBe(201);
    expect((await asAgent(`/api/files/${id}/sliced`, { method: "PUT", body: slicedForm() })).status).toBe(403);
  });
});

async function itemOf(id: string) {
  return (await (await request(`/api/items/${id}`, { cookie })).json<ItemResponse>()).item;
}
