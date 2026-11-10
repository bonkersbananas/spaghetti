import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentScope, NewTokenResponse } from "../../src/shared/agents.ts";
import type { CaptureResponse, ItemResponse } from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;
let alex: string;

beforeEach(async () => {
  await resetDb();
  alex = await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

async function token(scopes: AgentScope[]) {
  const response = await request("/api/agents", { method: "POST", json: { name: "Shortcut", scopes }, cookie });
  return (await response.json<NewTokenResponse>()).token;
}
const asAgent = (bearer: string, init: Parameters<typeof request>[1] = {}) =>
  request("/api/capture", { method: "POST", ...init, headers: { Authorization: `Bearer ${bearer}`, ...init.headers } });

/** A JPEG start with a frame header saying 1600 × 1200: all readImage needs. */
const jpeg = () =>
  new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0xb0, 0x06, 0x40, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ]);

const getItem = async (id: string) => (await (await request(`/api/items/${id}`, { cookie })).json<ItemResponse>()).item;

describe("POST /api/capture", () => {
  it("needs the capture scope: read-only and other tokens are refused", async () => {
    for (const scopes of [["read"], ["attempts"], ["printer"]] as AgentScope[][]) {
      const response = await asAgent(await token(scopes), { json: { text: "x" } });
      expect(response.status).toBe(403);
    }
    expect((await request("/api/capture", { method: "POST", json: { text: "x" } })).status).toBe(401);
  });

  it("makes an idea of a URL, with a link back, as the token's owner and via the agent", async () => {
    const bearer = await token(["capture"]);
    const response = await asAgent(bearer, {
      json: { url: "https://makerworld.com/en/models/123", title: "Benchy remix" },
    });
    expect(response.status).toBe(201);
    const { id, url, photos } = await response.json<CaptureResponse>();
    expect(url).toBe(`http://spaghetti.test/ideas/${id}`);
    expect(photos).toBe(0);
    const item = await getItem(id);
    expect(item.stage).toBe("idea");
    expect(item.title).toBe("Benchy remix");
    expect(item.note).toBe("https://makerworld.com/en/models/123");
    expect(item.createdBy).toBe(alex);
    expect(item.createdVia).not.toBeNull();
  });

  it("joins text and link, but not twice, and drops a title that only repeats them", async () => {
    const bearer = await token(["capture"]);
    const both = await (
      await asAgent(bearer, { json: { text: "Nice hook", url: "https://a.example/x" } })
    ).json<CaptureResponse>();
    expect((await getItem(both.id)).note).toBe("Nice hook\nhttps://a.example/x");
    const twice = await (
      await asAgent(bearer, {
        json: { text: "Look https://a.example/x", url: "https://a.example/x", title: "https://a.example/x" },
      })
    ).json<CaptureResponse>();
    const item = await getItem(twice.id);
    expect(item.note).toBe("Look https://a.example/x");
    expect(item.title).toBeNull();
  });

  it("refuses an empty capture", async () => {
    const bearer = await token(["capture"]);
    expect((await asAgent(bearer, { json: {} })).status).toBe(400);
    expect((await asAgent(bearer, { json: { text: "   " } })).status).toBe(400);
  });

  it("stores a raw image with needsResize, and an image from a form with its text", async () => {
    const bearer = await token(["capture"]);
    const raw = await asAgent(bearer, {
      body: jpeg(),
      headers: { "Content-Type": "image/jpeg", Accept: "application/json" },
    });
    expect(raw.status).toBe(201);
    const rawBody = await raw.json<CaptureResponse>();
    const rawItem = await getItem(rawBody.id);
    expect(rawItem.photos).toHaveLength(1);
    expect(rawItem.photos[0]).toMatchObject({ needsResize: true, width: 1600, height: 1200 });
    const stored = await env.PHOTOS.head(`photos/${rawItem.photos[0]?.id}/large`);
    expect(stored?.customMetadata).toMatchObject({ provisional: "1" });

    const form = new FormData();
    form.set("text", "Phone stand");
    form.set("image", new File([jpeg()], "IMG_1.jpg", { type: "image/jpeg" }));
    const formed = await asAgent(bearer, { body: form, headers: { Accept: "application/json" } });
    expect(formed.status).toBe(201);
    const item = await getItem((await formed.json<CaptureResponse>()).id);
    expect(item.note).toBe("Phone stand");
    expect(item.photos[0]?.needsResize).toBe(true);
  });

  it("refuses a photo it can't store (HEIC) and keeps no half-made idea", async () => {
    const bearer = await token(["capture"]);
    const response = await asAgent(bearer, {
      body: new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]),
      headers: { "Content-Type": "image/heic" },
    });
    expect(response.status).toBe(415);
    const list = await (await request("/api/items", { cookie })).json<{ items: unknown[] }>();
    expect(list.items).toHaveLength(0);
  });

  it("records a change per write and is safe to repeat with the same id", async () => {
    const bearer = await token(["capture"]);
    const id = crypto.randomUUID();
    const first = await asAgent(bearer, { json: { id, text: "once" } });
    const second = await asAgent(bearer, { json: { id, text: "once" } });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const feed = await env.DB.prepare("SELECT COUNT(*) AS n FROM changes WHERE entity = 'item' AND entity_id = ?")
      .bind(id)
      .first<{ n: number }>();
    expect(feed?.n).toBe(1);
  });

  it("a retry fills in the photos a half-finished call left out", async () => {
    const bearer = await token(["capture"]);
    const id = crypto.randomUUID();
    const send = () => {
      const form = new FormData();
      form.set("id", id);
      form.append("image", new File([jpeg()], "a.jpg", { type: "image/jpeg" }));
      form.append("image", new File([jpeg()], "b.jpg", { type: "image/jpeg" }));
      return asAgent(bearer, { body: form });
    };
    await send();
    // The second photo never made it: drop its row, as a failure after the first would have.
    await env.DB.prepare("DELETE FROM photos WHERE item_id = ? AND position = 1").bind(id).run();
    expect((await send()).status).toBe(201);
    expect((await getItem(id)).photos).toHaveLength(2);
    await send();
    expect((await getItem(id)).photos).toHaveLength(2);
  });

  /**
   * What the iOS Shortcuts app sends (its "Get Contents of URL" action): a Form body with text fields is
   * urlencoded; a Form body with a file field is multipart, and a URL or rich-text item can come as a file part;
   * a Text or File body is sent as it is, with its own type. None of them says Accept: application/json.
   */
  describe("the shapes Shortcuts sends", () => {
    const saved = async (response: Response) => {
      expect(response.status, await response.clone().text()).toBe(201);
      expect(response.headers.get("content-type")).toContain("text/plain");
      return response.text();
    };
    const latest = async () => {
      const list = await (await request("/api/items", { cookie })).json<{
        items: Array<{ title: string | null; note: string }>;
      }>();
      return list.items[0];
    };

    it("urlencoded text", async () => {
      const bearer = await token(["capture"]);
      const body = new URLSearchParams({ text: "A hook for the garage door" });
      const reply = await saved(
        await asAgent(bearer, { body, headers: { "Content-Type": "application/x-www-form-urlencoded" } }),
      );
      expect(reply).toBe("Saved to Spaghetti: A hook for the garage door");
      expect((await latest())?.note).toBe("A hook for the garage door");
    });

    it("urlencoded URL: a lone link in text is the link", async () => {
      const bearer = await token(["capture"]);
      const body = new URLSearchParams({ text: "https://makerworld.com/en/models/55", title: "Hex bin" });
      const reply = await saved(
        await asAgent(bearer, { body, headers: { "Content-Type": "application/x-www-form-urlencoded" } }),
      );
      expect(reply).toBe("Saved to Spaghetti: Hex bin");
      expect(await latest()).toMatchObject({ title: "Hex bin", note: "https://makerworld.com/en/models/55" });
    });

    it("multipart with the URL as a file part", async () => {
      const bearer = await token(["capture"]);
      const form = new FormData();
      form.set("text", new File(["https://example.com/model/9"], "Safari page.txt", { type: "text/plain" }));
      const reply = await saved(await asAgent(bearer, { body: form }));
      expect(reply).toBe("Saved to Spaghetti: https://example.com/model/9");
      const made = await latest();
      expect(made?.note).toBe("https://example.com/model/9");
      // No photo came of it.
      const items = await (await request("/api/items", { cookie })).json<{ items: Array<{ photos: unknown[] }> }>();
      expect(items.items[0]?.photos).toHaveLength(0);
    });

    it("multipart with a file part of any name and type text/* is text, and a photo in the same form stays a photo", async () => {
      const bearer = await token(["capture"]);
      const form = new FormData();
      form.set("file", new File(["Look at this"], "note.txt", { type: "text/plain" }));
      form.set("image", new File([jpeg()], "IMG.jpg", { type: "image/jpeg" }));
      const reply = await saved(await asAgent(bearer, { body: form }));
      expect(reply).toBe("Saved to Spaghetti: Look at this");
      const items = await (await request("/api/items", { cookie })).json<{ items: Array<{ photos: unknown[] }> }>();
      expect(items.items[0]?.photos).toHaveLength(1);
    });

    it("text/plain and text/uri-list bodies", async () => {
      const bearer = await token(["capture"]);
      const plain = await saved(
        await asAgent(bearer, { body: "Phone stand, 15 degrees", headers: { "Content-Type": "text/plain" } }),
      );
      expect(plain).toBe("Saved to Spaghetti: Phone stand, 15 degrees");
      const uri = await saved(
        await asAgent(bearer, {
          body: "# a comment\r\nhttps://example.com/x\r\n",
          headers: { "Content-Type": "text/uri-list" },
        }),
      );
      expect(uri).toBe("Saved to Spaghetti: https://example.com/x");
      expect((await latest())?.note).toBe("https://example.com/x");
    });

    it("a photo says so in the sentence", async () => {
      const bearer = await token(["capture"]);
      const reply = await saved(await asAgent(bearer, { body: jpeg(), headers: { "Content-Type": "image/jpeg" } }));
      expect(reply).toBe("Saved to Spaghetti: a photo");
    });

    it("says in a sentence what was wrong, with the right status", async () => {
      const bearer = await token(["capture"]);
      const empty = await asAgent(bearer, {
        body: new URLSearchParams({ text: "  " }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      expect(empty.status).toBe(400);
      expect(await empty.text()).toBe("Spaghetti couldn't save that: there was no link, text, title or photo in it.");
      const heic = await asAgent(bearer, {
        body: new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
        headers: { "Content-Type": "application/octet-stream" },
      });
      expect(heic.status).toBe(415);
      expect(await heic.text()).toContain("JPEG or WebP");
    });

    it("keeps words that start with a brace, and refuses a file that is no photo or text", async () => {
      const bearer = await token(["capture"]);
      const braces = await saved(
        await asAgent(bearer, { body: "{curly} note", headers: { "Content-Type": "application/octet-stream" } }),
      );
      expect(braces).toBe("Saved to Spaghetti: {curly} note");
      const png = await asAgent(bearer, {
        body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0xfd, 0x00]),
        headers: { "Content-Type": "application/octet-stream" },
      });
      expect(png.status).toBe(415);
      expect(await png.text()).toContain("JPEG or WebP");
    });

    it("validates the query string too, whatever the body", async () => {
      const bearer = await token(["capture"]);
      const response = await request("/api/capture?id=not-a-uuid", {
        method: "POST",
        json: { text: "x" },
        headers: { Authorization: `Bearer ${bearer}` },
      });
      expect(response.status).toBe(400);
    });

    it("JSON callers still get JSON, with the sentence in it", async () => {
      const bearer = await token(["capture"]);
      const reply = await (await asAgent(bearer, { json: { text: "plain json" } })).json<CaptureResponse>();
      expect(reply.message).toBe("Saved to Spaghetti: plain json");
    });
  });

  it("works for a signed-in person too", async () => {
    const response = await request("/api/capture", { method: "POST", json: { text: "from the browser" }, cookie });
    expect(response.status).toBe(201);
  });
});
