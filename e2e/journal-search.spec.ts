import { expect, type Page, test } from "@playwright/test";
import { signIn as signInThroughApi } from "./helpers";

const signIn = (page: Page) => signInThroughApi(page);

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

test("finds an attempt by a failure tag plus a material", { tag: "@phone" }, async ({ page, isMobile }) => {
  const box = await build(page, "Swatch box", [
    { outcome: "failed", ago: 3 * HOUR, note: "Corners peeled up", failureTags: ["warping"], settings: petg(70) },
  ]);
  await build(page, "Vase", [
    { outcome: "failed", ago: 2 * HOUR, note: "Curled base", failureTags: ["warping"], settings: pla },
  ]);

  // On phones search is the button in the page header; on desktop it is the / key.
  if (isMobile) await page.getByRole("link", { name: "Search" }).click();
  else await page.keyboard.press("/");
  const box_ = page.getByRole("searchbox", { name: "Search" });
  await expect(box_).toBeFocused();
  await box_.pressSequentially("petg warp");

  const attempts = page.getByRole("region", { name: "Attempts" });
  await expect(attempts.getByRole("link")).toHaveCount(1);
  const result = attempts.getByRole("link", { name: /Swatch box · attempt 1/ });
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

test("a search no print has every word of shows the closest, and a word on its own narrows it", {
  tag: "@phone",
}, async ({ page }) => {
  await build(page, "Swatch box", [
    { outcome: "success", ago: 3 * HOUR, note: "Clean supports", settings: pla },
    { outcome: "failed", ago: 2 * HOUR, note: "Corners peeled up", failureTags: ["warping"], settings: petg(70) },
  ]);
  await page.goto("/search?q=petg%20supports");
  await expect(page.getByText("Nothing has both. Closest first:")).toBeVisible();
  // Both prints are there at once: the one with the PETG and the one with the supports.
  await expect(page.getByText("Corners peeled up")).toBeVisible();
  await expect(page.getByText("Clean supports")).toBeVisible();
  await page.getByRole("button", { name: "supports", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue("supports");
  await expect(page.getByText("Nothing has both")).toHaveCount(0);
  await expect(page.getByText("Clean supports")).toBeVisible();
  await expect(page.getByText("Corners peeled up")).toHaveCount(0);
  // No word matches at all: the pot.
  await page.goto("/search?q=zzzz%20qqqq");
  await expect(page.getByRole("heading", { name: "Not a single strand" })).toBeVisible();
});

test("filters the journal to failures", async ({ page, isMobile }) => {
  await build(page, "Hook", [
    { outcome: "failed", ago: 5 * HOUR, note: "Nest of noodles", failureTags: ["spaghetti"], settings: pla },
    { outcome: "partial", ago: 4 * HOUR, note: "Slot too tight", failureTags: ["other"], settings: pla },
    { outcome: "success", ago: 3 * HOUR, note: "Clicks on nicely", settings: pla },
  ]);

  await page.goto("/journal");
  await expect(page.getByRole("heading", { name: /so far$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Worked.*attempt 3/ })).toBeVisible();
  await expect(page.getByText("Started a build")).toBeVisible();

  // F is the keyboard's way to the chip, on and off (desktop).
  if (!isMobile) {
    await page.keyboard.press("f");
    await expect(page).toHaveURL(/outcome=failures/);
    await page.keyboard.press("f");
    await expect(page).not.toHaveURL(/outcome=failures/);
  }
  await page.getByRole("button", { name: "Only failures" }).click();
  await expect(page).toHaveURL(/outcome=failures/);
  await expect(page.getByRole("link", { name: /^Spaghetti.*attempt 1/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Partly.*attempt 2/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /attempt 3/ })).toHaveCount(0);
  await expect(page.getByText("Started a build")).toHaveCount(0);

  // The filtered journal is a link: it opens filtered.
  await page.reload();
  await expect(page.getByRole("button", { name: "Only failures" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: /^Spaghetti.*attempt 1/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /attempt 3/ })).toHaveCount(0);

  if (!isMobile) {
    // J walks to the newest entry, Enter opens it.
    await page.keyboard.press("j");
    await expect(page.getByRole("link", { name: /^Partly.*attempt 2/ })).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/builds\/.+\?attempt=/);
  }
});

test("starts an attempt from what worked last time", { tag: "@phone" }, async ({ page, isMobile }) => {
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
  // The build has to be on screen before its shortcut does anything.
  await expect(page.getByRole("heading", { level: 1, name: "Cable chain" })).toBeVisible();
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

test("a row without a photo shows its icon once, and a print in progress shows how far along it is", async ({
  page,
}) => {
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id: crypto.randomUUID(), title: "Plain idea" } });
  const id = await build(page, "Printing now", []);
  const response = await page.request.post(`/api/items/${id}/attempts`, {
    headers,
    data: {
      id: crypto.randomUUID(),
      outcome: null,
      printedAt: Date.now() - 20 * 60_000,
      settings: { ...pla, estimatedMinutes: 60 },
    },
  });
  expect(response.ok()).toBe(true);

  await page.goto("/journal");
  const row = page.getByRole("link", { name: /Captured an idea.*Plain idea/ });
  await expect(row).toBeVisible();
  // The tile carries the icon: the label beside it has none.
  await expect(row.locator("svg")).toHaveCount(1);

  // The build's "Started a build" row has its name too: only the attempt card says which attempt it is.
  const card = page.getByRole("link", { name: /Printing now.*attempt 1/ });
  await expect(card.getByRole("progressbar", { name: "Print progress" })).toBeVisible();
  await expect(card.getByText(/min left/)).toBeVisible();
});

test("a problem's word leads with what fixed it, and the times it happened fold to three", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  // The swatch box of the seed: it peeled, still warped with a brim, then lay flat with the filament dried.
  const box = await build(page, "Swatch box", [
    {
      outcome: "failed",
      ago: 50 * HOUR,
      note: "Corners peeled off the cool plate",
      failureTags: ["warping", "bed-adhesion"],
      settings: petg(70, { bedType: "Cool Plate" }),
    },
    { outcome: "partial", ago: 30 * HOUR, note: "Long walls still lift", failureTags: ["warping"], settings: petg(80) },
    { outcome: "success", ago: 10 * HOUR, note: "Flat as a board", settings: petg(80, { filamentDried: true }) },
  ]);
  // Warped prints that never got better: still there, under what fixed it.
  for (const title of ["Cable chain", "Drawer divider", "Vase"])
    await build(page, title, [
      { outcome: "failed", ago: 5 * HOUR, note: "Curled at the ends", failureTags: ["warping"], settings: pla },
    ]);

  await page.goto("/search?q=warping");
  const fixed = page.getByRole("region", { name: "What fixed it" });
  const fix = fixed.getByRole("link", { name: /Swatch box · attempt 3/ });
  await expect(fix).toBeVisible();
  // The failure it came after, what changed since then, and its note.
  await expect(fix).toContainText(/After Partly .* · Warping/);
  await expect(fix).toContainText("dried the filament");
  await expect(fix).toContainText("Flat as a board");
  // It leads: nothing comes before it, and it isn't said again under What worked.
  await expect(page.getByRole("region").first()).toHaveAccessibleName("What fixed it");
  await expect(page.getByRole("region", { name: "What worked" })).toHaveCount(0);

  // The five failures fold to three, and "Show all 5" opens the rest.
  const happened = page.getByRole("region", { name: "Times it happened" });
  await expect(happened.getByRole("link")).toHaveCount(3);
  await happened.getByRole("button", { name: "Show all 5" }).click();
  await expect(happened.getByRole("link")).toHaveCount(5);
  await expect(happened.getByRole("button", { name: /Show all/ })).toHaveCount(0);

  // One tap starts again on those settings.
  await fixed.getByRole("button", { name: /Start again/ }).click();
  await expect(page).toHaveURL(new RegExp(`/builds/${box}\\?attempt=`));
  await expect(page.getByText("Started again")).toBeVisible();
  await expect
    .poll(async () => {
      const { item } = await (await page.request.get(`/api/items/${box}`)).json();
      const latest = item.attempts.at(-1);
      return item.attempts.length === 4 && latest.outcome === null ? latest.settings.filamentDried : null;
    })
    .toBe(true);

  if (isMobile) return;
  // On a laptop the palette answers the same question the same way.
  await page.goto("/ideas");
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await dialog.getByRole("combobox", { name: "Jump to or run" }).pressSequentially("warping");
  const group = dialog.getByRole("group", { name: "What fixed it" });
  await expect(group.getByRole("option", { name: /Swatch box, attempt 3/ })).toContainText("dried the filament");
});
