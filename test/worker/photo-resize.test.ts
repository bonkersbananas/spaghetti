import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type { ItemResponse, PhotoResponse, ResizeClaimResponse } from "../../src/shared/api.ts";
import type { ChangesResponse } from "../../src/shared/changes.ts";
import { CLAIM_FOR_MS } from "../../src/worker/routes/photos.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

const uuid = () => crypto.randomUUID();

async function createItem() {
  const id = uuid();
  const response = await request("/api/items", { method: "POST", cookie, json: { id, note: "idea" } });
  expect(response.status).toBe(201);
  return id;
}

/** An upload the way a browser makes it (resized, with its real colour) or an agent (the original, flagged). */
function upload(
  itemId: string,
  photoId: string,
  options: { unresized?: boolean; token?: string; bytes?: number[]; color?: string } = {},
) {
  const form = new FormData();
  form.set("width", options.unresized ? "4000" : "2048");
  form.set("height", options.unresized ? "3000" : "1536");
  form.set("color", options.color ?? (options.unresized ? "#a9a095" : "#336699"));
  if (options.unresized) form.set("needsResize", "1");
  const bytes = new Uint8Array(options.bytes ?? [1, 2, 3, 4]);
  form.set("large", new File([bytes], "large.webp", { type: "image/webp" }));
  form.set("thumb", new File([bytes], "thumb.webp", { type: "image/webp" }));
  return request(`/api/items/${itemId}/photos/${photoId}`, {
    method: "PUT",
    body: form,
    ...(options.token ? { headers: { Authorization: `Bearer ${options.token}` } } : { cookie }),
  });
}

const photoOf = async (itemId: string, photoId: string) =>
  (await (await request(`/api/items/${itemId}`, { cookie })).json<ItemResponse>()).item.photos.find(
    (photo) => photo.id === photoId,
  );

const feedAfter = async (cursor: number) =>
  (await (await request(`/api/changes?after=${cursor}`, { cookie })).json<ChangesResponse>()).changes;
const cursorNow = async () => (await (await request("/api/changes", { cookie })).json<ChangesResponse>()).cursor;

describe("photos that arrive without a browser", () => {
  it("are flagged, with their placeholder colour, and served without the forever cache", async () => {
    const itemId = await createItem();
    const photoId = uuid();
    expect((await upload(itemId, photoId, { unresized: true, bytes: [9, 9, 9, 9, 9, 9] })).status).toBe(201);
    expect(await photoOf(itemId, photoId)).toMatchObject({
      needsResize: true,
      color: "#a9a095",
      width: 4000,
      height: 3000,
    });
    for (const variant of ["thumb", "large"]) {
      const served = await request(`/api/photos/${photoId}/${variant}`, { cookie });
      expect(served.status).toBe(200);
      expect(served.headers.get("Cache-Control")).toBe("private, no-cache");
      expect((await served.arrayBuffer()).byteLength).toBe(6);
    }
    // An ordinary photo is flagged by nothing, and cached for good.
    const normal = uuid();
    await upload(itemId, normal);
    expect(await photoOf(itemId, normal)).toMatchObject({ needsResize: false });
    expect((await request(`/api/photos/${normal}/thumb`, { cookie })).headers.get("Cache-Control")).toContain(
      "immutable",
    );
  });

  it("are flagged when an agent captures one through MCP", async () => {
    const agent = await (
      await request("/api/agents", { method: "POST", cookie, json: { name: "Claude", scopes: ["read", "capture"] } })
    ).json<NewTokenResponse>();
    const jpeg = btoa(
      String.fromCharCode(
        0xff,
        0xd8,
        0xff,
        0xc0,
        0,
        0x11,
        8,
        0x04,
        0xb0,
        0x06,
        0x40,
        3,
        1,
        0x22,
        0,
        2,
        0x11,
        1,
        3,
        0x11,
        1,
      ),
    );
    const response = await request("/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${agent.token}` },
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "capture_idea", arguments: { note: "With a photo", photo_base64: jpeg } },
      },
    });
    const text =
      ((await response.json()) as { result: { content: Array<{ text: string }> } }).result.content[0]?.text ?? "";
    const itemId = /build_id: ([0-9a-f-]{36})/.exec(text)?.[1] ?? "";
    const item = (await (await request(`/api/items/${itemId}`, { cookie })).json<ItemResponse>()).item;
    expect(item.photos[0]).toMatchObject({ needsResize: true, width: 1600, height: 1200 });
  });
});

describe("the browser's replacement", () => {
  it("swaps in the real variants and the real colour, clears the flag, and says so in the feed", async () => {
    const itemId = await createItem();
    const photoId = uuid();
    await upload(itemId, photoId, { unresized: true, bytes: [9, 9, 9, 9, 9, 9, 9, 9] });
    const before = await cursorNow();

    const replaced = await upload(itemId, photoId, { bytes: [7, 7], color: "#336699" });
    expect(replaced.status).toBe(200);
    expect((await replaced.json<PhotoResponse>()).photo).toMatchObject({
      needsResize: false,
      color: "#336699",
      width: 2048,
      height: 1536,
    });
    expect(await photoOf(itemId, photoId)).toMatchObject({ needsResize: false, color: "#336699" });

    // The bytes are the resized ones, and cached for good again.
    const thumb = await request(`/api/photos/${photoId}/thumb`, { cookie });
    expect((await thumb.arrayBuffer()).byteLength).toBe(2);
    expect(thumb.headers.get("Cache-Control")).toContain("immutable");
    expect((await (await env.PHOTOS.get(`photos/${photoId}/large`))?.arrayBuffer())?.byteLength).toBe(2);
    expect(
      (
        await env.DB.prepare("SELECT resize_claimed_at AS at FROM photos WHERE id = ?")
          .bind(photoId)
          .first<{ at: number | null }>()
      )?.at,
    ).toBeNull();

    const feed = await feedAfter(before);
    expect(feed.map((change) => [change.entity, change.action, change.id, change.itemId])).toEqual([
      ["photo", "updated", photoId, itemId],
    ]);
  });

  it("is harmless to race: the second write finds nothing to flag, and a late original doesn't undo it", async () => {
    const itemId = await createItem();
    const photoId = uuid();
    await upload(itemId, photoId, { unresized: true, bytes: [9, 9, 9, 9, 9, 9] });
    await upload(itemId, photoId, { bytes: [7, 7], color: "#336699" });
    const before = await cursorNow();

    // A second browser finishing the same job: same result, nothing new to say.
    expect((await upload(itemId, photoId, { bytes: [7, 7], color: "#336699" })).status).toBe(200);
    expect(await photoOf(itemId, photoId)).toMatchObject({ needsResize: false, color: "#336699" });
    // The agent retrying its original upload after the browser replaced it: the browser's copy stays.
    expect((await upload(itemId, photoId, { unresized: true, bytes: [9, 9, 9, 9, 9, 9] })).status).toBe(200);
    expect(await photoOf(itemId, photoId)).toMatchObject({ needsResize: false, color: "#336699", width: 2048 });
    expect((await (await request(`/api/photos/${photoId}/thumb`, { cookie })).arrayBuffer()).byteLength).toBe(2);
    expect(await feedAfter(before)).toEqual([]);
  });
});

describe("claiming the job", () => {
  async function claim(photoId: string, as = cookie) {
    return request(`/api/photos/${photoId}/resize-claim`, { method: "POST", cookie: as });
  }

  it("goes to one browser at a time, lapses, and ends with the resize", async () => {
    const itemId = await createItem();
    const photoId = uuid();
    await upload(itemId, photoId, { unresized: true });
    const before = await cursorNow();
    expect((await (await claim(photoId)).json<ResizeClaimResponse>()).claimed).toBe(true);
    expect((await (await claim(photoId)).json<ResizeClaimResponse>()).claimed).toBe(false);
    // Not a change anyone sees.
    expect(await feedAfter(before)).toEqual([]);
    // A claim that never finished lapses.
    await env.DB.prepare("UPDATE photos SET resize_claimed_at = ? WHERE id = ?")
      .bind(Date.now() - CLAIM_FOR_MS - 1000, photoId)
      .run();
    expect((await (await claim(photoId)).json<ResizeClaimResponse>()).claimed).toBe(true);
    await upload(itemId, photoId, { bytes: [7, 7] });
    // Nothing left to claim.
    expect((await (await claim(photoId)).json<ResizeClaimResponse>()).claimed).toBe(false);
    expect((await claim(uuid())).status).toBe(404);
  });

  it("is for signed-in people: not signed out, not an agent", async () => {
    const itemId = await createItem();
    const photoId = uuid();
    await upload(itemId, photoId, { unresized: true });
    expect((await request(`/api/photos/${photoId}/resize-claim`, { method: "POST" })).status).toBe(401);
    const agent = await (
      await request("/api/agents", {
        method: "POST",
        cookie,
        json: { name: "A", scopes: ["read", "capture", "attempts", "printer"] },
      })
    ).json<NewTokenResponse>();
    const refused = await request(`/api/photos/${photoId}/resize-claim`, {
      method: "POST",
      headers: { Authorization: `Bearer ${agent.token}` },
    });
    expect(refused.status).toBe(403);
  });
});
