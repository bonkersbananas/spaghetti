import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ItemFileResponse, TwistResponse, TwistsResponse } from "../../src/shared/api.ts";
import type { Change } from "../../src/shared/changes.ts";
import type { FileSlice } from "../../src/shared/slicing/types.ts";
import { fileKey, PURGE_AFTER_MS, purgeDeleted } from "../../src/worker/photos.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

/** A twist's model: kept with the twist, sliced in the browser, one at a time (decision 0053). */

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

async function twist() {
  const id = uuid();
  const response = await request("/api/twists", { method: "POST", cookie, json: { id, name: "Fusilli knob" } });
  expect(response.status).toBe(201);
  return id;
}

function modelForm(name = "fusilli-knob, 110 %.stl", kind = "model") {
  const body = new FormData();
  body.set("name", name);
  body.set("size", String(STL.length));
  body.set("plate", "1");
  body.set("plateCount", "1");
  body.set("prefill", "{}");
  body.set("kind", kind);
  body.set("file", new File([STL], name));
  return body;
}

const put = (twistId: string, fileId: string, body = modelForm()) =>
  request(`/api/twists/${twistId}/file/${fileId}`, { method: "PUT", body, cookie });

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

function slicedForm() {
  const body = new FormData();
  body.set("slice", JSON.stringify({ status: "sliced", settings, at: Date.now() }));
  body.set("sliced", new File([SLICED], "x.gcode.3mf"));
  body.set("prefill", JSON.stringify({ estimatedMinutes: 38, layerHeight: 0.2, weightGrams: 11.3 }));
  body.set("thumb", new File([PNG], "plate_1.png", { type: "image/png" }));
  return body;
}

const model = async (id: string) =>
  (await (await request(`/api/twists/${id}`, { cookie })).json<TwistResponse>()).twist.model;

describe("a twist's model", () => {
  it("keeps the model with the twist and lists it", async () => {
    const id = await twist();
    const fileId = uuid();
    const response = await put(id, fileId);
    expect(response.status).toBe(201);
    expect((await response.json<ItemFileResponse>()).file).toMatchObject({
      id: fileId,
      name: "fusilli-knob, 110 %.stl",
      kind: "model",
      slice: null,
    });
    expect(await model(id)).toMatchObject({ id: fileId });
    const list = await (await request("/api/twists", { cookie })).json<TwistsResponse>();
    expect(list.twists[0]?.model?.id).toBe(fileId);
    // The bytes are served like any kept file.
    const bytes = await request(`/api/files/${fileId}`, { cookie });
    expect(bytes.status).toBe(200);
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(STL);
  });

  it("is sliced and re-sliced through the file's own routes, and says so in the change feed", async () => {
    const id = await twist();
    const fileId = uuid();
    await put(id, fileId);
    const sliced = await request(`/api/files/${fileId}/sliced`, { method: "PUT", body: slicedForm(), cookie });
    expect(sliced.status).toBe(200);
    expect((await model(id))?.slice?.status).toBe("sliced");
    expect((await model(id))?.hasThumb).toBe(true);
    const patched = await request(`/api/files/${fileId}`, { method: "PATCH", cookie, json: { slicing: null } });
    expect(patched.status).toBe(200);
    const feed = await (await request("/api/changes?after=0", { cookie })).json<{ changes: Change[] }>();
    expect(feed.changes.filter((c) => c.entity === "twist" && c.id === id).length).toBeGreaterThan(1);
    const sliceBytes = await request(`/api/files/${fileId}/sliced`, { cookie });
    expect(sliceBytes.status).toBe(200);
  });

  it("keeps one model: a new one takes the place of the one before", async () => {
    const id = await twist();
    const first = uuid();
    const second = uuid();
    await put(id, first);
    await put(id, second, modelForm("fusilli-knob, 84 %.stl"));
    expect((await model(id))?.id).toBe(second);
    // The first is no longer served; bringing it back (the undo) makes way for the second.
    expect((await request(`/api/files/${first}`, { cookie })).status).toBe(404);
    const back = await request(`/api/twists/${id}/file/${first}/restore`, { method: "POST", cookie });
    expect(back.status).toBe(200);
    expect((await model(id))?.id).toBe(first);
  });

  it("removes the model with an undo, and refuses what isn't a model", async () => {
    const id = await twist();
    const fileId = uuid();
    await put(id, fileId);
    expect((await request(`/api/twists/${id}/file/${fileId}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await model(id)).toBeNull();
    expect((await request(`/api/twists/${id}/file/${fileId}/restore`, { method: "POST", cookie })).status).toBe(200);
    expect(await model(id)).toMatchObject({ id: fileId });
    // A restore that finds nothing leaves the model there.
    expect((await request(`/api/twists/${id}/file/${uuid()}/restore`, { method: "POST", cookie })).status).toBe(404);
    expect(await model(id)).toMatchObject({ id: fileId });
    expect((await put(id, uuid(), modelForm("a.3mf", "slicer"))).status).toBe(400);
    expect((await put(uuid(), uuid())).status).toBe(404);
  });

  it("does not take a file that belongs to another twist, or an agent's token", async () => {
    const one = await twist();
    const two = await twist();
    const fileId = uuid();
    await put(one, fileId);
    expect((await put(two, fileId)).status).toBe(409);
    const anonymous = await request(`/api/twists/${one}/file/${uuid()}`, { method: "PUT", body: modelForm() });
    expect(anonymous.status).toBe(401);
  });

  it("is purged with its twist, bytes and all", async () => {
    const id = await twist();
    const fileId = uuid();
    await put(id, fileId);
    await request(`/api/twists/${id}`, { method: "DELETE", cookie });
    expect(await env.PHOTOS.head(fileKey(fileId, "file"))).not.toBeNull();
    await purgeDeleted(env, Date.now() + PURGE_AFTER_MS + 60_000);
    expect(await env.PHOTOS.head(fileKey(fileId, "file"))).toBeNull();
    const row = await env.DB.prepare("SELECT id FROM twist_files WHERE id = ?").bind(fileId).first();
    expect(row).toBeNull();
  });
});
