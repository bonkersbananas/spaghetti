import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import TEMPLATE from "../../guest.html?raw";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type { ItemResponse, TwistResponse } from "../../src/shared/api.ts";
import type { ShareResponse, SharesResponse } from "../../src/shared/shares.ts";
import { guestRoute } from "../../src/worker/guest/index.tsx";
import { hashShareToken } from "../../src/worker/shares.ts";
import { ascii, be16, cameraJpeg, ICC, le32, safariJpeg, withSegments } from "../support/photo-fixtures.ts";
import { addUser, ORIGIN, request, resetDb, signIn } from "./helpers.ts";

/**
 * Public links (decision 0075): the two people make and stop them; a guest with a link sees that one thing, read-only,
 * and nothing else. These tests try to get more out of a link than it gives.
 */

const stub = {
  ...env,
  ASSETS: { fetch: async () => new Response(TEMPLATE, { headers: { "Content-Type": "text/html" } }) },
} as unknown as Env;

let cookie = "";
const uuid = () => crypto.randomUUID();

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  await addUser("sam", "battery staple", "Sam Lund", "basil");
  cookie = await signIn("alex", "correct horse");
});

/** A guest's request: no cookie, as a browser opening the link would send it. */
async function guest(path: string, init: RequestInit = {}) {
  const response = await guestRoute(new Request(`${ORIGIN}${path}`, init), stub);
  return { response, html: response.headers.get("Content-Type")?.startsWith("text/html") ? await response.text() : "" };
}

async function createItem(body: Record<string, unknown> = {}) {
  const response = await request("/api/items", { method: "POST", json: { id: uuid(), ...body }, cookie });
  expect(response.status).toBe(201);
  return (await response.json<ItemResponse>()).item;
}

async function share(kind: "items" | "twists", id: string, as = cookie) {
  const response = await request(`/api/shares/${kind}/${id}`, { method: "PUT", cookie: as });
  expect([200, 201]).toContain(response.status);
  return (await response.json<ShareResponse>()).share;
}

// ---- Photo bytes: the smallest JPEG and WebP containers the metadata check reads. ----

/** A JPEG: SOI, JFIF, optionally an EXIF block with a GPS position, then image data and EOI. */
function jpeg({ exif = false }: { exif?: boolean } = {}) {
  const app0 = [0xff, 0xe0, ...be16(16), ...ascii("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const exifBody = [...ascii("Exif\0\0"), ...ascii("MM\0*"), ...ascii("GPSLatitude 59.3293 N GPSLongitude 18.0686 E")];
  const app1 = exif ? [0xff, 0xe1, ...be16(exifBody.length + 2), ...exifBody] : [];
  const sos = [0xff, 0xda, ...be16(8), 1, 1, 0, 0, 0x3f, 0];
  return new Uint8Array([0xff, 0xd8, ...app0, ...app1, ...sos, 0x12, 0x34, 0x56, 0x78, 0xff, 0xd9]);
}

/** A WebP: RIFF, a VP8 chunk, and optionally an EXIF chunk. */
function webp({ exif = false }: { exif?: boolean } = {}) {
  const chunk = (name: string, body: number[]) => [
    ...ascii(name),
    ...le32(body.length),
    ...body,
    ...(body.length % 2 ? [0] : []),
  ];
  const body = [
    ...ascii("WEBP"),
    ...chunk("VP8 ", [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 1, 0, 1, 0]),
    ...(exif ? chunk("EXIF", ascii("MM\0*GPSLatitude 59.3293")) : []),
  ];
  return new Uint8Array([...ascii("RIFF"), ...le32(body.length), ...body]);
}

/** Uploads a photo the way the browser does, with real container bytes (or what an agent sends, unresized). */
async function addPhoto(
  itemId: string,
  options: { bytes?: Uint8Array; type?: string; attemptId?: string; unresized?: boolean; as?: string } = {},
) {
  const id = uuid();
  const bytes = options.bytes ?? webp();
  const type = options.type ?? "image/webp";
  const form = new FormData();
  form.set("width", "2048");
  form.set("height", "1536");
  form.set("color", "#a08060");
  if (options.attemptId) form.set("attemptId", options.attemptId);
  if (options.unresized) form.set("needsResize", "1");
  form.set("large", new File([bytes], "large", { type }));
  form.set("thumb", new File([bytes], "thumb", { type }));
  const response = await request(`/api/items/${itemId}/photos/${id}`, {
    method: "PUT",
    body: form,
    cookie: options.as ?? cookie,
  });
  expect(response.status).toBe(201);
  return id;
}

async function addAttempt(itemId: string, body: Record<string, unknown> = {}) {
  const id = uuid();
  const response = await request(`/api/items/${itemId}/attempts`, { method: "POST", json: { id, ...body }, cookie });
  expect(response.status).toBe(201);
  return id;
}

describe("making and stopping a link", () => {
  it("makes one link per thing, lists it, stops it at once and brings the same one back", async () => {
    const item = await createItem({ title: "Cable clip" });
    const first = await request(`/api/shares/items/${item.id}`, { method: "PUT", cookie });
    expect(first.status).toBe(201);
    const made = (await first.json<ShareResponse>()).share;
    expect(made.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(made).toMatchObject({ kind: "item", targetId: item.id });

    // Again (a retry, or the other person at the same time): the same link.
    const again = await request(`/api/shares/items/${item.id}`, { method: "PUT", cookie });
    expect(again.status).toBe(200);
    expect((await again.json<ShareResponse>()).share.token).toBe(made.token);
    const samCookie = await signIn("sam", "battery staple");
    expect((await share("items", item.id, samCookie)).token).toBe(made.token);

    const listed = await (await request("/api/shares", { cookie })).json<SharesResponse>();
    expect(listed.shares.map((s) => s.token)).toEqual([made.token]);

    expect((await guest(`/s/${made.token}`)).response.status).toBe(200);
    expect((await request(`/api/shares/${made.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await guest(`/s/${made.token}`)).response.status).toBe(404);
    expect((await (await request("/api/shares", { cookie })).json<SharesResponse>()).shares).toEqual([]);

    // Undo: the very same address works again.
    const restored = await request(`/api/shares/${made.id}/restore`, { method: "POST", cookie });
    expect(restored.status).toBe(200);
    expect((await restored.json<ShareResponse>()).share.token).toBe(made.token);
    expect((await guest(`/s/${made.token}`)).response.status).toBe(200);
  });

  it("gives a new token to a link made after one was stopped, and keeps the old one stopped", async () => {
    const item = await createItem({ title: "Hook" });
    const old = await share("items", item.id);
    await request(`/api/shares/${old.id}`, { method: "DELETE", cookie });
    const fresh = await share("items", item.id);
    expect(fresh.token).not.toBe(old.token);
    expect((await guest(`/s/${old.token}`)).response.status).toBe(404);
    expect((await guest(`/s/${fresh.token}`)).response.status).toBe(200);
    // The old link's Undo can't bring back a second live link.
    expect((await request(`/api/shares/${old.id}/restore`, { method: "POST", cookie })).status).toBe(409);
    expect((await guest(`/s/${old.token}`)).response.status).toBe(404);
  });

  it("stores the token's SHA-256 to look it up by, with 144 random bits in the token", async () => {
    const item = await createItem({ title: "Hook" });
    const made = await share("items", item.id);
    const row = await env.DB.prepare("SELECT token_hash FROM shares WHERE id = ?")
      .bind(made.id)
      .first<{ token_hash: string }>();
    expect(row?.token_hash).toBe(await hashShareToken(made.token));
    expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    const bytes = atob(made.token.replace(/-/g, "+").replace(/_/g, "/"));
    expect(bytes.length * 8).toBeGreaterThanOrEqual(128);
  });

  it("records a change only for a link really made, stopped or brought back", async () => {
    const feed = async () =>
      (
        await env.DB.prepare("SELECT action FROM changes WHERE entity = 'share' ORDER BY seq").all<{ action: string }>()
      ).results.map((row) => row.action);
    const item = await createItem({ title: "Hook" });
    const made = await share("items", item.id);
    // Asked again, the live link answers: the insert did nothing, so nothing is recorded.
    await share("items", item.id);
    expect(await feed()).toEqual(["created"]);
    // An unknown id is a 404 with no change; a link already stopped stops once.
    expect((await request(`/api/shares/${uuid()}`, { method: "DELETE", cookie })).status).toBe(404);
    expect((await request(`/api/shares/${made.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await request(`/api/shares/${made.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await feed()).toEqual(["created", "deleted"]);
    expect((await request(`/api/shares/${made.id}/restore`, { method: "POST", cookie })).status).toBe(200);
    expect((await request(`/api/shares/${made.id}/restore`, { method: "POST", cookie })).status).toBe(200);
    expect((await request(`/api/shares/${uuid()}/restore`, { method: "POST", cookie })).status).toBe(404);
    expect(await feed()).toEqual(["created", "deleted", "restored"]);
  });

  it("can't share what isn't there", async () => {
    expect((await request(`/api/shares/items/${uuid()}`, { method: "PUT", cookie })).status).toBe(404);
    expect((await request(`/api/shares/twists/${uuid()}`, { method: "PUT", cookie })).status).toBe(404);
    expect((await request(`/api/shares/spools/${uuid()}`, { method: "PUT", cookie })).status).toBe(404);
    const item = await createItem({ title: "Gone" });
    // An object's own inherited names aren't kinds either.
    for (const kind of ["constructor", "__proto__", "toString", "hasOwnProperty"])
      expect((await request(`/api/shares/${kind}/${item.id}`, { method: "PUT", cookie })).status).toBe(404);
    await request(`/api/items/${item.id}`, { method: "DELETE", cookie });
    expect((await request(`/api/shares/items/${item.id}`, { method: "PUT", cookie })).status).toBe(404);
  });

  it("is for the two people only: an agent's token can neither see a link nor make or stop one", async () => {
    const item = await createItem({ title: "Hook" });
    const made = await share("items", item.id);
    const agent = await (
      await request("/api/agents", {
        method: "POST",
        json: { name: "Claude for Alex", scopes: ["read", "capture", "attempts", "printer"] },
        cookie,
      })
    ).json<NewTokenResponse>();
    const asAgent = (path: string, method = "GET") =>
      request(path, { method, headers: { Authorization: `Bearer ${agent.token}`, Origin: "http://other.test" } });
    expect((await asAgent("/api/shares")).status).toBe(403);
    expect((await asAgent(`/api/shares/items/${item.id}`, "PUT")).status).toBe(403);
    expect((await asAgent(`/api/shares/${made.id}`, "DELETE")).status).toBe(403);
    expect((await asAgent(`/api/shares/${made.id}/restore`, "POST")).status).toBe(403);
    // And its feed never hears of links.
    const feed = await (await asAgent("/api/changes?after=0")).json<{ changes: { entity: string }[] }>();
    expect(feed.changes.some((change) => change.entity === "share")).toBe(false);
    const own = await (await request("/api/changes?after=0", { cookie })).json<{ changes: { entity: string }[] }>();
    expect(own.changes.some((change) => change.entity === "share")).toBe(true);
  });

  it("needs a session", async () => {
    expect((await request("/api/shares")).status).toBe(401);
    expect((await request(`/api/shares/items/${uuid()}`, { method: "PUT" })).status).toBe(401);
  });
});

describe("what a guest gets", () => {
  it("shows the idea, read-only, with nothing of the people or the rest of the notebook", async () => {
    const item = await createItem({ title: "Desk cable clip", note: "Holds three cables.\n\nPrint two." });
    const photoId = await addPhoto(item.id);
    // What must not show: a comment, a reaction, who it is for, another idea.
    await request(`/api/items/${item.id}/comments`, {
      method: "POST",
      json: { id: uuid(), body: "Secret comment about the neighbours" },
      cookie,
    });
    await request(`/api/items/${item.id}/reactions/${encodeURIComponent("🔥")}`, { method: "PUT", cookie });
    await request(`/api/items/${item.id}`, { method: "PATCH", json: { forWhom: "Mila" }, cookie });
    await createItem({ title: "Another idea, private" });
    const made = await share("items", item.id);

    const { response, html } = await guest(`/s/${made.token}`);
    expect(response.status).toBe(200);
    expect(html).toContain("Desk cable clip");
    expect(html).toContain("Holds three cables.");
    expect(html).toContain(`/s/${made.token}/photos/${photoId}/thumb`);
    for (const secret of ["Secret comment", "🔥", "Mila", "Another idea", "Alex", "Sam", "alex", "/api/"]) {
      expect(html, secret).not.toContain(secret);
    }
    // No address of anyone's in what the Worker wrote (the template's font paths have an @ of their own).
    expect(html.slice(html.indexOf("<body"))).not.toContain("@");
    // Nothing to press that changes anything (an idea without models has not even a 3D view to open), and no script
    // but the page's own, from its build (decision 0077).
    expect(html.slice(html.indexOf("<body"))).not.toMatch(/<(form|button|input|textarea|select|script)\b/i);
    expect([...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0])).toEqual([
      '<script type="module" src="/src/guest/island.ts">',
    ]);
  });

  it("answers with the headers that keep the link private", async () => {
    const item = await createItem({ title: "Hook" });
    const made = await share("items", item.id);
    const { response } = await guest(`/s/${made.token}`);
    const headers = response.headers;
    expect(headers.get("X-Robots-Tag")).toMatch(/noindex/);
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Content-Security-Policy")).toMatch(/frame-ancestors 'none'/);
    expect(headers.get("Content-Security-Policy")).toMatch(/default-src 'none'/);
    // Script and workers only from the page's own build (its 3D view, decision 0077), nothing inline.
    expect(headers.get("Content-Security-Policy")).toContain(`script-src ${ORIGIN}/assets/guest/;`);
    expect(headers.get("Content-Security-Policy")).not.toMatch(/script-src[^;]*'unsafe/);
    expect(headers.get("Cache-Control")).toBe("private, no-store");
    const { html } = await guest(`/s/${made.token}`);
    expect(html).toContain('<meta name="robots"');
  });

  it("says the same kind thing for an unknown, a malformed, a stopped and a deleted link", async () => {
    const item = await createItem({ title: "Hook" });
    const stopped = await share("items", item.id);
    await request(`/api/shares/${stopped.id}`, { method: "DELETE", cookie });
    const other = await createItem({ title: "Deleted one" });
    const deleted = await share("items", other.id);
    await request(`/api/items/${other.id}`, { method: "DELETE", cookie });

    const bodies = new Set<string>();
    for (const token of [stopped.token, deleted.token, "A".repeat(24), "nope", "%3Cscript%3E", "a".repeat(200)]) {
      const { response, html } = await guest(`/s/${token}`);
      expect(response.status, token).toBe(404);
      expect(html).toContain("This isn&#39;t shared anymore");
      expect(response.headers.get("X-Robots-Tag")).toMatch(/noindex/);
      bodies.add(html);
    }
    expect(bodies.size).toBe(1);

    // Undoing the delete brings the link back with the thing.
    await request(`/api/items/${other.id}/restore`, { method: "POST", cookie });
    expect((await guest(`/s/${deleted.token}`)).response.status).toBe(200);
  });

  it("writes nothing: every other method is refused and changes nothing", async () => {
    const item = await createItem({ title: "Hook" });
    const made = await share("items", item.id);
    const before = await env.DB.prepare("SELECT count(*) AS n FROM changes").first<{ n: number }>();
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      for (const path of [`/s/${made.token}`, `/s/${made.token}/photos/${uuid()}/large`, `/s/${made.token}/comments`]) {
        const response = await request(path, { method, headers: { "Content-Type": "application/json" }, body: "{}" });
        expect(response.status, `${method} ${path}`).toBe(405);
      }
    }
    const after = await env.DB.prepare("SELECT count(*) AS n FROM changes").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
    // And the token opens nothing of the API.
    for (const path of ["/api/items", `/api/items/${item.id}`, "/api/shares", "/api/spools", "/api/journal"]) {
      const response = await request(path, { headers: { Authorization: `Bearer ${made.token}` } });
      expect(response.status, path).toBe(401);
    }
  });

  it("sends someone signed in to the thing's own page", async () => {
    const idea = await createItem({ title: "Hook" });
    const build = await createItem({ title: "Tugboat" });
    await addAttempt(build.id, { outcome: "success" });
    const twist = await request("/api/twists", { method: "POST", json: { id: uuid(), name: "Grid bin" }, cookie });
    const twistId = (await twist.json<TwistResponse>()).twist.id;
    for (const [kind, id, path] of [
      ["items", idea.id, `/ideas/${idea.id}`],
      ["items", build.id, `/builds/${build.id}`],
      ["twists", twistId, `/twists/${twistId}`],
    ] as const) {
      const made = await share(kind, id);
      const response = await guestRoute(
        new Request(`${ORIGIN}/s/${made.token}`, { headers: { Cookie: cookie } }),
        stub,
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(path);
    }
    // A cookie that isn't a session is a guest's.
    const made = await share("items", idea.id);
    const response = await guestRoute(
      new Request(`${ORIGIN}/s/${made.token}`, { headers: { Cookie: "spaghetti_session=forged" } }),
      stub,
    );
    expect(response.status).toBe(200);
  });

  it("reaches the routes through the Worker itself", async () => {
    const item = await createItem({ title: "Hook" });
    const photoId = await addPhoto(item.id);
    const made = await share("items", item.id);
    const page = await request(`/s/${made.token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect((await request(`/s/${made.token}/photos/${photoId}/large`)).status).toBe(200);
  });
});

describe("photos through a link", () => {
  it("serves the thing's own photos and nothing else: another thing's, a deleted one, a deleted attempt's", async () => {
    const item = await createItem({ title: "Tugboat" });
    const own = await addPhoto(item.id);
    const attemptId = await addAttempt(item.id, { outcome: "failed" });
    const ofAttempt = await addPhoto(item.id, { attemptId });
    const removed = await addPhoto(item.id);
    await request(`/api/photos/${removed}`, { method: "DELETE", cookie });
    const goneAttempt = await addAttempt(item.id, { outcome: "partial" });
    const ofGoneAttempt = await addPhoto(item.id, { attemptId: goneAttempt });
    await request(`/api/attempts/${goneAttempt}`, { method: "DELETE", cookie });
    const other = await createItem({ title: "Private" });
    const elsewhere = await addPhoto(other.id);
    const made = await share("items", item.id);

    const fetchPhoto = async (id: string, variant = "large", token = made.token) =>
      (await guest(`/s/${token}/photos/${id}/${variant}`)).response;
    const served = await fetchPhoto(own);
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/webp");
    expect(served.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(served.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(webp());
    expect((await fetchPhoto(own, "thumb")).status).toBe(200);
    expect((await fetchPhoto(ofAttempt)).status).toBe(200);
    for (const id of [removed, ofGoneAttempt, elsewhere, uuid()]) expect((await fetchPhoto(id)).status, id).toBe(404);
    for (const variant of ["original", "file", "..%2Fthumb", ""])
      expect((await fetchPhoto(own, variant)).status).toBe(404);

    // Another thing's link can't reach this thing's photo either.
    const otherLink = await share("items", other.id);
    expect((await fetchPhoto(own, "large", otherLink.token)).status).toBe(404);
    expect((await fetchPhoto(elsewhere, "large", otherLink.token)).status).toBe(200);

    // Stopping the link stops its photos with it.
    await request(`/api/shares/${made.id}`, { method: "DELETE", cookie });
    expect((await fetchPhoto(own)).status).toBe(404);
  });

  it("serves only the photos its page shows: an idea back from building keeps its attempts' photos to itself", async () => {
    const item = await createItem({ title: "Tugboat" });
    const own = await addPhoto(item.id);
    const attemptId = await addAttempt(item.id, { outcome: "failed" });
    const ofAttempt = await addPhoto(item.id, { attemptId });
    // Back to Ideas, its own photo the cover: the idea's page shows no attempts, so none of their photos.
    await env.DB.prepare("UPDATE items SET stage = 'idea', cover_photo_id = ? WHERE id = ?").bind(own, item.id).run();
    const made = await share("items", item.id);
    const { html } = await guest(`/s/${made.token}`);
    expect(html).toContain(own);
    expect(html).not.toContain(ofAttempt);
    expect((await guest(`/s/${made.token}/photos/${own}/large`)).response.status).toBe(200);
    for (const variant of ["large", "thumb"])
      expect((await guest(`/s/${made.token}/photos/${ofAttempt}/${variant}`)).response.status).toBe(404);
  });

  it("serves Safari's resized JPEG, Exif block and all, stripped to clean bytes", async () => {
    const item = await createItem({ title: "Cable clip" });
    // What an iPhone stores: a canvas JPEG with Safari's Exif (colour space, pixel size) and Photoshop blocks.
    const stored = safariJpeg(jpeg());
    const photoId = await addPhoto(item.id, { bytes: stored, type: "image/jpeg" });
    const made = await share("items", item.id);
    const { html } = await guest(`/s/${made.token}`);
    expect(html).toContain(`/s/${made.token}/photos/${photoId}/thumb`);

    for (const variant of ["thumb", "large"]) {
      const served = (await guest(`/s/${made.token}/photos/${photoId}/${variant}`)).response;
      expect(served.status, variant).toBe(200);
      expect(served.headers.get("Content-Type")).toBe("image/jpeg");
      const bytes = new Uint8Array(await served.arrayBuffer());
      expect(served.headers.get("Content-Length")).toBe(String(bytes.byteLength));
      expect(String.fromCharCode(...bytes)).not.toMatch(/Exif|Photoshop|8BIM/);
      // JFIF and its colour profile, then the image data as stored.
      expect(bytes).toEqual(withSegments(jpeg(), [ICC]));
    }
    const head = await guestRoute(
      new Request(`http://spaghetti.test/s/${made.token}/photos/${photoId}/thumb`, { method: "HEAD" }),
      env,
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Length")).toBe(String(withSegments(jpeg(), [ICC]).byteLength));
  });

  it("strips EXIF and XMP from what it serves, and withholds what it can't read or what is stored as it came", async () => {
    const item = await createItem({ title: "Tugboat" });
    const clean = await addPhoto(item.id, { bytes: jpeg(), type: "image/jpeg" });
    // Sent as if a browser had resized it, but with the camera's EXIF (a GPS position), XMP and the rest in it.
    const camera = await addPhoto(item.id, { bytes: cameraJpeg(jpeg({ exif: true })), type: "image/jpeg" });
    const webpWithExif = await addPhoto(item.id, { bytes: webp({ exif: true }) });
    // A JPEG cut short (no end marker): it can't be vouched for.
    const cut = await addPhoto(item.id, { bytes: jpeg().subarray(0, jpeg().length - 2), type: "image/jpeg" });
    // Stored as it came (an agent, the bridge): the original, which may carry everything.
    const unresized = await addPhoto(item.id, { bytes: jpeg(), type: "image/jpeg", unresized: true });
    const made = await share("items", item.id);

    for (const [id, expected] of [
      [clean, jpeg()],
      [camera, withSegments(jpeg(), [ICC])],
      [webpWithExif, webp()],
    ] as const) {
      const served = await guest(`/s/${made.token}/photos/${id}/large`);
      expect(served.response.status).toBe(200);
      const bytes = new Uint8Array(await served.response.arrayBuffer());
      expect(String.fromCharCode(...bytes)).not.toMatch(/Exif|GPS|xmpmeta|xap|Photoshop|Storgatan/);
      expect(bytes).toEqual(expected);
    }

    for (const id of [cut, unresized]) {
      for (const variant of ["large", "thumb"]) {
        expect((await guest(`/s/${made.token}/photos/${id}/${variant}`)).response.status, `${id} ${variant}`).toBe(404);
      }
    }
    // The page doesn't offer the one stored as it came.
    const { html } = await guest(`/s/${made.token}`);
    expect(html).not.toContain(unresized);
    expect(html).toContain(clean);
  });

  it("serves a twist only the photo it leads with, not the idea's others", async () => {
    const idea = await createItem({ title: "Gridfinity bin" });
    const lead = await addPhoto(idea.id);
    const second = await addPhoto(idea.id);
    const response = await request("/api/twists", {
      method: "POST",
      json: { id: uuid(), name: "Bin, 84 %", fromItemId: idea.id, sourcePhotoId: lead },
      cookie,
    });
    const twist = (await response.json<TwistResponse>()).twist;
    const made = await share("twists", twist.id);
    expect((await guest(`/s/${made.token}/photos/${lead}/large`)).response.status).toBe(200);
    expect((await guest(`/s/${made.token}/photos/${second}/large`)).response.status).toBe(404);
    // A twist's link opens nothing of the idea it came from.
    const { html } = await guest(`/s/${made.token}`);
    expect(html).not.toContain(second);
    expect(html).not.toContain(idea.id);
  });
});

describe("a build's story", () => {
  it("tells each attempt with its outcome, notes and what went wrong, and the settings to print it with once", async () => {
    const item = await createItem({ title: "Paddle steamer" });
    const settings = {
      layerHeight: 0.2,
      nozzleDiameter: 0.4,
      bedType: "Textured PEI Plate",
      supportEnabled: true,
      supportType: "tree",
      filaments: [{ type: "PLA", brand: "Bambu", colorName: "Jade white", colorHex: "#e8e8e0" }],
    } as const;
    await addAttempt(item.id, {
      outcome: "failed",
      note: "Lifted at the corners",
      failureTags: ["warping"],
      settings: { ...settings, bedTemperature: 55 },
    });
    await addAttempt(item.id, {
      outcome: "success",
      note: "Brim fixed it",
      settings: { ...settings, bedTemperature: 65, brim: true },
    });
    const made = await share("items", item.id);
    const { html } = await guest(`/s/${made.token}`);
    expect(html).toContain("Attempt 1");
    expect(html).toContain("Attempt 2");
    expect(html).toContain("Spaghetti");
    expect(html).toContain("Worked");
    expect(html).toContain("Lifted at the corners");
    expect(html).toContain("Warping");
    expect(html).toContain("Bambu Lab X2D");
    expect(html).toContain("0.20\u00a0mm");
    expect(html).toContain("Textured PEI");
    expect(html).toContain("Tree");
    expect(html).toContain("Jade white");
    expect(html).toContain("background-color:#e8e8e0");
    expect(html).toContain("2 attempts");
    // The settings are the attempt that worked's, given once for the build and not repeated under each attempt.
    expect(html.match(/Layer height/g)).toHaveLength(1);
    expect(html).toMatch(/<span class="gp-k">Bed temp<\/span> <span class="gp-v">65\u00a0°C<\/span>/);
    expect(html).toContain("attempt 2, the one that worked");
    // The first attempt says how it differed from them.
    expect(html).toContain("Compared with the settings above");
    expect(html).not.toContain("Temperatures");
  });

  it("folds earlier attempts of a long build into rows, and says whose settings it gives once", async () => {
    const item = await createItem({ title: "Hook" });
    const set = (bed: number) => ({ layerHeight: 0.2, bedTemperature: bed });
    await addAttempt(item.id, { outcome: "failed", failureTags: ["warping"], settings: set(50) });
    await addAttempt(item.id, { outcome: "failed", settings: set(55) });
    await addAttempt(item.id, { outcome: "success", note: "Clean.", settings: set(60) });
    await addAttempt(item.id, { outcome: "failed", settings: set(60) });
    await addAttempt(item.id, { outcome: "partial", settings: set(60) });
    const { html } = await guest(`/s/${(await share("items", item.id)).token}`);
    // Cards: the one that worked and the newest. Rows: the other three, in two runs around the card.
    expect(html.match(/<li class="gp-attempt /g)).toHaveLength(2);
    expect(html.match(/<li class="gp-row">/g)).toHaveLength(3);
    expect(html.match(/<li class="gp-rows">/g)).toHaveLength(2);
    const at = (text: string) => html.indexOf(text);
    expect(at(">Attempt 2<")).toBeLessThan(at(">Attempt 3<"));
    expect(at(">Attempt 3<")).toBeLessThan(at(">Attempt 4<"));
    expect(at(">Attempt 4<")).toBeLessThan(at(">Attempt 5<"));
    // The settings are attempt 3's, the one that worked; attempt 1 says how it differed (bed 60 → 50), without an attempt "0".
    expect(html).toContain("attempt 3, the one that worked");
    expect(html).toMatch(/Compared with the settings above/);
    expect(html).toMatch(/bed 60 → 50/);
    expect(html).not.toContain("Changed since attempt 0");
    // A row leads with what went wrong.
    expect(html).toMatch(/gp-row-said[^>]*>.*?Warping/);
  });

  it("says the settings are the latest try's when nothing worked yet", async () => {
    const item = await createItem({ title: "Hook" });
    await addAttempt(item.id, { outcome: "failed", settings: { bedTemperature: 50 } });
    await addAttempt(item.id, { outcome: "partial", settings: { bedTemperature: 60 } });
    const { html } = await guest(`/s/${(await share("items", item.id)).token}`);
    expect(html).toContain("How the latest try was set up · attempt 2");
    expect(html.match(/<li class="gp-row">/g)).toBeNull();
  });

  it("leaves out a tag that only repeats the outcome, and gives each place a photo shows its own way back", async () => {
    const item = await createItem({ title: "Tugboat" });
    const failed = await addAttempt(item.id, { outcome: "failed", failureTags: ["spaghetti", "bed-adhesion"] });
    const photo = await addPhoto(item.id, { attemptId: failed });
    const made = await share("items", item.id);
    const { html } = await guest(`/s/${made.token}`);
    // The outcome chip says Spaghetti once; the failure tag that says it again is left out, the other one stays.
    expect(html.match(/>Spaghetti</g)).toHaveLength(1);
    expect(html).toContain("Bed adhesion");
    // The attempt's photo is the cover too: two places, two large views, each closing back to its own place.
    expect(
      html.match(new RegExp(`class="gp-lightbox-img" src="/s/${made.token}/photos/${photo}/large"`, "g")),
    ).toHaveLength(2);
    for (const key of ["lead-0", "a1-0"]) {
      expect(html).toContain(`id="from-${key}"`);
      expect(html).toContain(`href="#photo-${key}"`);
      expect(html).toContain(`id="photo-${key}"`);
      expect(html).toContain(`href="#from-${key}"`);
    }
  });
});

describe("a twist's source", () => {
  it("is named as the app's twist page names it: the page's own title, not the idea it came from", async () => {
    const idea = await createItem({ title: "Desk tidy-up" });
    const url = "https://makerworld.com/en/models/123456-drawer-bins";
    await env.DB.prepare(
      "INSERT OR REPLACE INTO link_previews (url, title, site, failed, fetched_at) VALUES (?, ?, ?, 0, ?)",
    )
      .bind(url, "Drawer bins, 42 mm grid", "MakerWorld", Date.now())
      .run();
    try {
      const response = await request("/api/twists", {
        method: "POST",
        json: { id: uuid(), name: "Bins at 84 %", fromItemId: idea.id, sourceUrl: url },
        cookie,
      });
      const twist = (await response.json<TwistResponse>()).twist;
      const made = await share("twists", twist.id);
      const { html } = await guest(`/s/${made.token}`);
      expect(html).toContain("Drawer bins, 42 mm grid");
      expect(html).not.toContain("Desk tidy-up");
      // The site's letter on the tile, as the app's LinkCard draws it.
      expect(html).toMatch(/<span class="gp-model-mark" aria-hidden="true">M<\/span>/);
    } finally {
      await env.DB.prepare("DELETE FROM link_previews WHERE url = ?").bind(url).run();
    }
  });
});

describe("escaping", () => {
  const PAYLOADS = [
    `<script>alert(1)</script>`,
    `"><img src=x onerror=alert(2)>`,
    `' onmouseover='alert(3)`,
    `</title><script>alert(4)</script>`,
    `javascript:alert(5)`,
  ];
  const evil = PAYLOADS.join(" ");

  /** Every element and attribute of the page, as a browser's parser sees them. */
  async function parse(html: string) {
    const elements: { tag: string; attributes: [string, string][] }[] = [];
    await new HTMLRewriter()
      .on("*", {
        element: (element) =>
          void elements.push({ tag: element.tagName, attributes: [...element.attributes] as [string, string][] }),
      })
      .transform(new Response(html))
      .text();
    return elements;
  }

  async function expectInert(html: string) {
    const elements = await parse(html);
    const tags = new Set(elements.map((element) => element.tag));
    for (const tag of ["iframe", "object", "embed", "form", "base", "style"]) expect(tags.has(tag), tag).toBe(false);
    // The one script is the template's own (the 3D view's, decision 0077): never one the Worker wrote.
    for (const script of elements.filter((element) => element.tag === "script")) {
      expect(Object.fromEntries(script.attributes)).toEqual({ type: "module", src: "/src/guest/island.ts" });
    }
    expect(html.slice(html.indexOf("<body"))).not.toMatch(/<script\b/i);
    for (const { tag, attributes } of elements) {
      for (const [name, value] of attributes) {
        expect(name.startsWith("on"), `${tag} ${name}`).toBe(false);
        if (["href", "src", "srcset", "content", "action"].includes(name))
          expect(value.trim(), `${tag} ${name}`).not.toMatch(/^(javascript|data|vbscript):/i);
        if (name === "href") expect(value, `${tag} href`).toMatch(/^(https?:\/\/|#|\/)/);
        if (name === "style") expect(value, `${tag} style`).toMatch(/^background-color:#[0-9a-f]{6}$/);
      }
      if (tag === "img") expect(attributes.find(([name]) => name === "src")?.[1]).toMatch(/^\/(s\/|favicon)/);
    }
    // No text closes an attribute early: each tag in the head is exactly its attributes.
    for (const match of html.matchAll(/<meta [^>]*>/g)) expect(match[0]).toMatch(/^<meta( [\w:-]+="[^"]*")+ ?\/?>$/);
    return elements;
  }

  it("keeps people's words as words in an idea, its model card and the preview tags", async () => {
    const item = await createItem({
      title: evil,
      note: `${evil}\nhttps://example.com/a"b<c\njavascript:alert(6)\ndata:text/html,<b>x</b>\nhttps://makerworld.com/en/models/123-boat`,
    });
    await addPhoto(item.id);
    await env.DB.prepare(
      "INSERT INTO item_drafts (item_id, url, site, status, result, applied, created_at, drafted_at) VALUES (?, ?, 'makerworld', 'drafted', ?, '[]', ?, ?)",
    )
      .bind(
        item.id,
        "https://makerworld.com/en/models/123-boat",
        JSON.stringify({
          title: evil,
          note: null,
          findings: { designer: evil, license: evil, material: null, plate: null, settings: null },
          photoIds: [],
        }),
        Date.now(),
        Date.now(),
      )
      .run();
    const made = await share("items", item.id);
    const { html } = await guest(`/s/${made.token}`);
    await expectInert(html);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toMatch(/<meta property="og:title" content="&lt;script&gt;alert\(1\)/);
    // Only http(s) addresses become links; the model's page is a link, javascript: and data: stay text.
    const links = (await parse(html)).filter((element) => element.tag === "a");
    const hrefs = links.map((element) => element.attributes.find(([name]) => name === "href")?.[1] ?? "");
    expect(hrefs).toContain("https://makerworld.com/en/models/123-boat");
    expect(hrefs).toContain("https://example.com/a");
    expect(hrefs.filter((href) => href.startsWith("http")).sort()).toEqual([
      "https://example.com/a",
      "https://makerworld.com/en/models/123-boat",
    ]);
    expect(html).toContain("javascript:alert(6)");
    expect(html).toContain("data:text/html,&lt;b&gt;x&lt;/b&gt;");
  });

  it("keeps a build's and a twist's words as words", async () => {
    const item = await createItem({ title: "Boat" });
    await env.DB.prepare(
      "INSERT INTO tags (kind, slug, label, created_by, created_at) VALUES ('failure', 'evil', ?, (SELECT id FROM users LIMIT 1), ?)",
    )
      .bind(evil, Date.now())
      .run();
    const attemptId = await addAttempt(item.id, { outcome: "failed", note: evil.slice(0, 120), failureTags: ["evil"] });
    // The API refuses such settings; one that got into the row anyway (an older version, a hand edit) stays text.
    await env.DB.prepare("UPDATE attempts SET settings = ? WHERE id = ?")
      .bind(
        JSON.stringify({
          filaments: [{ type: evil, colorName: evil, colorHex: "red;background:url(https://x.test)" }],
          processPreset: evil,
          bedType: evil,
        }),
        attemptId,
      )
      .run();
    const build = await guest(`/s/${(await share("items", item.id)).token}`);
    await expectInert(build.html);
    expect(build.html).not.toContain("url(https://x.test)");

    const twist = await request("/api/twists", {
      method: "POST",
      json: {
        id: uuid(),
        name: evil.slice(0, 120),
        note: evil,
        sourceUrl: "https://www.printables.com/model/1-bin",
        sourceTitle: evil.slice(0, 200),
        designer: evil.slice(0, 120),
        license: evil.slice(0, 120),
        changes: [
          { id: uuid(), kind: "other", label: evil.slice(0, 80), value: evil.slice(0, 80), note: evil.slice(0, 200) },
        ],
      },
      cookie,
    });
    expect(twist.status).toBe(201);
    const twistId = (await twist.json<TwistResponse>()).twist.id;
    const page = await guest(`/s/${(await share("twists", twistId)).token}`);
    expect(page.response.status).toBe(200);
    await expectInert(page.html);
  });
});
