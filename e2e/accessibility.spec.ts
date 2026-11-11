import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

/**
 * axe on the main screens and sheets, in light and dark, at the project's
 * width (phone and desktop). Also the phone details axe can't see: fields
 * at 16 px or more (iOS Safari zooms into smaller ones) and focus that
 * returns where it was when a sheet closes.
 */

const origin = (page: Page) => new URL(page.url()).origin;
const photo = readFileSync("e2e/fixtures/tugboat.jpg");

interface Seeded {
  ideaId: string;
  buildId: string;
  spoolId: string;
}

async function post(page: Page, url: string, options: Parameters<Page["request"]["post"]>[1]) {
  const response = await page.request.post(url, options);
  expect(response.ok(), `${url}: ${response.status()} ${await response.text()}`).toBe(true);
}

async function seed(page: Page): Promise<Seeded> {
  const headers = { Origin: origin(page) };
  const ideaId = crypto.randomUUID();
  const buildId = crypto.randomUUID();
  const spoolId = crypto.randomUUID();
  await page.request.post("/api/spools", {
    headers,
    data: { id: spoolId, material: "PETG", brand: "Bambu", colorName: "Teal", colorHex: "#2a8a85" },
  });
  await page.request.post("/api/items", {
    headers,
    data: {
      id: ideaId,
      title: "Bath tugboat",
      note: "Chunky enough for small hands. Model: https://www.printables.com/model/42-drawer-bins",
    },
  });
  await page.request.put(`/api/items/${ideaId}/photos/${crypto.randomUUID()}`, {
    headers,
    multipart: {
      width: "1200",
      height: "900",
      color: "#6b5a4a",
      position: "0",
      large: { name: "large.jpg", mimeType: "image/jpeg", buffer: photo },
      thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: photo },
    },
  });
  await page.request.post("/api/items", { headers, data: { id: buildId, title: "Cable chain", note: "" } });
  const filaments = [{ type: "PETG", brand: "Bambu", colorName: "Teal", colorHex: "#2a8a85", spoolId }];
  await post(page, `/api/items/${buildId}/attempts`, {
    headers,
    data: {
      id: crypto.randomUUID(),
      outcome: "failed",
      note: "Corners lifted",
      failureTags: ["warping"],
      settings: { filaments, bedTemperature: 70, layerHeight: 0.2 },
    },
  });
  await post(page, `/api/items/${buildId}/attempts`, {
    headers,
    data: {
      id: crypto.randomUUID(),
      outcome: "success",
      settings: { filaments, bedTemperature: 80, layerHeight: 0.2, brim: true },
    },
  });
  return { ideaId, buildId, spoolId };
}

async function clearSpools(page: Page) {
  const headers = { Origin: origin(page) };
  const response = await page.request.get("/api/spools");
  if (!response.ok()) return;
  const { spools } = await response.json();
  for (const spool of spools) await page.request.delete(`/api/spools/${spool.id}`, { headers });
}

/** Fails with axe's own report when anything serious or critical is found. */
async function expectAccessible(page: Page, what: string, include?: string) {
  // Let entrance animations finish: axe measures contrast mid-fade otherwise.
  await page.waitForTimeout(400);
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  const report = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n${v.nodes
        .slice(0, 5)
        .map((n) => `    ${n.target.join(" ")}  ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`)
        .join("\n")}`,
  );
  expect(report, `${what}: axe found\n${report.join("\n")}`).toEqual([]);
}

async function screen(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading }).first()).toBeVisible();
}

let data: Seeded;

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
  await clearSpools(page);
  data = await seed(page);
});

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
  await clearSpools(page);
});

for (const scheme of ["light", "dark"] as const) {
  test(`main screens pass axe in ${scheme}`, async ({ page, isMobile }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });

    await screen(page, "/ideas", "Ideas");
    await expectAccessible(page, "Ideas");

    await screen(page, `/ideas/${data.ideaId}`, "Bath tugboat");
    await expectAccessible(page, "An idea");

    await screen(page, "/today", "Today");
    await expectAccessible(page, "Today");

    await screen(page, "/builds", "Builds");
    await expectAccessible(page, "Builds");

    await page.goto(`/builds/${data.buildId}`);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
    await expectAccessible(page, "A build");
    // The compare sheet (a changes line is the way in; the seeded build changed its bed temperature and brim).
    await page
      .getByRole("button", { name: /Compare$/ })
      .first()
      .click();
    await expect(page.getByRole("dialog", { name: "Attempt 1 and attempt 2" })).toBeVisible();
    await expectAccessible(page, "The compare sheet", "[role=dialog]");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await screen(page, "/journal", "Journal");
    await expect(page.getByText("Corners lifted").first()).toBeVisible();
    await expectAccessible(page, "Journal");

    await page.goto("/year");
    await expect(page.getByRole("heading", { level: 2, name: "Prints by month" })).toBeVisible();
    await expectAccessible(page, "Year so far");

    await screen(page, "/search?q=warping", "Search");
    await expect(page.getByRole("region", { name: "Attempts" })).toBeVisible();
    await expectAccessible(page, "Search results");

    await screen(page, "/pantry", "Pantry");
    await expectAccessible(page, "Pantry");
    if (!isMobile) {
      // The desktop list (phones always show cards); the choice is put back for the next theme.
      await page.getByRole("radio", { name: "List" }).click();
      await expect(page.getByRole("list", { name: "PETG spools" })).toBeVisible();
      await expectAccessible(page, "Pantry as a list");
      await page.getByRole("radio", { name: "Cards" }).click();
    }

    await page.goto(`/pantry/${data.spoolId}`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expectAccessible(page, "A spool");

    await screen(page, "/printer", /X2D|Printer/);
    await expectAccessible(page, "Printer");

    // The design system's building blocks: print progress, the outcome strip and the spool rims (white and black).
    await screen(page, "/styleguide", "Styleguide");
    await expectAccessible(page, "Styleguide: builds and attempts", "#builds");
    await expectAccessible(page, "Styleguide: pantry and printer", "#pantry");

    // Sheets: capture, an attempt, and the account (phone) or account menu (desktop).
    await screen(page, "/ideas", "Ideas");
    await page.getByRole("button", { name: "New idea" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page, "The capture sheet", "[role=dialog]");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.goto(`/builds/${data.buildId}`);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
    await page
      .getByRole("button", { name: /^Log attempt/ })
      .first()
      .click();
    await expect(page.getByRole("dialog", { name: "Attempt 3" })).toBeVisible();
    await expectAccessible(page, "The attempt sheet", "[role=dialog]");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    if (isMobile) {
      await screen(page, "/ideas", "Ideas");
      await page.getByRole("button", { name: "Account" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectAccessible(page, "The account sheet", "[role=dialog]");
    } else {
      await screen(page, "/ideas", "Ideas");
      await page.keyboard.press("ControlOrMeta+k");
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectAccessible(page, "The command palette", "[role=dialog]");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.keyboard.press("?");
      await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
      await expectAccessible(page, "The shortcut list", "[role=dialog]");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Account menu" }).click();
      await expect(page.getByRole("dialog", { name: "Account" })).toBeVisible();
      await expectAccessible(page, "The account menu", "[role=dialog]");
    }

    // The profile picture: the crop sheet, then the account menu showing it.
    await page.getByTestId("profile-photo-input").setInputFiles("e2e/fixtures/portrait.jpg");
    const crop = page.getByRole("dialog", { name: "Your picture" });
    await expect(crop.getByTestId("crop-frame").locator("img")).toBeVisible();
    await expectAccessible(page, "The crop sheet", "[role=dialog]");
    await crop.getByRole("button", { name: "Save" }).click();
    await expect(crop).toBeHidden();
    await expect
      .poll(async () => (await (await page.request.get("/api/session")).json()).user.photoUrl, { timeout: 15_000 })
      .toMatch(/\/photo\?v=/);
    await page.reload();
    await page.getByRole("button", { name: isMobile ? "Account" : "Account menu" }).click();
    await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();
    await expect(page.getByRole("dialog").locator("img[src*='/api/people/']").first()).toBeVisible();
    await expectAccessible(page, "The account menu with a picture", "[role=dialog]");
    await page.request.delete("/api/people/me/photo", { headers: { Origin: origin(page) } });
  });
}

test("empty states and sign-in pass axe", async ({ page }) => {
  await clearIdeas(page);
  await clearSpools(page);
  for (const [path, heading] of [
    ["/today", "Today"],
    ["/ideas", "Ideas"],
    ["/builds", "Builds"],
    ["/journal", "Journal"],
    ["/search", "Search"],
    ["/pantry", "Pantry"],
  ] as const) {
    await screen(page, path, heading);
    await expect(page.getByRole("button").or(page.getByRole("link")).first()).toBeVisible();
    await expectAccessible(page, `Empty ${heading}`);
  }
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expectAccessible(page, "Sign-in");
});

test("fields are 16 px or larger on phones, so iOS Safari doesn't zoom in", async ({ page, isMobile }) => {
  test.skip(!isMobile, "A phone-only rule");
  const small = async () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("input:not([type=file]):not([type=radio]), textarea, select"))
        .filter((field) => field.offsetParent !== null && Number.parseFloat(getComputedStyle(field).fontSize) < 16)
        .map((field) => field.getAttribute("aria-label") ?? field.id ?? field.outerHTML.slice(0, 80)),
    );

  await screen(page, "/search", "Search");
  expect(await small()).toEqual([]);

  await page.goto(`/builds/${data.buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  expect(await small()).toEqual([]);
  await page
    .getByRole("button", { name: /^Log attempt/ })
    .first()
    .click();
  const sheet = page.getByRole("dialog", { name: "Attempt 3" });
  await sheet.getByRole("radio", { name: "Spaghetti" }).click();
  await sheet.getByRole("button", { name: "Add your own" }).click();
  await sheet.getByRole("button", { name: /^Settings(?! worth)/ }).click();
  await expect(sheet.getByLabel("Bed", { exact: true })).toBeVisible();
  expect(await small()).toEqual([]);
  await page.keyboard.press("Escape");

  await page.goto(`/pantry/${data.spoolId}`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  expect(await small()).toEqual([]);

  await screen(page, "/printer", /X2D|Printer/);
  expect(await small()).toEqual([]);
});

test("a phone sheet keeps its main button above the on-screen keyboard", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Only phones have an on-screen keyboard");
  await screen(page, "/ideas", "Ideas");
  await page.getByRole("button", { name: "New idea" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New idea" });
  await sheet.getByRole("textbox", { name: "Note" }).fill("A hook for the desiccant");
  // What iOS Safari does when the keyboard comes up: the layout stays, the visual viewport shrinks.
  const keyboardTop = 844 - 336;
  await page.evaluate((height) => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("No visualViewport");
    Object.defineProperty(viewport, "height", { configurable: true, get: () => height });
    viewport.dispatchEvent(new Event("resize"));
  }, keyboardTop);
  const save = sheet.getByRole("button", { name: "Save idea" });
  await expect.poll(async () => (await save.boundingBox())?.y ?? 9999).toBeLessThan(keyboardTop - 44);
  await expect(sheet.getByRole("heading", { name: "New idea" })).toBeInViewport();
});

test("closing a sheet puts focus back on what opened it", async ({ page, isMobile }) => {
  await page.goto(`/builds/${data.buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  const open = page.getByRole("button", { name: /^Log attempt/ }).first();
  await open.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Attempt 3" });
  await expect(sheet).toBeVisible();
  // Focus moves into the sheet and stays there while tabbing.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const outside = await page.evaluate(() =>
      document.activeElement?.closest("[role=dialog]")
        ? null
        : (document.activeElement?.outerHTML.slice(0, 160) ?? "nothing"),
    );
    expect(outside, "focus left the sheet").toBeNull();
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(isMobile ? open : page.getByRole("button", { name: /^Log attempt/ }).first()).toBeFocused();
});
