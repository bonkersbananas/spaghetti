import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentScope, NewTokenResponse } from "../../src/shared/agents.ts";
import type { AttemptResponse, ItemFileResponse, ItemResponse } from "../../src/shared/api.ts";
import type { Change } from "../../src/shared/changes.ts";
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

function slicedForm(slice: Partial<FileSlice> = {}, options: { sliced?: boolean; thumb?: boolean } = {}) {
  const body = new FormData();
  body.set("slice", JSON.stringify({ status: "sliced", settings, at: Date.now(), ...slice }));
  if (options.sliced !== false && (slice.status ?? "sliced") === "sliced") {
    body.set("sliced", new File([SLICED], "Benchy.gcode.3mf"));
    body.set("prefill", JSON.stringify({ estimatedMinutes: 38, layerHeight: 0.2, weightGrams: 11.3 }));
    body.set("objects", JSON.stringify(["Benchy.stl"]));
    body.set("slicer", "OrcaSlicer 2.5.0-dev");
  }
  if (options.thumb !== false) body.set("thumb", new File([PNG], "plate_1.png", { type: "image/png" }));
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

  it("purges the original, the picture and the sliced file together", async () => {
    const item = await idea();
    const id = uuid();
    await putModel(item.id, id);
    await putSliced(id, slicedForm());
    await request(`/api/items/${item.id}/files/${id}`, { method: "DELETE", cookie });
    await purgeDeleted(env, Date.now() + PURGE_AFTER_MS + 60_000);
    for (const part of ["file", "thumb", "sliced"]) expect(await env.PHOTOS.get(`files/${id}/${part}`)).toBeNull();
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
