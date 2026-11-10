import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("marks a task done, with a note, and it shows in the history", async ({ page }) => {
  await page.goto("/printer");
  const task = "Empty the purge chute";
  await expect(page.getByRole("list", { name: "Upkeep tasks" })).toBeVisible();
  await page.getByRole("button", { name: `Done: ${task}` }).click();
  const sheet = page.getByRole("dialog", { name: task });
  await sheet.getByLabel("A note (optional)").fill("Emptied, a lot of teal");
  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect
    .poll(async () => {
      const { tasks } = await (await page.request.get("/api/printer/upkeep")).json();
      return tasks.find((t: { id: string }) => t.id === "purge-chute")?.lastDone?.note;
    })
    .toBe("Emptied, a lot of teal");
  await page
    .getByRole("button", { name: new RegExp(task) })
    .first()
    .click();
  await expect(page.getByRole("dialog", { name: task }).getByText("Emptied, a lot of teal")).toBeVisible();
});

test("edits an interval and keeps it", async ({ page }) => {
  await page.goto("/printer");
  await page
    .getByRole("button", { name: /Check the belts/ })
    .first()
    .click();
  const sheet = page.getByRole("dialog", { name: "Check the belts" });
  const days = sheet.getByLabel("or");
  await days.fill("45");
  await days.blur();
  await expect
    .poll(async () => {
      const { tasks } = await (await page.request.get("/api/printer/upkeep")).json();
      return tasks.find((t: { id: string }) => t.id === "belts")?.intervalDays;
    })
    .toBe(45);
  await page.request.patch("/api/printer/upkeep/belts", {
    headers: { Origin: origin(page) },
    data: { intervalDays: 90 },
  });
});

test("a spool past its drying window asks to be dried", async ({ page }) => {
  const id = crypto.randomUUID();
  await page.request.post("/api/spools", {
    headers: { Origin: origin(page) },
    data: { id, material: "PVA", colorName: "Clear", driedAt: Date.now() - 5 * 24 * 3_600_000 },
  });
  await page.goto(`/pantry/${id}`);
  await expect(page.getByText("Dry it before printing")).toBeVisible();
  await page.getByRole("button", { name: "Dried it today" }).click();
  await expect(page.getByText("Dry it before printing")).toBeHidden();
  await page.request.delete(`/api/spools/${id}`, { headers: { Origin: origin(page) } });
});
