import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// What a crawler without a session reads from a shared link (decision 0064), and that the page is still the app.

const CRAWLERS = [
  "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  "facebookexternalhit/1.1",
  "Twitterbot/1.0",
];
const meta = (html: string, key: string) =>
  new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];

test("crawlers get the idea's tags and its picture, and a deleted idea is generic", async ({
  page,
  playwright,
  baseURL,
}) => {
  await signIn(page);
  const headers = { Origin: new URL(page.url()).origin };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers,
    data: { id, title: 'Tugboat & "bath" toy', note: "Floats upright." },
  });
  // As a browser sends it: resized, with nothing of the camera's left (a cover still carrying EXIF isn't sent,
  // decision 0075; test/worker/previews.test.ts).
  const buffer = readFileSync("e2e/fixtures/model-1.jpg");
  await page.request.put(`/api/items/${id}/photos/${crypto.randomUUID()}`, {
    headers,
    multipart: {
      width: "1200",
      height: "900",
      color: "#6b5a4a",
      large: { name: "large.jpg", mimeType: "image/jpeg", buffer },
      thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer },
    },
  });

  for (const userAgent of CRAWLERS) {
    const crawler = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "User-Agent": userAgent } });
    const response = await crawler.get(`/ideas/${id}`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(meta(html, "og:title")).toBe("Spaghetti · Tugboat &amp; &quot;bath&quot; toy");
    expect(meta(html, "og:description")).toBe("Floats upright.");
    expect(meta(html, "twitter:card")).toBe("summary_large_image");
    expect(html).toContain('<div id="root">');
    const image = meta(html, "og:image") ?? "";
    expect(image).toMatch(/^https?:\/\//);
    const picture = await crawler.get(new URL(image).pathname + new URL(image).search);
    expect(picture.status()).toBe(200);
    expect(picture.headers()["content-type"]).toBe("image/jpeg");
    await crawler.dispose();
  }

  await page.request.delete(`/api/items/${id}`, { headers });
  const crawler = await playwright.request.newContext({ baseURL });
  const gone = await (await crawler.get(`/ideas/${id}`)).text();
  expect(meta(gone, "og:title")).toBe("Spaghetti");
  expect(meta(gone, "og:image")).toMatch(/\/og\.jpg$/);
  expect((await crawler.get(`/og/ideas/${id}.jpg`)).status()).toBe(404);
  await crawler.dispose();

  // Signed in, the page is the app as before.
  await page.goto("/ideas");
  await expect(page.locator("#root")).not.toBeEmpty();
});
