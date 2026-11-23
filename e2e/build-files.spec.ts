import { expect, test } from "@playwright/test";
import { hotdogModel } from "./fixtures/model-3mf";
import { boxStl } from "./fixtures/model-stl";
import { clearIdeas, signIn } from "./helpers";

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

test("a build takes new model files: the first from its header, more at the end of Files, also once it is folded", {
  tag: "@phone",
}, async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title: "Tweaked hook", stage: "building" } });
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Tweaked hook");

  // No files yet: no "Files 0", but a quiet way to add the first.
  await expect(page.getByRole("region", { name: /^Files/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Add a file" }).click();
  await page.getByTestId("idea-file-input").setInputFiles({
    name: "hook-v1.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(boxStl(20)),
  });
  const files = page.getByRole("region", { name: /^Files/ });
  await expect(files.getByText("hook-v1.stl")).toBeVisible();
  // The action now ends the list, and the header's is gone.
  await expect(page.getByRole("button", { name: "Add a file" })).toHaveCount(1);
  await expect(files.getByRole("button", { name: "Add a file" })).toBeVisible();

  // A tweak: a .3mf, below the first.
  await page.getByTestId("idea-file-input").setInputFiles({
    name: "hook-v2.3mf",
    mimeType: "model/3mf",
    buffer: Buffer.from(hotdogModel()),
  });
  await expect(files.getByText("hook-v2.3mf")).toBeVisible();
  await expect(files.getByText("hook-v2.3mf")).toBeInViewport();
  await expect(files.getByText("hook-v1.stl")).toBeVisible();

  await expect
    .poll(
      async () => {
        const { item } = await (await page.request.get(`/api/items/${id}`)).json();
        return item.files.filter((file: { slice?: { status: string } }) => file.slice?.status === "sliced").length;
      },
      { timeout: 150_000 },
    )
    .toBe(2);
  // With an attempt the section folds on a phone: a file added from it still shows its row.
  const made = await page.request.post(`/api/items/${id}/attempts`, {
    headers,
    data: { id: crypto.randomUUID(), outcome: "partial", note: "Too tight", printedAt: Date.now() - 3_600_000 },
  });
  expect(made.ok()).toBe(true);
  await page.reload();
  await expect(files.getByRole("button", { name: "Add a file" })).toBeVisible();
  await page.getByTestId("idea-file-input").setInputFiles({
    name: "hook-v3.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(boxStl(24)),
  });
  await expect(files.getByText(/hook-v3/)).toBeVisible();
  // The next attempt offers the new file too, once it is sliced (a tweak is what the next try prints).
  await expect
    .poll(
      async () => {
        const { item } = await (await page.request.get(`/api/items/${id}`)).json();
        return item.files.filter((file: { slice?: { status: string } }) => file.slice?.status === "sliced").length;
      },
      { timeout: 150_000 },
    )
    .toBe(3);
  await page.getByRole("button", { name: "Log attempt" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Attempt 2" });
  await expect(sheet.getByRole("list", { name: "Slices kept with the idea" }).getByRole("button")).toHaveCount(3);
  await expect(sheet.getByRole("button", { name: /^Use hook-v3\.gcode\.3mf/ })).toBeVisible();
  await expect.poll(async () => (await (await page.request.get(`/api/items/${id}`)).json()).item.files.length).toBe(3);
});

test("files picked together while the build is being fetched all stay on the page", async ({ page }) => {
  await signIn(page);
  const headers = { Origin: new URL(page.url()).origin };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title: "Twin hooks", stage: "building" } });
  // Opened from the list, the build shows the list's copy and asks for itself: that answer is held until the files
  // are on the page.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let asked = false;
  await page.route(`**/api/items/${id}`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    asked = true;
    await held;
    await route.fallback();
  });
  // The second file takes longer to be saved than the first, as one of several often does.
  await page.route(`**/api/items/${id}/files/**`, async (route) => {
    if (route.request().method() === "PUT" && (route.request().postData() ?? "").includes("twin-b.stl"))
      await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.fallback();
  });
  await page.goto("/builds");
  await page
    .getByRole("link", { name: /Twin hooks/ })
    .first()
    .click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Twin hooks");
  await expect.poll(() => asked).toBe(true);
  await page.getByTestId("idea-file-input").setInputFiles([
    { name: "twin-a.stl", mimeType: "model/stl", buffer: Buffer.from(boxStl(20)) },
    { name: "twin-b.stl", mimeType: "model/stl", buffer: Buffer.from(boxStl(22)) },
  ]);
  const files = page.getByRole("region", { name: /^Files/ });
  await expect(files.getByText("twin-a.stl")).toBeVisible();
  await expect(files.getByText("twin-b.stl")).toBeVisible();
  release();
  // While the second is still being saved, the answers that come keep its card on the page.
  for (let i = 0; i < 30; i++) {
    expect(await files.getByText("twin-b.stl").count(), "the second file's card stays").toBe(1);
    await page.waitForTimeout(100);
  }
  // The answers after both are saved keep both.
  await expect
    .poll(async () => (await (await page.request.get(`/api/items/${id}`)).json()).item.files.length, {
      timeout: 20_000,
    })
    .toBe(2);
  await page.waitForTimeout(1500);
  await expect(files.getByText("twin-a.stl")).toBeVisible();
  await expect(files.getByText("twin-b.stl")).toBeVisible();
});
