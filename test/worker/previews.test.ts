import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ItemResponse } from "../../src/shared/api.ts";
import { cut, previewImage, previewPage, previewTarget, words } from "../../src/worker/previews.ts";
import { ascii, ICC, safariJpeg, segment, withSegments } from "../support/photo-fixtures.ts";
import { addUser, request, resetDb, signIn, uploadPhoto } from "./helpers.ts";

const INDEX =
  '<!doctype html><html><head><title>Spaghetti</title><meta name="description" content="Our notebook" /></head><body>app</body></html>';
const stub = {
  ...env,
  ASSETS: { fetch: async () => new Response(INDEX, { headers: { "Content-Type": "text/html" } }) },
} as unknown as Env;
const SLACK = "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)";
let cookie = "";

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

async function page(path: string, userAgent = SLACK) {
  const url = new URL(`http://spaghetti.test${path}`);
  const target = previewTarget(url.pathname);
  if (!target) throw new Error("not a preview path");
  const response = await previewPage(new Request(url, { headers: { "User-Agent": userAgent } }), stub, target);
  return { response, html: await response.text() };
}
const meta = (html: string, key: string) =>
  new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];

async function idea(json: { title?: string; note?: string }) {
  const id = crypto.randomUUID();
  const response = await request("/api/items", { method: "POST", json: { id, ...json }, cookie });
  expect(response.status).toBe(201);
  return (await response.json<ItemResponse>()).item.id;
}

describe("the words", () => {
  it("cuts at a word with an ellipsis, at most 160 characters", () => {
    const long = "word ".repeat(80);
    const out = cut(long, 160);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith("word…")).toBe(true);
    expect(cut("short  text", 160)).toBe("short text");
  });

  it("takes a missing title from the first line, and the rest as the description", () => {
    expect(words("Hook", "For the garage\nSecond")).toEqual({ title: "Hook", description: "For the garage Second" });
    expect(words(null, "Wall hook\nFor the garage")).toEqual({ title: "Wall hook", description: "For the garage" });
    expect(words("  ", "")).toEqual({ title: "", description: "" });
  });
});

describe("the page's tags", () => {
  it("shows an idea's title, text and photo, with Slack's user agent and no cookie", async () => {
    const id = await idea({ title: 'Cable <clip> & "hook"', note: "Holds the desk cables." });
    expect((await uploadPhoto(id, crypto.randomUUID(), cookie)).status).toBe(201);
    const { response, html } = await page(`/ideas/${id}`);
    expect(response.status).toBe(200);
    expect(html).toContain("app</body>");
    expect(meta(html, "og:title")).toBe("Spaghetti · Cable &lt;clip&gt; &amp; &quot;hook&quot;");
    expect(html).toContain('<title>Spaghetti · Cable &lt;clip&gt; &amp; "hook"</title>');
    expect(meta(html, "og:description")).toBe("Holds the desk cables.");
    expect(meta(html, "og:image")).toMatch(new RegExp(`^http://spaghetti.test/og/ideas/${id}\\.jpg\\?p=`));
    expect(meta(html, "og:url")).toBe(`http://spaghetti.test/ideas/${id}`);
    expect(meta(html, "og:site_name")).toBe("Spaghetti");
    expect(meta(html, "twitter:card")).toBe("summary_large_image");
    expect(html).not.toContain("Our notebook");
  });

  it("falls back to the first line of the note, and to the landing picture without a photo", async () => {
    const id = await idea({ note: `A wall hook\n${"x ".repeat(200)}` });
    const { html } = await page(`/builds/${id}`);
    expect(meta(html, "og:title")).toBe("Spaghetti · A wall hook");
    expect(meta(html, "og:description")?.length).toBeLessThanOrEqual(160);
    expect(meta(html, "og:image")).toBe("http://spaghetti.test/og.jpg");
  });

  it("is generic for nothing to say, unknown ids and deleted things alike", async () => {
    const blank = await idea({});
    const gone = await idea({ title: "Secret", note: "private" });
    expect((await request(`/api/items/${gone}`, { method: "DELETE", cookie })).status).toBeLessThan(300);
    const tagsOf = async (id: string) => {
      const { html } = await page(`/ideas/${id}`);
      return [meta(html, "og:title"), meta(html, "og:description"), meta(html, "og:image")];
    };
    const unknown = await tagsOf(crypto.randomUUID());
    expect(unknown[0]).toBe("Spaghetti");
    expect(unknown[1]).toContain("Every print, every spaghetti");
    expect(await tagsOf(gone)).toEqual(unknown);
    expect(await tagsOf(blank)).toEqual(unknown);
  });

  it("covers twists too", async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO twists (id, name, note, created_by, created_at, updated_at) VALUES (?, ?, ?, (SELECT id FROM users LIMIT 1), 1, 1)",
    )
      .bind(id, "Benchy, thicker", "Walls at 1.2 mm.")
      .run();
    const { html } = await page(`/twists/${id}`);
    expect(meta(html, "og:title")).toBe("Spaghetti · Benchy, thicker");
    expect(meta(html, "og:description")).toBe("Walls at 1.2 mm.");
  });
});

describe("the image", () => {
  it("serves the cover to anyone, and nothing for deleted or unknown things", async () => {
    const id = await idea({ title: "With photo" });
    const photoId = crypto.randomUUID();
    expect((await uploadPhoto(id, photoId, cookie)).status).toBe(201);
    const ok = await request(`/og/ideas/${id}.jpg`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/webp");
    expect(ok.headers.get("Cache-Control")).toContain("public");
    expect(Array.from(new Uint8Array(await ok.arrayBuffer()))).toEqual([1, 2, 3, 4]);
    expect((await request(`/og/ideas/${crypto.randomUUID()}.jpg`)).status).toBe(404);
    expect((await request(`/og/ideas/${photoId}.jpg`)).status).toBe(404);
    await request(`/api/items/${id}`, { method: "DELETE", cookie });
    expect((await request(`/og/ideas/${id}.jpg`)).status).toBe(404);
  });

  it("sends a cover without its EXIF, and never one it can't strip or an original waiting to be resized", async () => {
    const id = await idea({ title: "From the camera" });
    const photoId = crypto.randomUUID();
    await uploadPhoto(id, photoId, cookie);
    const exif = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe1,
      0x00,
      0x10,
      ...Array.from("Exif\0\0MM\0*GPS", (c) => c.charCodeAt(0)),
    ]);
    await env.PHOTOS.put(`photos/${photoId}/large`, exif, { httpMetadata: { contentType: "image/jpeg" } });
    expect((await request(`/og/ideas/${id}.jpg`)).status).toBe(404);
    // A whole JPEG with Safari's Exif block is sent without it.
    const jfif = segment(0xe0, [...ascii("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    const picture = new Uint8Array([
      0xff,
      0xd8,
      ...jfif,
      0xff,
      0xda,
      0,
      8,
      1,
      1,
      0,
      0,
      0x3f,
      0,
      0x12,
      0x34,
      0xff,
      0xd9,
    ]);
    await env.PHOTOS.put(`photos/${photoId}/large`, safariJpeg(picture), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    const sent = await request(`/og/ideas/${id}.jpg`);
    expect(sent.status).toBe(200);
    const bytes = new Uint8Array(await sent.arrayBuffer());
    expect(sent.headers.get("Content-Length")).toBe(String(bytes.byteLength));
    expect(bytes).toEqual(withSegments(picture, [ICC]));
    await env.PHOTOS.put(`photos/${photoId}/large`, new Uint8Array([1, 2, 3, 4]), {
      httpMetadata: { contentType: "image/webp" },
      customMetadata: { provisional: "1" },
    });
    expect((await request(`/og/ideas/${id}.jpg`)).status).toBe(404);
  });

  it("uses the thumbnail when the large photo is over a megabyte", async () => {
    const id = await idea({ title: "Big" });
    const photoId = crypto.randomUUID();
    await uploadPhoto(id, photoId, cookie);
    await env.PHOTOS.put(`photos/${photoId}/large`, new Uint8Array(1_100_000), {
      httpMetadata: { contentType: "image/webp" },
    });
    const response = await previewImage(new Request(`http://spaghetti.test/og/builds/${id}.jpg`), env);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([5, 6]);
  });
});
