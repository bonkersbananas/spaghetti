import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentScope, NewTokenResponse } from "../../src/shared/agents.ts";
import type { ItemFileResponse, ItemResponse, ItemsResponse } from "../../src/shared/api.ts";
import type { Change } from "../../src/shared/changes.ts";
import { PURGE_AFTER_MS, purgeDeleted } from "../../src/worker/photos.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let alex: string;
let cookie: string;
let samCookie: string;

beforeEach(async () => {
  await resetDb();
  alex = await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  await addUser("sam", "battery staple", "Sam Lund", "basil");
  cookie = await signIn("alex", "correct horse");
  samCookie = await signIn("sam", "battery staple");
});

const uuid = () => crypto.randomUUID();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function idea(body: Record<string, unknown> = {}) {
  const response = await request("/api/items", { method: "POST", cookie, json: { id: uuid(), note: "x", ...body } });
  expect(response.status).toBe(201);
  return (await response.json<ItemResponse>()).item;
}

function form(options: { bytes?: Uint8Array | null; name?: string; thumb?: boolean } = {}) {
  const bytes = options.bytes === undefined ? new Uint8Array([0x50, 0x4b, 3, 4]) : options.bytes;
  const body = new FormData();
  body.set("name", options.name ?? "Bin.gcode.3mf");
  body.set("size", String(bytes?.length ?? 0));
  body.set("plate", "1");
  body.set("plateCount", "2");
  body.set("slicer", "BambuStudio 02.01.00.00");
  body.set("prefill", JSON.stringify({ estimatedMinutes: 75 }));
  if (bytes) body.set("file", new File([bytes], options.name ?? "Bin.gcode.3mf"));
  if (options.thumb !== false) body.set("thumb", new File([PNG], "plate_1.png", { type: "image/png" }));
  return body;
}

const put = (itemId: string, fileId: string, body = form(), as = cookie) =>
  request(`/api/items/${itemId}/files/${fileId}`, { method: "PUT", body, cookie: as });

async function itemOf(id: string) {
  return (await (await request(`/api/items/${id}`, { cookie })).json<ItemResponse>()).item;
}

describe("files on an idea", () => {
  it("keeps several, lists them on the idea, and serves their bytes and picture", async () => {
    const item = await idea();
    const first = uuid();
    const second = uuid();
    const saved = await put(item.id, first);
    expect(saved.status).toBe(201);
    expect((await saved.json<ItemFileResponse>()).file).toMatchObject({
      id: first,
      name: "Bin.gcode.3mf",
      stored: true,
      hasThumb: true,
      plateCount: 2,
      prefill: { estimatedMinutes: 75 },
    });
    expect((await put(item.id, second, form({ name: "Bin.3mf" }))).status).toBe(201);
    // The same id again changes it; it isn't a second file.
    expect((await put(item.id, first)).status).toBe(200);
    const got = await itemOf(item.id);
    expect(got.files?.map((file) => file.id)).toEqual([first, second]);
    const list = (await (await request("/api/items", { cookie })).json<ItemsResponse>()).items;
    expect(list.find((i) => i.id === item.id)?.files).toHaveLength(2);

    const bytes = await request(`/api/files/${first}`, { cookie });
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get("content-disposition")).toContain("Bin.gcode.3mf");
    expect([...new Uint8Array(await bytes.arrayBuffer())]).toEqual([0x50, 0x4b, 3, 4]);
    expect((await request(`/api/files/${first}/thumb`, { cookie })).status).toBe(200);
    expect((await request(`/api/files/${first}`)).status).toBe(401);
  });

  it("lets both people add and remove, and records every write in the feed", async () => {
    const item = await idea();
    const id = uuid();
    expect((await put(item.id, id, form(), samCookie)).status).toBe(201);
    const del = await request(`/api/items/${item.id}/files/${id}`, { method: "DELETE", cookie });
    expect(del.status).toBe(204);
    expect((await itemOf(item.id)).files).toEqual([]);
    expect((await request(`/api/files/${id}`, { cookie })).status).toBe(404);
    expect((await request(`/api/items/${item.id}/files/${id}`, { method: "DELETE", cookie })).status).toBe(404);
    const back = await request(`/api/items/${item.id}/files/${id}/restore`, { method: "POST", cookie: samCookie });
    expect(back.status).toBe(200);
    expect((await itemOf(item.id)).files).toHaveLength(1);
    expect((await request(`/api/items/${item.id}/files/${id}/restore`, { method: "POST", cookie })).status).toBe(404);

    const feed = await (await request("/api/changes?after=0", { cookie })).json<{ changes: Change[] }>();
    const file = feed.changes.filter((change) => change.entity === "file");
    expect(file.map((change) => [change.action, change.id, change.itemId])).toEqual([
      ["created", id, item.id],
      ["deleted", id, item.id],
      ["restored", id, item.id],
    ]);
  });

  it("keeps only what it said for a file over the cap, and refuses what it can't use", async () => {
    const item = await idea();
    const id = uuid();
    const big = form({ bytes: null });
    big.set("size", String(30 * 1024 * 1024));
    const saved = await put(item.id, id, big);
    expect(saved.status).toBe(201);
    expect((await saved.json<ItemFileResponse>()).file.stored).toBe(false);
    expect((await request(`/api/files/${id}`, { cookie })).status).toBe(404);
    expect((await put(item.id, "not-a-uuid")).status).toBe(400);
    expect((await put(uuid(), uuid())).status).toBe(404);
    const bad = form();
    bad.set("thumb", new File([PNG], "x.txt", { type: "text/plain" }));
    expect((await put(item.id, uuid(), bad)).status).toBe(415);
    const other = await idea();
    expect((await put(other.id, id)).status).toBe(409);
  });

  it("stays with the item when it becomes a build, and goes when the item is deleted", async () => {
    const item = await idea();
    const id = uuid();
    await put(item.id, id);
    const moved = await request(`/api/items/${item.id}`, { method: "PATCH", cookie, json: { stage: "building" } });
    expect(moved.status).toBe(200);
    expect((await itemOf(item.id)).files?.map((file) => file.id)).toEqual([id]);
    await request(`/api/items/${item.id}`, { method: "DELETE", cookie });
    expect((await request(`/api/files/${id}`, { cookie })).status).toBe(404);
  });

  it("purges a removed file's bytes after the grace period, and leaves the others", async () => {
    const item = await idea();
    const gone = uuid();
    const kept = uuid();
    await put(item.id, gone);
    await put(item.id, kept);
    await request(`/api/items/${item.id}/files/${gone}`, { method: "DELETE", cookie });
    await purgeDeleted(env, Date.now() + PURGE_AFTER_MS + 60_000);
    expect(await env.PHOTOS.get(`files/${gone}/file`)).toBeNull();
    expect(await env.PHOTOS.get(`files/${kept}/file`)).not.toBeNull();
    const rows = await env.DB.prepare("SELECT id FROM item_files").all<{ id: string }>();
    expect(rows.results.map((row) => row.id)).toEqual([kept]);
  });
});

describe("files on an idea, for agents", () => {
  async function token(scopes: AgentScope[]) {
    const made = await request("/api/agents", { method: "POST", cookie, json: { name: "Claude", scopes } });
    return (await made.json<NewTokenResponse>()).token;
  }
  const asAgent = (token: string, path: string, init: RequestInit = {}) =>
    request(path, { ...init, headers: { Authorization: `Bearer ${token}`, Origin: "http://other.test" } });

  it("lets capture and attempts add one, read can only read, and removing is for people", async () => {
    const item = await idea();
    const id = uuid();
    const url = (fileId: string) => `/api/items/${item.id}/files/${fileId}`;
    expect((await asAgent(await token(["read"]), url(id), { method: "PUT", body: form() })).status).toBe(403);
    expect((await asAgent(await token(["printer"]), url(id), { method: "PUT", body: form() })).status).toBe(403);
    expect((await asAgent(await token(["capture"]), url(id), { method: "PUT", body: form() })).status).toBe(201);
    expect((await asAgent(await token(["attempts"]), url(uuid()), { method: "PUT", body: form() })).status).toBe(201);
    const all = await token(["read", "capture", "attempts", "printer"]);
    expect((await asAgent(all, url(id), { method: "DELETE" })).status).toBe(403);
    expect((await asAgent(all, `${url(id)}/restore`, { method: "POST" })).status).toBe(403);
    const read = await asAgent(await token(["read"]), `/api/items/${item.id}`);
    expect((await read.json<ItemResponse>()).item.files).toHaveLength(2);
    const change = await env.DB.prepare(
      "SELECT actor_kind AS kind, actor_id AS id FROM changes WHERE entity = 'file'",
    ).first();
    expect(change).toMatchObject({ kind: "agent" });
    expect(alex).toBeTruthy();
  });
});
