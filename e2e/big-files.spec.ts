import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

// A file over 100 MB (what one request can carry) is kept, sent in parts (decision 0048).
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

test("a model over 100 MB is sent in parts, kept, and downloads byte for byte", async ({ page }) => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), "spaghetti-big-"));
  try {
    // Made here, never committed: 112 MB of an .stl's shape with bytes that differ all the way through.
    const size = 112 * 1024 * 1024;
    const bytes = randomBytes(size);
    bytes.fill(0, 0, 80);
    bytes.writeUInt32LE(Math.floor((size - 84) / 50), 80);
    const file = join(dir, "dragon.stl");
    writeFileSync(file, bytes);
    const sha = createHash("sha256").update(bytes).digest("hex");

    // The slicer's engine isn't what this checks: let it fail at once, so the page stays quiet.
    await page.route("**/slicer/*/engine-st.wasm", (route) => route.abort());
    // Parts go one by one: see the request carry the file in four of them (32 MiB each).
    const parts: number[] = [];
    page.on("request", (request) => {
      if (request.method() === "PUT" && /\/api\/uploads\/[^/]+\/file\/[^/]+\/\d+$/.test(request.url())) {
        parts.push(request.postDataBuffer()?.length ?? 0);
      }
    });

    await signIn(page);
    const id = crypto.randomUUID();
    const made = await page.request.post("/api/items", {
      headers: { Origin: new URL(page.url()).origin },
      data: { id, title: "Dragon", note: "" },
    });
    expect(made.ok()).toBe(true);
    await page.goto(`/ideas/${id}`);
    await page.getByTestId("idea-file-input").setInputFiles(file);

    const files = page.getByRole("region", { name: /^Files/ });
    await expect(files.getByText("dragon.stl")).toBeVisible();
    // The card shows how far it is, then keeps the model.
    await expect(files.getByRole("progressbar", { name: "Saving the model" })).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(
        async () => {
          const item = await (await page.request.get(`/api/items/${id}`)).json();
          return item.item.files?.[0]?.stored === true;
        },
        { timeout: 180_000 },
      )
      .toBe(true);
    await expect(files.getByRole("progressbar", { name: "Saving the model" })).toHaveCount(0);
    expect(parts.length).toBe(4);

    const item = await (await page.request.get(`/api/items/${id}`)).json();
    const fileId = item.item.files[0].id;
    expect(item.item.files[0]).toMatchObject({ size, kind: "model", stored: true });
    const download = await page.request.get(`/api/files/${fileId}`);
    expect(download.status()).toBe(200);
    const body = await download.body();
    expect(body.length).toBe(size);
    expect(createHash("sha256").update(body).digest("hex")).toBe(sha);

    // Still there after a reload.
    await page.reload();
    await expect(files.getByText("dragon.stl")).toBeVisible();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a big file that loses the network says it didn't finish, and one tap sends it again", async ({ page }) => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), "spaghetti-big-"));
  try {
    const size = 40 * 1024 * 1024;
    const file = join(dir, "knot.stl");
    writeFileSync(file, randomBytes(size));
    await page.route("**/slicer/*/engine-st.wasm", (route) => route.abort());
    let down = true;
    await page.route(/\/api\/uploads\/[^/]+\/file\/[^/]+\/\d+$/, (route) =>
      down ? route.abort("connectionfailed") : route.fallback(),
    );

    await signIn(page);
    const id = crypto.randomUUID();
    await page.request.post("/api/items", {
      headers: { Origin: new URL(page.url()).origin },
      data: { id, title: "Knot", note: "" },
    });
    await page.goto(`/ideas/${id}`);
    await page.getByTestId("idea-file-input").setInputFiles(file);

    const files = page.getByRole("region", { name: /^Files/ });
    await expect(files.getByText("Didn't finish saving. Your file is still here.")).toBeVisible({ timeout: 60_000 });
    down = false;
    await files.getByRole("button", { name: "Try again" }).click();
    await expect(files.getByText("Didn't finish saving. Your file is still here.")).toHaveCount(0);
    await expect
      .poll(async () => (await (await page.request.get(`/api/items/${id}`)).json()).item.files?.[0]?.stored, {
        timeout: 60_000,
      })
      .toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a big model logged with an attempt goes through the outbox in parts and is kept on the attempt", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), "spaghetti-big-"));
  try {
    const size = 40 * 1024 * 1024;
    const bytes = randomBytes(size);
    const file = join(dir, "gear.stl");
    writeFileSync(file, bytes);
    await page.route("**/slicer/*/engine-st.wasm", (route) => route.abort());
    await signIn(page);
    const id = crypto.randomUUID();
    await page.request.post("/api/items", {
      headers: { Origin: new URL(page.url()).origin },
      data: { id, title: "Gear", stage: "building" },
    });
    await page.goto(`/builds/${id}`);
    await page.getByRole("button", { name: "Log attempt" }).first().click();
    const sheet = page.getByRole("dialog", { name: "Attempt 1" });
    await page.getByTestId("slicer-file-input").setInputFiles(file);
    await expect(sheet.getByText("gear.stl")).toBeVisible();
    await sheet.getByRole("button", { name: "Still printing" }).click();
    await expect
      .poll(
        async () => {
          const item = await (await page.request.get(`/api/items/${id}`)).json();
          return item.item.attempts[0]?.file?.stored ?? null;
        },
        { timeout: 90_000 },
      )
      .toBe(true);
    const item = await (await page.request.get(`/api/items/${id}`)).json();
    const download = await page.request.get(`/api/files/${item.item.attempts[0].file.id}`);
    expect(
      createHash("sha256")
        .update(await download.body())
        .digest("hex"),
    ).toBe(createHash("sha256").update(bytes).digest("hex"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
