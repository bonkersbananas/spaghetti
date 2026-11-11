import { readdirSync, readFileSync } from "node:fs";
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

/** Fails with axe's own report when anything serious or critical is found. */
async function expectAccessible(page: Page, what: string, include?: string) {
  // Let entrance animations finish: axe measures contrast mid-fade otherwise.
  await page.waitForTimeout(400);
  // A toast made just before (the toaster loads when the app is idle) may still be sliding in: axe would measure it half faded.
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("[data-sonner-toast]")).every((toast) =>
      toast.getAnimations({ subtree: true }).every((animation) => animation.playState !== "running"),
    ),
  );
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]);
  if (include) builder = builder.include(include);
  // A held (pressed) specimen in the styleguide is a transient state shown at rest: a pressed link dims on purpose.
  builder = builder.exclude("[data-pressed]");
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
    // The seeded build began as an idea, so Ideas ends with its Started section.
    await expect(page.getByRole("heading", { name: /^Started/ })).toBeVisible();
    await expectAccessible(page, "Ideas, with the Started section");

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

/**
 * The screens the axe tests visit, by route file. A new route fails "every screen is checked" until it is visited
 * here (or in the empty states), so axe keeps covering the whole app.
 */
const CHECKED_ROUTES = [
  "today",
  "ideas.index",
  "ideas.$ideaId",
  "builds.index",
  "builds.$buildId",
  "journal",
  "search",
  "pantry.index",
  "pantry.$spoolId",
  "printer",
  "agents",
  "year",
  "deleted",
  "styleguide",
  // Redirects and hand-offs with no screen of their own.
  "index",
  "share",
];

for (const scheme of ["light", "dark"] as const) {
  test(`an idea while Claude reads its page, and once drafted, passes axe in ${scheme}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    const headers = { Origin: origin(page) };
    const id = crypto.randomUUID();
    // The e2e Worker drafts with a stand-in for Claude (scripts/lib/fake-claude.ts); "slow" in the address takes a while.
    await post(page, "/api/items", { headers, data: { id, note: "https://makerworld.com/en/models/2-slow-comb" } });
    // Not awaited: the request answers once the draft is done, and the page should be seen while it is read.
    const drafting = page.request.post(`/api/items/${id}/draft`, { headers, data: {} });
    await page.goto(`/ideas/${id}`);
    await expect(page.getByText(/Reading the MakerWorld page/)).toBeVisible();
    await expectAccessible(page, "An idea while its page is read");
    await drafting;
    await page.reload();
    await expect(page.getByText("Drafted by Claude from MakerWorld")).toBeVisible({ timeout: 20_000 });
    await expectAccessible(page, "A drafted idea");
  });
}

test("every screen is checked", () => {
  const routes = readdirSync("src/client/routes/_app")
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => file.replace(/\.tsx$/, ""));
  expect(routes.filter((route) => !CHECKED_ROUTES.includes(route))).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the rest of the screens and the settings sheets pass axe in ${scheme}`, async ({ page, isMobile }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });

    await screen(page, "/agents", "Agents");
    await expectAccessible(page, "Agents");

    await screen(page, "/year", /\d{4}/);
    await expectAccessible(page, "The year so far");

    await screen(page, "/deleted", "Recently deleted");
    await expectAccessible(page, "Recently deleted");

    // Every specimen in the design system, not just a few sections.
    await screen(page, "/styleguide", "Styleguide");
    await expectAccessible(page, "The styleguide");
    // The back burner's other specimen (one shows at a time).
    await page.getByRole("radio", { name: "A photo" }).evaluate((input: HTMLInputElement) => input.click());
    await expect(page.locator("#today").getByText("Articulated dragon").first()).toBeVisible();
    await expectAccessible(page, "Styleguide: the back burner with a photo", "#today");

    await screen(page, "/pantry", "Pantry");
    await page.getByRole("button", { name: "Add spool" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page, "The add-spool sheet", "[role=dialog]");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await screen(page, "/printer", /X2D|Printer/);
    await page
      .getByRole("button", { name: /Check the belts/ })
      .first()
      .click();
    await expect(page.getByRole("dialog", { name: "Check the belts" })).toBeVisible();
    await expectAccessible(page, "An upkeep task", "[role=dialog]");
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
        if (row === "Notifications") await expectAccessible(page, "The account menu", "[role=dialog]");
        await menu.getByRole("button", { name: row === "Change password" ? "Passkeys and password" : row }).click();
      }
      // Change password lives in the passkeys and password sheet.
      if (row === "Change password") {
        await page.getByRole("dialog", { name: "Passkeys and password" }).getByRole("button", { name: row }).click();
      }
      await expect(page.getByRole("dialog", { name: sheet })).toBeVisible();
      await expectAccessible(page, `The ${sheet.toLowerCase()} sheet`, "[role=dialog]");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });
}

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
    ["/deleted", "Recently deleted"],
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
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
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
