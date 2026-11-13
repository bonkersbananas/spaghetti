import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import {
  type ItemFileResponse,
  type ItemResponse,
  MAX_MODEL_FILE_BYTES,
  MAX_SLICER_FILE_BYTES,
  type StartUploadResponse,
  UPLOAD_PART_BYTES,
} from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

/** Big files in parts (decision 0048): R2 multipart uploads through the Worker. */

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

const uuid = () => crypto.randomUUID();
const MIB = 1024 * 1024;

/** Bytes that differ from part to part, so a part in the wrong place shows. */
const bytesOf = (length: number, seed: number) => {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 4096) bytes[i] = (i / 4096 + seed) % 251;
  return bytes;
};

async function idea() {
  const response = await request("/api/items", { method: "POST", cookie, json: { id: uuid(), note: "x" } });
  return (await response.json<ItemResponse>()).item;
}

async function start(id: string, size: number, extra: Record<string, unknown> = {}, as = cookie) {
  return request("/api/uploads", {
    method: "POST",
    cookie: as,
    json: { id, part: "file", kind: "model", name: "Big.stl", size, ...extra },
  });
}

const partPath = (id: string, uploadId: string, n: number, part = "file") =>
  `/api/uploads/${id}/${part}/${encodeURIComponent(uploadId)}/${n}`;

async function sendPart(id: string, uploadId: string, n: number, bytes: Uint8Array, part = "file") {
  return request(partPath(id, uploadId, n, part), { method: "PUT", cookie, body: bytes });
}

const complete = (id: string, uploadId: string, size: number, parts: { n: number; etag: string }[], part = "file") =>
  request(`/api/uploads/${id}/${part}/${encodeURIComponent(uploadId)}/complete`, {
    method: "POST",
    cookie,
    json: { size, parts },
  });

function rowForm(size: number, uploaded = true) {
  const body = new FormData();
  body.set("name", "Big.stl");
  body.set("size", String(size));
  body.set("plate", "1");
  body.set("plateCount", "1");
  body.set("prefill", "{}");
  body.set("kind", "model");
  if (uploaded) body.set("uploaded", "1");
  return body;
}

describe("uploads in parts", () => {
  it("keeps a file sent in two parts, byte for byte, once its row is saved", async () => {
    const item = await idea();
    const id = uuid();
    const first = bytesOf(UPLOAD_PART_BYTES, 1);
    const last = bytesOf(3 * MIB, 7);
    const size = first.length + last.length;

    const started = await start(id, size);
    expect(started.status).toBe(201);
    const { uploadId, partSize } = await started.json<StartUploadResponse>();
    expect(partSize).toBe(UPLOAD_PART_BYTES);

    const one = await (await sendPart(id, uploadId, 1, first)).json<{ etag: string }>();
    // A part sent again (a retry) replaces itself.
    const again = await (await sendPart(id, uploadId, 1, first)).json<{ etag: string }>();
    const two = await (await sendPart(id, uploadId, 2, last)).json<{ etag: string }>();

    // Not there until it is complete.
    expect(await env.PHOTOS.head(`files/${id}/file`)).toBeNull();
    const done = await complete(id, uploadId, size, [
      { n: 2, etag: two.etag },
      { n: 1, etag: again.etag || one.etag },
    ]);
    expect(done.status).toBe(200);
    // A lost answer, asked again, is still fine.
    expect((await complete(id, uploadId, size, [])).status).toBe(400);
    expect(
      (
        await complete(id, uploadId, size, [
          { n: 1, etag: again.etag },
          { n: 2, etag: two.etag },
        ])
      ).status,
    ).toBe(200);

    // No row yet: not served.
    expect((await request(`/api/files/${id}`, { cookie })).status).toBe(404);
    const saved = await request(`/api/items/${item.id}/files/${id}`, { method: "PUT", body: rowForm(size), cookie });
    expect(saved.status).toBe(201);
    expect((await saved.json<ItemFileResponse>()).file).toMatchObject({ id, size, stored: true, kind: "model" });

    const download = await request(`/api/files/${id}`, { cookie });
    expect(download.status).toBe(200);
    expect(download.headers.get("Content-Type")).toBe("model/stl");
    const body = new Uint8Array(await download.arrayBuffer());
    expect(body.length).toBe(size);
    expect(body.subarray(0, first.length).every((b, i) => b === first[i])).toBe(true);
    expect(body.subarray(first.length).every((b, i) => b === last[i])).toBe(true);
  });

  it("refuses a row whose bytes are missing or a different size", async () => {
    const item = await idea();
    const id = uuid();
    const missing = await request(`/api/items/${item.id}/files/${id}`, {
      method: "PUT",
      body: rowForm(40 * MIB),
      cookie,
    });
    expect(missing.status).toBe(409);
    expect((await missing.json<{ error: { code: string } }>()).error.code).toBe("upload_incomplete");

    const { uploadId } = await (await start(id, 6 * MIB)).json<StartUploadResponse>();
    const part = await (await sendPart(id, uploadId, 1, bytesOf(6 * MIB, 3))).json<{ etag: string }>();
    // Said to be bigger than it is: the upload is removed again.
    expect((await complete(id, uploadId, 7 * MIB, [{ n: 1, etag: part.etag }])).status).toBe(409);
    expect(await env.PHOTOS.head(`files/${id}/file`)).toBeNull();
    // A row with no upload at all, and a plain model with no bytes either, is refused.
    expect(
      (await request(`/api/items/${item.id}/files/${uuid()}`, { method: "PUT", body: rowForm(5, false), cookie }))
        .status,
    ).toBe(400);
  });

  it("aborts an upload, refuses its parts after, and refuses sizes over the cap and parts over the part size", async () => {
    const id = uuid();
    expect((await start(id, MAX_MODEL_FILE_BYTES + 1)).status).toBe(413);
    expect((await start(id, MAX_SLICER_FILE_BYTES + 1, { kind: "slicer" })).status).toBe(413);
    expect((await start(id, 0)).status).toBe(400);
    expect((await start(id, 10 * MIB, { part: "other" })).status).toBe(400);
    // 250 MB is the cap, exactly.
    expect((await start(id, MAX_MODEL_FILE_BYTES)).status).toBe(201);

    const { uploadId } = await (await start(id, 40 * MIB)).json<StartUploadResponse>();
    expect((await sendPart(id, uploadId, 1, new Uint8Array(UPLOAD_PART_BYTES + 1))).status).toBe(413);
    expect((await sendPart(id, uploadId, 0, new Uint8Array(10))).status).toBe(400);
    expect((await sendPart(id, uploadId, 9999, new Uint8Array(10))).status).toBe(400);
    expect((await sendPart(id, uploadId, 1, new Uint8Array(6 * MIB))).status).toBe(200);
    const aborted = await request(`/api/uploads/${id}/file/${encodeURIComponent(uploadId)}`, {
      method: "DELETE",
      cookie,
    });
    expect(aborted.status).toBe(204);
    expect((await sendPart(id, uploadId, 2, new Uint8Array(6 * MIB))).status).toBe(404);
    expect(await env.PHOTOS.head(`files/${id}/file`)).toBeNull();
  });

  it("is for signed-in callers; a token needs capture or attempts, and only people send a sliced file", async () => {
    expect((await request("/api/uploads", { method: "POST", json: {} })).status).toBe(401);
    const item = await idea();
    const id = uuid();
    const saved = await request(`/api/items/${item.id}/files/${id}`, {
      method: "PUT",
      cookie,
      body: (() => {
        const body = rowForm(5, false);
        body.set("file", new File([new Uint8Array(5)], "Big.stl"));
        return body;
      })(),
    });
    expect(saved.status).toBe(201);

    const made = await request("/api/agents", {
      method: "POST",
      cookie,
      json: { name: "Claude", scopes: ["read", "capture"] },
    });
    const { token } = await made.json<NewTokenResponse>();
    const asAgent = (path: string, json: unknown) =>
      request(path, {
        method: "POST",
        json,
        headers: { Authorization: `Bearer ${token}`, Origin: "http://other.test" },
      });
    expect(
      (await asAgent("/api/uploads", { id: uuid(), part: "file", kind: "model", name: "a.stl", size: 9 })).status,
    ).toBe(201);
    expect((await asAgent("/api/uploads", { id, part: "sliced", kind: "model", name: "a.stl", size: 9 })).status).toBe(
      403,
    );

    const readOnly = await request("/api/agents", {
      method: "POST",
      cookie,
      json: { name: "Reader", scopes: ["read"] },
    });
    const reader = (await readOnly.json<NewTokenResponse>()).token;
    const denied = await request("/api/uploads", {
      method: "POST",
      json: { id: uuid(), part: "file", kind: "model", name: "a.stl", size: 9 },
      headers: { Authorization: `Bearer ${reader}`, Origin: "http://other.test" },
    });
    expect(denied.status).toBe(403);

    // A person sends a model's sliced file in parts; only for a model that is there.
    expect((await start(uuid(), 9, { part: "sliced" })).status).toBe(404);
    const sliced = await start(id, 9 * MIB, { part: "sliced" });
    expect(sliced.status).toBe(201);
    const { uploadId } = await sliced.json<StartUploadResponse>();
    const part = await (await sendPart(id, uploadId, 1, new Uint8Array(9 * MIB), "sliced")).json<{ etag: string }>();
    expect((await complete(id, uploadId, 9 * MIB, [{ n: 1, etag: part.etag }], "sliced")).status).toBe(200);
    const head = await env.PHOTOS.head(`files/${id}/sliced`);
    expect(head?.size).toBe(9 * MIB);
    expect(head?.httpMetadata?.contentType).toBe("application/vnd.ms-package.3dmanufacturing-3dmodel+xml");
  });
});
