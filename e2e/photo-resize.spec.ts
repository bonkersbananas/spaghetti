import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
  const { agents } = await (await page.request.get("/api/agents")).json();
  for (const agent of agents)
    for (const token of agent.tokens)
      await page.request.delete(`/api/agents/${agent.id}/tokens/${token.id}`, { headers: { Origin: origin(page) } });
});

test("a photo an agent captured is resized by the next browser that opens the app, quietly", async ({ page }) => {
  test.setTimeout(90_000);
  const headers = { Origin: origin(page) };
  const made = await (
    await page.request.post("/api/agents", { headers, data: { name: "Claude for Alex", scopes: ["read", "capture"] } })
  ).json();
  const photo = readFileSync("e2e/fixtures/tugboat.jpg");
  const captured = await page.request.post("/mcp", {
    headers: { Authorization: `Bearer ${made.token}` },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "capture_idea",
        arguments: { note: "Bath tugboat from Claude", photo_base64: photo.toString("base64") },
      },
    },
  });
  const text = (await captured.json()).result.content[0].text as string;
  const itemId = /build_id: ([0-9a-f-]{36})/.exec(text)?.[1] ?? "";
  expect(itemId).not.toBe("");
  expect(text).toContain("photo was added");

  const photoOf = async () => (await (await page.request.get(`/api/items/${itemId}`)).json()).item.photos[0];
  const first = await photoOf();
  // As it arrived: the original is its own thumbnail, with the placeholder colour.
  expect(first).toMatchObject({ needsResize: true, color: "#a9a095", width: 1600, height: 1200 });
  const size = async (variant: string) =>
    (await (await page.request.get(`/api/photos/${first.id}/${variant}`)).body()).length;
  expect(await size("thumb")).toBe(photo.length);
  expect(await size("large")).toBe(photo.length);

  // Someone opens the app. With nothing to see, the photo is resized in idle time.
  await page.goto("/ideas");
  await expect(
    page.getByRole("list", { name: "Ideas" }).getByRole("link", { name: /Bath tugboat from Claude/ }),
  ).toBeVisible();
  await expect.poll(async () => (await photoOf()).needsResize, { timeout: 45_000 }).toBe(false);

  const done = await photoOf();
  expect(done.color).toMatch(/^#[0-9a-f]{6}$/);
  expect(done.color).not.toBe("#a9a095");
  expect(done.width).toBeLessThanOrEqual(2048);
  const thumb = await page.request.get(`/api/photos/${first.id}/thumb`);
  expect(["image/webp", "image/jpeg"]).toContain(thumb.headers()["content-type"]);
  expect(thumb.headers()["cache-control"]).toContain("immutable");
  expect((await thumb.body()).length).toBeLessThan(photo.length / 2);
  // A proper thumbnail: no more than 600 px on its long edge.
  const edge = await page.evaluate(async (id) => {
    const bitmap = await createImageBitmap(await (await fetch(`/api/photos/${id}/thumb`)).blob());
    return Math.max(bitmap.width, bitmap.height);
  }, first.id);
  expect(edge).toBeLessThanOrEqual(600);
  expect(edge).toBeGreaterThan(100);
  // And it happened without a word: no toast, no progress.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
});
