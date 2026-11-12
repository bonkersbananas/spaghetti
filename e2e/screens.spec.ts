import { readdirSync, readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { mondayOf } from "../src/shared/week.ts";
import { clearIdeas, signIn } from "./helpers";

/**
 * Every screen and sheet opens, at the project's width, on a small seeded notebook (an idea with a photo, a build
 * with two attempts, a spool); "every screen is checked" keeps a new route from being left out. Then the details a
 * phone or a keyboard needs: 44 px touch targets, fields at 16 px or more (iOS Safari zooms into smaller ones), a
 * sheet's main button above the on-screen keyboard, visible focus, and focus that returns where it was when a sheet
 * closes. (It used to run axe on all of it, in both themes: accessibility checks of their own aren't needed for the
 * two people who use the app.)
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
  // Captured a minute ago, so the attempt below starts it later and Ideas shows it under Started
  // (on a fast machine both could otherwise land in the same millisecond).
  await page.request.post("/api/items", {
    headers,
    data: { id: buildId, title: "Cable chain", note: "", createdAt: Date.now() - 60_000 },
  });
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

test("the main screens and their sheets open", async ({ page, isMobile }) => {
  test.setTimeout(120_000);

  await screen(page, "/ideas", "Ideas");
  // The seeded build began as an idea, so Ideas ends with its Started section.
  await expect(page.getByRole("heading", { name: /^Started/ })).toBeVisible();

  await screen(page, `/ideas/${data.ideaId}`, "Bath tugboat");

  await page.request.put(`/api/wishlists/me/items/${data.ideaId}`, { headers: { Origin: origin(page) }, data: {} });
  await screen(page, "/wishlist", "Wishlists");
  await expect(page.getByRole("list", { name: "Your wishlist" })).toBeVisible();

  await screen(page, "/today", "Today");

  await screen(page, "/builds", "Builds");

  await page.goto(`/builds/${data.buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  // The compare sheet (a changes line is the way in; the seeded build changed its bed temperature and brim).
  await page
    .getByRole("button", { name: /Compare$/ })
    .first()
    .click();
  await expect(page.getByRole("dialog", { name: "Attempt 1 and attempt 2" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await screen(page, "/journal", "Journal");
  await expect(page.getByText("Corners lifted").first()).toBeVisible();

  // The week: this week holds the seeded prints, and a week long ago is empty.
  await screen(page, `/week/${mondayOf(Date.now())}`, "This week");
  await expect(page.getByRole("heading", { level: 2, name: /^The week in a few lines/ })).toBeVisible();
  await screen(page, "/week/2024-01-01", /2024/);
  await expect(page.getByRole("heading", { level: 2, name: "Not a strand this week" })).toBeVisible();

  await page.goto("/year");
  await expect(page.getByRole("heading", { level: 2, name: "Prints by month" })).toBeVisible();

  await screen(page, "/search?q=warping", "Search");
  await expect(page.getByRole("region", { name: "Attempts" })).toBeVisible();

  await screen(page, "/pantry", "Pantry");
  if (!isMobile) {
    // The desktop list (phones always show cards); the choice is put back for the next theme.
    await page.getByRole("radio", { name: "List" }).click();
    await expect(page.getByRole("list", { name: "PETG spools" })).toBeVisible();
    await page.getByRole("radio", { name: "Cards" }).click();
  }

  await page.goto(`/pantry/${data.spoolId}`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

  await screen(page, "/printer", /X2D|Printer/);

  await screen(page, "/shopping", "Shopping list");

  // The design system's building blocks: print progress, the outcome strip and the spool rims (white and black).
  await screen(page, "/styleguide", "Styleguide");

  // Sheets: capture, an attempt, and the account (phone) or account menu (desktop).
  await screen(page, "/ideas", "Ideas");
  await page.getByRole("button", { name: "New idea" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto(`/builds/${data.buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  await page
    .getByRole("button", { name: /^Log attempt/ })
    .first()
    .click();
  await expect(page.getByRole("dialog", { name: "Attempt 3" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  if (isMobile) {
    await screen(page, "/ideas", "Ideas");
    await page.getByRole("button", { name: "Account" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  } else {
    await screen(page, "/ideas", "Ideas");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("dialog", { name: "Account" })).toBeVisible();
  }

  // The profile picture: the crop sheet, then the account menu showing it.
  await page.getByTestId("profile-photo-input").setInputFiles("e2e/fixtures/portrait.jpg");
  const crop = page.getByRole("dialog", { name: "Your picture" });
  await expect(crop.getByTestId("crop-frame").locator("img")).toBeVisible();
  await crop.getByRole("button", { name: "Save" }).click();
  await expect(crop).toBeHidden();
  await expect
    .poll(async () => (await (await page.request.get("/api/session")).json()).user.photoUrl, { timeout: 15_000 })
    .toMatch(/\/photo\?v=/);
  await page.reload();
  await page.getByRole("button", { name: isMobile ? "Account" : "Account menu" }).click();
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();
  await expect(page.getByRole("dialog").locator("img[src*='/api/people/']").first()).toBeVisible();
  await page.request.delete("/api/people/me/photo", { headers: { Origin: origin(page) } });
});

/**
 * The screens the tests above visit, by route file. A new route fails "every screen is checked" until it is visited
 * here, so every screen keeps being opened at both widths.
 */
const CHECKED_ROUTES = [
  "today",
  "ideas.index",
  "ideas.$ideaId",
  "wishlist",
  "builds.index",
  "builds.$buildId",
  "journal",
  "search",
  "pantry.index",
  "pantry.$spoolId",
  "printer",
  "shopping",
  "agents",
  "year",
  "week.$monday",
  "deleted",
  "styleguide",
  // Redirects and hand-offs with no screen of their own.
  "index",
  "share",
];

test("every screen is checked", () => {
  const routes = readdirSync("src/client/routes/_app")
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => file.replace(/\.tsx$/, ""));
  expect(routes.filter((route) => !CHECKED_ROUTES.includes(route))).toEqual([]);
});

test("the rest of the screens and the settings sheets open", async ({ page, isMobile }) => {
  test.setTimeout(120_000);

  await screen(page, "/agents", "Agents");

  await screen(page, "/year", /\d{4}/);

  await screen(page, "/deleted", "Deleted");

  // Every specimen in the design system, not just a few sections.
  await screen(page, "/styleguide", "Styleguide");
  // The back burner's other specimen (one shows at a time).
  await page.getByRole("radio", { name: "A photo" }).evaluate((input: HTMLInputElement) => input.click());
  await expect(page.locator("#today").getByText("Articulated dragon").first()).toBeVisible();

  await screen(page, "/pantry", "Pantry");
  await page.getByRole("button", { name: "Add spool" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await screen(page, "/printer", /X2D|Printer/);
  await page
    .getByRole("button", { name: /Check the belts/ })
    .first()
    .click();
  await expect(page.getByRole("dialog", { name: "Check the belts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The account's own sheets, from the account sheet (phones) or the account menu (desktop).
  for (const [row, sheet] of [
    ["Notifications", "Notifications"],
    ["Change password", "Change password"],
  ] as const) {
    await screen(page, "/ideas", "Ideas");
    if (isMobile) {
      await page.getByRole("button", { name: "Account" }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: row === "Change password" ? "Passkeys and password" : row })
        .click();
    } else {
      await page.getByRole("button", { name: "Account menu" }).click();
      const menu = page.getByRole("dialog", { name: "Account" });
      await expect(menu).toBeVisible();
      await menu.getByRole("button", { name: row === "Change password" ? "Passkeys and password" : row }).click();
    }
    // Change password lives in the passkeys and password sheet.
    if (row === "Change password") {
      await page.getByRole("dialog", { name: "Passkeys and password" }).getByRole("button", { name: row }).click();
    }
    await expect(page.getByRole("dialog", { name: sheet })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

/**
 * Controls drawn smaller than 44 px that have no 44 px hit area (`touch-target`), on the visible page or in a sheet.
 * Links inside running text are left out, as WCAG does.
 */
async function smallTargets(page: Page, within = "body") {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector) ?? document.body;
    const small: string[] = [];
    const controls = root.querySelectorAll<HTMLElement>(
      "a[href], button, [role=switch], [role=radio], [role=checkbox], input:not([type=hidden]), select, textarea, summary",
    );
    for (const control of Array.from(controls)) {
      if (control.closest("[aria-hidden=true], [inert]")) continue;
      // Marked by hand where 44 px can't fit and the same thing is a big target nearby (the outcome strip's dots).
      if (control.hasAttribute("data-small-target")) continue;
      const box = control.getBoundingClientRect();
      // Hidden, or a native radio under a drawn control (SegmentedControl).
      if (box.width <= 1 || box.height <= 1) continue;
      const style = getComputedStyle(control);
      if (style.visibility === "hidden") continue;
      if (control.tagName === "A" && style.display === "inline" && control.parentElement?.closest("p")) continue;
      // A writing surface that reads as text (a title, the "for" line) is tapped anywhere along its full width.
      if ((control.tagName === "TEXTAREA" || control.tagName === "INPUT") && box.width >= 160 && box.height >= 28)
        continue;
      // A link around a button (the app's way to give a link a button's look) is as big as the button it holds.
      if (control.tagName === "A" && control.querySelector("button")) continue;
      // The hit area: the control, its touch-target (an ::after), or the label it sits in and that label's.
      let width = 0;
      let height = 0;
      for (const element of [control, control.closest("label")]) {
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        const hit = getComputedStyle(element, "::after");
        const extended = hit.content !== "none" && hit.position === "absolute";
        width = Math.max(width, rect.width, extended ? Number.parseFloat(hit.width) || 0 : 0);
        height = Math.max(height, rect.height, extended ? Number.parseFloat(hit.height) || 0 : 0);
      }
      if (width < 43.5 || height < 43.5) {
        const name = (control.getAttribute("aria-label") ?? control.textContent ?? "").trim().slice(0, 40);
        small.push(`${Math.round(width)}×${Math.round(height)} ${control.tagName.toLowerCase()} "${name}"`);
      }
    }
    return small;
  }, within);
}

test("every control on a phone has a 44 px target", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Touch targets are a phone rule; desktop has a pointer");
  test.setTimeout(180_000);
  const screens: Array<[string, string | RegExp]> = [
    ["/today", "Today"],
    ["/ideas", "Ideas"],
    [`/ideas/${data.ideaId}`, "Bath tugboat"],
    ["/builds", "Builds"],
    ["/journal", "Journal"],
    ["/search?q=warping", "Search"],
    ["/pantry", "Pantry"],
    [`/pantry/${data.spoolId}`, /Teal|PETG/],
    ["/printer", /X2D|Printer/],
    ["/agents", "Agents"],
    ["/year", /\d{4}/],
    ["/deleted", "Deleted"],
  ];
  for (const [path, heading] of screens) {
    await screen(page, path, heading);
    await page.waitForTimeout(400);
    expect(await smallTargets(page), path).toEqual([]);
  }
  await page.goto(`/builds/${data.buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  expect(await smallTargets(page), "A build").toEqual([]);

  // The sheets: capture, the account sheet.
  await screen(page, "/ideas", "Ideas");
  await page.getByRole("button", { name: "New idea" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(400);
  expect(await smallTargets(page, "[role=dialog]"), "The capture sheet").toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(400);
  expect(await smallTargets(page, "[role=dialog]"), "The account sheet").toEqual([]);
});

/** Whether the focused element shows the focus ring: a box shadow or an outline. */
async function focusShows(page: Page) {
  return page.evaluate(() => {
    const focused = document.activeElement as HTMLElement | null;
    if (!focused || focused === document.body) return "nothing focused";
    const style = getComputedStyle(focused);
    const ring =
      style.boxShadow !== "none" || (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0);
    const name = (focused.getAttribute("aria-label") ?? focused.textContent ?? focused.tagName).trim().slice(0, 40);
    return ring ? null : `no visible focus on ${focused.tagName.toLowerCase()} "${name}"`;
  });
}

test("keyboard focus is visible in the sheets and menus", async ({ page, isMobile }) => {
  test.skip(isMobile, "Keyboard use is a desktop thing here");
  const tabThrough = async (what: string, steps = 8) => {
    const missing: string[] = [];
    for (let step = 0; step < steps; step++) {
      await page.keyboard.press("Tab");
      const problem = await focusShows(page);
      if (problem) missing.push(problem);
    }
    expect(missing, what).toEqual([]);
  };

  await screen(page, "/ideas", "Ideas");
  await page.keyboard.press("c");
  await expect(page.getByRole("dialog")).toBeVisible();
  await tabThrough("The capture sheet", 5);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Account menu" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Account" })).toBeVisible();
  await tabThrough("The account menu", 7);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("dialog", { name: "Account" }).getByRole("button", { name: "Passkeys and password" }).click();
  await page
    .getByRole("dialog", { name: "Passkeys and password" })
    .getByRole("button", { name: "Change password" })
    .click();
  await expect(page.getByRole("dialog", { name: "Change password" })).toBeVisible();
  await tabThrough("The change-password sheet", 5);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto(`/builds/${data.buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  await page
    .getByRole("button", { name: /^Log attempt/ })
    .first()
    .click();
  await expect(page.getByRole("dialog", { name: "Attempt 3" })).toBeVisible();
  // A desktop sheet starts at its first control, not the header's Close.
  await expect(
    page.getByRole("dialog", { name: "Attempt 3" }).getByRole("button", { name: "Close" }),
  ).not.toBeFocused();
  await tabThrough("The attempt sheet", 10);
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
