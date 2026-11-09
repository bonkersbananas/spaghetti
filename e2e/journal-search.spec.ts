import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

const user = SEED_USERS[0];

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
}

const origin = (page: Page) => new URL(page.url()).origin;
const HOUR = 60 * 60_000;

/** A build with attempts, made through the API. */
async function build(
  page: Page,
  title: string,
  attempts: Array<{ outcome: string; ago: number; note?: string; failureTags?: string[]; settings: object }>,
) {
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id, title, stage: "building" } });
  for (const attempt of attempts) {
    const response = await page.request.post(`/api/items/${id}/attempts`, {
      headers,
      data: { id: crypto.randomUUID(), ...attempt, printedAt: Date.now() - attempt.ago },
    });
    expect(response.ok()).toBe(true);
  }
  return id;
}

const petg = (bed: number, extra: object = {}) => ({
  filaments: [{ type: "PETG", brand: "Bambu", colorName: "Blue", colorHex: "#2f6f9f" }],
  bedType: "Textured PEI Plate",
  bedTemperature: bed,
  ...extra,
});
const pla = { filaments: [{ type: "PLA", brand: "Bambu" }], bedType: "Cool Plate", bedTemperature: 35 };

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Leave nothing behind: the smoke test expects empty sections.
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

test("finds an attempt by a failure tag plus a material", async ({ page, isMobile }) => {
  const box = await build(page, "Swatch box", [
    { outcome: "failed", ago: 3 * HOUR, note: "Corners peeled up", failureTags: ["warping"], settings: petg(70) },
  ]);
  await build(page, "Vase", [
    { outcome: "failed", ago: 2 * HOUR, note: "Curled base", failureTags: ["warping"], settings: pla },
  ]);

  if (isMobile)
    await page
      .getByRole("navigation", { name: "Sections" })
      .filter({ visible: true })
      .getByRole("link", { name: "Search" })
      .click();
  else await page.keyboard.press("/");
  const box_ = page.getByRole("searchbox", { name: "Search" });
  await expect(box_).toBeFocused();
  await box_.pressSequentially("petg warp");

  const attempts = page.getByRole("region", { name: "Attempts" });
  await expect(attempts.getByRole("link")).toHaveCount(1);
  const result = attempts.getByRole("link", { name: "Swatch box, attempt 1" });
  await expect(result).toContainText("Corners peeled up");
  await expect(result.locator("mark", { hasText: "PETG" })).toBeVisible();
  await expect(page.getByText("Curled base")).toHaveCount(0);
  await expect(page).toHaveURL(/q=petg/);

  // Arrow keys and Enter open it, on the build with the attempt picked.
  if (isMobile) await result.click();
  else {
    await box_.press("ArrowDown");
    await box_.press("Enter");
  }
  await expect(page).toHaveURL(new RegExp(`/builds/${box}\\?attempt=`));
  await expect(
    page.getByRole("list", { name: "Attempts, newest first" }).getByRole("listitem").first(),
  ).toHaveAttribute("aria-current", "true");

  // The search is remembered for next time.
  await page.goto("/search");
  await expect(page.getByRole("region", { name: "Recent" }).getByRole("button", { name: "petg warp" })).toBeVisible();
});

test("filters the journal to failures", async ({ page, isMobile }) => {
  await build(page, "Hook", [
    { outcome: "failed", ago: 5 * HOUR, note: "Nest of noodles", failureTags: ["spaghetti"], settings: pla },
    { outcome: "partial", ago: 4 * HOUR, note: "Slot too tight", failureTags: ["other"], settings: pla },
    { outcome: "success", ago: 3 * HOUR, note: "Clicks on nicely", settings: pla },
  ]);

  await page.goto("/journal");
  await expect(page.getByRole("heading", { name: /so far$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /attempt 3: worked/ })).toBeVisible();
  await expect(page.getByText("Started a build")).toBeVisible();

  await page.getByRole("button", { name: "Only failures" }).click();
  await expect(page).toHaveURL(/outcome=failures/);
  await expect(page.getByRole("link", { name: /attempt 1: spaghetti/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /attempt 2: partly worked/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /attempt 3/ })).toHaveCount(0);
  await expect(page.getByText("Started a build")).toHaveCount(0);

  // The filtered journal is a link: it opens filtered.
  await page.reload();
  await expect(page.getByRole("button", { name: "Only failures" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: /attempt 1: spaghetti/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /attempt 3/ })).toHaveCount(0);

  if (!isMobile) {
    // J walks to the newest entry, Enter opens it.
    await page.keyboard.press("j");
    await expect(page.getByRole("link", { name: /attempt 2: partly worked/ })).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/builds\/.+\?attempt=/);
  }
});

test("starts an attempt from what worked last time", async ({ page, isMobile }) => {
  await build(page, "Desiccant hook", [
    { outcome: "success", ago: 30 * HOUR, note: "Holds the bag", settings: petg(70, { nozzleTemperature: 250 }) },
  ]);
  const chain = await build(page, "Cable chain", [
    {
      outcome: "failed",
      ago: 2 * HOUR,
      failureTags: ["warping"],
      settings: { ...petg(60), bedType: "Cool Plate", filaments: [{ type: "PETG", colorName: "Black" }] },
    },
  ]);

  await page.goto(`/builds/${chain}`);
  if (isMobile) await page.getByRole("button", { name: "Log attempt" }).click();
  else await page.keyboard.press("a");
  const sheet = page.getByRole("dialog", { name: "Attempt 2" });
  const suggestion = sheet.getByRole("region", { name: "What worked last time" });
  await expect(suggestion).toContainText("Desiccant hook");
  await expect(suggestion).toContainText("bed 60 → 70 °C");

  await suggestion.getByRole("button", { name: "Use these settings" }).click();
  await expect(suggestion).toContainText("Starting from these settings");
  await expect(sheet.getByRole("button", { name: /^Settings(?! worth)/ })).toContainText("bed 60 → 70 °C");

  await sheet.getByRole("radio", { name: "Worked" }).click();
  await sheet.getByRole("button", { name: "Log attempt" }).click();
  await expect(sheet).toBeHidden();

  await expect
    .poll(async () => {
      const { item } = await (await page.request.get(`/api/items/${chain}`)).json();
      const settings = item.attempts.at(-1)?.settings;
      return (
        settings && [
          settings.bedTemperature,
          settings.nozzleTemperature,
          settings.bedType,
          settings.filaments[0].colorName,
        ]
      );
    })
    // The plate and temperatures that worked, on this print's own spool.
    .toEqual([70, 250, "Textured PEI Plate", "Black"]);
});
