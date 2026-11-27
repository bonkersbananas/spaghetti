import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";
import { signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;
const MINUTE = 60_000;

/** A build with one attempt on the bed, started `ago` ms ago, through the API. */
async function printing(page: Page, title: string, ago: number, estimatedMinutes: number, attemptId?: string) {
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id, title, stage: "building" } });
  const response = await page.request.post(`/api/items/${id}/attempts`, {
    headers,
    data: {
      id: attemptId ?? crypto.randomUUID(),
      outcome: null,
      printedAt: Date.now() - ago,
      settings: { filaments: [{ type: "PLA", brand: "Bambu", colorName: "Green" }], estimatedMinutes },
    },
  });
  expect(response.ok()).toBe(true);
  return id;
}

/** A photo of the build, so its card on the bed leads with a picture. */
async function withPhoto(page: Page, itemId: string) {
  const buffer = readFileSync("e2e/fixtures/tugboat.jpg");
  const response = await page.request.put(`/api/items/${itemId}/photos/${crypto.randomUUID()}`, {
    headers: { Origin: origin(page) },
    multipart: {
      width: "1200",
      height: "900",
      color: "#6b5a4a",
      large: { name: "large.jpg", mimeType: "image/jpeg", buffer },
      thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer },
    },
  });
  expect(response.ok()).toBe(true);
}

/** The printer bridge's token (made once per test), so a print it files asks which build it is (decision 0076). */
let bridge: string | undefined;
let hadBridge = false;
async function bridgeHeaders(page: Page) {
  if (!bridge) {
    const made = await page.request.post("/api/agents", {
      headers: { Origin: origin(page) },
      data: { name: "Printer bridge", scopes: ["read", "attempts", "printer"] },
    });
    expect(made.ok()).toBe(true);
    bridge = (await made.json()).token as string;
    const told = await page.request.put("/api/printer/bridge", {
      headers: { Origin: origin(page), Authorization: `Bearer ${bridge}` },
      data: {},
    });
    expect(told.ok()).toBe(true);
  }
  return { Origin: origin(page), Authorization: `Bearer ${bridge}` };
}

/** How far each card's own content stops short of its foot (px): a card sized to its words has next to none. */
const blankUnder = (cards: Locator) =>
  cards.evaluateAll((articles) =>
    articles.map((article) => {
      const box = article.getBoundingClientRect();
      let bottom = box.top;
      for (const element of Array.from(article.querySelectorAll("*"))) {
        const inner = element.getBoundingClientRect();
        if (inner.height > 0 && inner.height < box.height - 4 && getComputedStyle(element).position !== "absolute")
          bottom = Math.max(bottom, inner.bottom);
      }
      return { height: Math.round(box.height), blank: Math.round(box.bottom - bottom) };
    }),
  );

test.beforeEach(async ({ page }) => {
  await signIn(page);
  hadBridge = !!(await (await page.request.get("/api/printer")).json()).bridge;
});

// Leave nothing behind: other specs count on empty sections.
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
  if (bridge) {
    if (!hadBridge) await page.request.delete("/api/printer/bridge", { headers: { Origin: origin(page) } });
    const { agents } = await (await page.request.get("/api/agents")).json();
    for (const agent of agents)
      for (const token of agent.tokens)
        await page.request.delete(`/api/agents/${agent.id}/tokens/${token.id}`, { headers: { Origin: origin(page) } });
    bridge = undefined;
  }
});

test("phones: the journal opens on what is on the bed, and Finish leads to that attempt", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The Now block is the phone's; desktop has Today.");
  const id = await printing(page, "Bath tugboat", 20 * MINUTE, 120);
  await page.goto("/journal");

  const bed = page.getByRole("region", { name: "On the bed" });
  await expect(page.getByRole("heading", { name: "Now" })).toBeVisible();
  await expect(bed.getByRole("heading", { name: "Bath tugboat" })).toBeVisible();
  await expect(bed.getByRole("button", { name: "Snap this print" })).toBeVisible();
  // The notebook itself is still on the same screen, under it.
  await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();

  await bed.getByRole("button", { name: "How did it go?" }).click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}`));
});

test("phones: a print on the bed shows once, in Now, and joins the notebook once it is logged", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  test.skip(!isMobile, "The Now block is the phone's.");
  const attemptId = crypto.randomUUID();
  await printing(page, "Bath tugboat", 2 * MINUTE, 120, attemptId);
  await page.goto("/journal");

  const bed = page.getByRole("region", { name: "On the bed" });
  await expect(bed.getByRole("heading", { name: "Bath tugboat" })).toBeVisible();
  // The notebook starts under Now (with the build started), and doesn't show the print a second time.
  const firstEntry = page.locator("ol > li").first();
  await expect(firstEntry).toContainText("Bath tugboat");
  const bedBox = await bed.boundingBox();
  const entryBox = await firstEntry.boundingBox();
  expect(bedBox && entryBox && bedBox.y + bedBox.height <= entryBox.y).toBe(true);
  const attemptInNotebook = page.locator(`ol a[href*="attempt=${attemptId}"]`);
  await expect(attemptInNotebook).toHaveCount(0);

  // Logged from right here: it leaves Now and its entry takes its place in the notebook, with how it went.
  await page.getByRole("button", { name: "New idea" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: "This print" }).click();
  await sheet.getByRole("radio", { name: "Worked" }).click();
  await sheet.getByRole("button", { name: "Finish print" }).click();
  await expect(sheet).toBeHidden();
  await expect(bed).toHaveCount(0);
  await expect(attemptInNotebook).toHaveCount(1);
  await expect(attemptInNotebook).toContainText("Worked");
});

test("phones: with nothing printing the journal has no Now block", { tag: "@phone" }, async ({ page, isMobile }) => {
  test.skip(!isMobile, "The Now block is the phone's.");
  await page.goto("/journal");
  await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
  await expect(page.getByRole("region", { name: "On the bed" })).toHaveCount(0);
  // And it leaves nothing behind: no "Now" label, no gap.
  await expect(page.getByRole("heading", { name: "Now" })).toHaveCount(0);
});

test("desktop: the journal has no Now block (Today is in the sidebar)", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "Desktop only.");
  await printing(page, "Bath tugboat", 20 * MINUTE, 120);
  await page.goto("/journal");
  await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
  await expect(page.getByRole("region", { name: "On the bed" })).toHaveCount(0);
});

test("phones: Snap this print on the Journal's card opens the sheet aimed at that print", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The camera is the phone's.");
  await printing(page, "Towel hook", 30 * MINUTE, 90);
  await page.goto("/journal");
  const card = page.locator("article").filter({ hasText: "Towel hook" });
  await expect(card).toBeVisible();
  await card.getByTestId("snap-camera-input").setInputFiles("e2e/fixtures/tugboat.jpg");
  const sheet = page.getByRole("dialog", { name: "Add to the print" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Towel hook, attempt 1, is printing.")).toBeVisible();
});

test("phones: each card in the row of prints is as tall as its own words, a long name on one line", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  test.skip(!isMobile, "The Now block is the phone's.");
  // Off the bed, with a long name: the question and its three answers.
  const offBedAttempt = crypto.randomUUID();
  const long = "Bath tugboat for Mila with a working rudder and a tiny crane";
  await withPhoto(page, await printing(page, long, 3 * 60 * MINUTE, 120, offBedAttempt));
  await page.request.patch(`/api/attempts/${offBedAttempt}`, {
    headers: { Origin: origin(page) },
    data: { endedAt: Date.now() - 10 * MINUTE },
  });
  // Printing: the bar and the time left.
  await withPhoto(page, await printing(page, "Towel hook", 20 * MINUTE, 120));
  // Filed by the printer and answered, still asking which build it is: the card with the least to say.
  const headers = await bridgeHeaders(page);
  const ownId = crypto.randomUUID();
  const filedAttempt = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: ownId, title: "cable-comb-v2", stage: "building" } });
  const filed = await page.request.post(`/api/items/${ownId}/attempts`, {
    headers,
    data: {
      id: filedAttempt,
      printedAt: Date.now() - 60 * MINUTE,
      print: { name: "cable-comb-v2", gcodeFile: "Metadata/plate_1.gcode", plate: 1, estimateMinutes: 40 },
    },
  });
  expect(filed.ok()).toBe(true);
  await withPhoto(page, ownId);
  const answered = await page.request.patch(`/api/attempts/${filedAttempt}`, {
    headers: { Origin: origin(page) },
    data: { outcome: "success", endedAt: Date.now() - 20 * MINUTE },
  });
  expect(answered.ok()).toBe(true);

  await page.goto("/journal");
  const bed = page.getByRole("region", { name: "On the bed" });
  const cards = bed.locator("article");
  await expect(cards).toHaveCount(3);
  await expect(bed.getByRole("region", { name: /^Nothing matched/ })).toBeVisible();
  await expect(bed.getByRole("button", { name: "How did it go?" })).toBeVisible();
  // Let the pictures and the lazy question settle before measuring.
  await page.waitForTimeout(800);

  const sizes = await blankUnder(cards);
  // No card stands over blank room it doesn't fill: each ends where its own content ends...
  for (const { blank } of sizes) expect(blank).toBeLessThanOrEqual(12);
  // ...and the row's cards are built alike, so none sits far shorter than its neighbour (main had 170 px between them).
  const heights = sizes.map(({ height }) => height);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(80);
  // The long name keeps to one line, cut short, rather than making its card the row's tallest.
  const title = bed.getByRole("heading", { name: long });
  const lines = await title.evaluate(
    (node) => node.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(node).lineHeight),
  );
  expect(lines).toBeLessThan(1.5);
});

test("phones: one or two prints stack, each card as tall as its own words", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The Now block is the phone's.");
  await withPhoto(page, await printing(page, "Towel hook", 20 * MINUTE, 120));
  await page.goto("/journal");
  const cards = page.getByRole("region", { name: "On the bed" }).locator("article");
  await expect(cards).toHaveCount(1);
  await page.waitForTimeout(500);
  for (const { blank } of await blankUnder(cards)) expect(blank).toBeLessThanOrEqual(12);

  await withPhoto(page, await printing(page, "Drawer divider", 30 * MINUTE, 90));
  await page.reload();
  await expect(cards).toHaveCount(2);
  await page.waitForTimeout(500);
  for (const { blank } of await blankUnder(cards)) expect(blank).toBeLessThanOrEqual(12);
});

test("phones: the journal's top is the prints, one line per notice, then the filters, and the notebook on the first screen", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  test.skip(!isMobile, "The Now block is the phone's.");
  const id = await printing(page, "Bath tugboat", 20 * MINUTE, 120);
  // The other person writes something long about it.
  const sam = SEED_USERS[1];
  const context = await page
    .context()
    .browser()
    ?.newContext({ baseURL: origin(page) });
  if (!context) throw new Error("no browser");
  try {
    const samPage = await context.newPage();
    await samPage.goto("/sign-in");
    const session = await samPage.request.post("/api/session", {
      headers: { Origin: origin(page) },
      data: { username: sam.username, password: SEED_PASSWORD },
    });
    expect(session.ok()).toBe(true);
    const said = await samPage.request.post(`/api/items/${id}/comments`, {
      headers: { Origin: origin(page) },
      data: {
        id: crypto.randomUUID(),
        body: "Started it tonight with the blue PETG from the top shelf, and the brim looks good so far. Fingers crossed.",
      },
    });
    expect(said.ok()).toBe(true);
  } finally {
    await context.close();
  }

  await page.goto("/journal");
  const bed = page.getByRole("region", { name: "On the bed" });
  const comment = page.getByRole("link", { name: /Started it tonight/ });
  const filters = page.getByRole("group", { name: "Filters" });
  const firstEntry = page.locator("ol > li").first();
  await expect(bed).toBeVisible();
  await expect(comment).toBeVisible();
  await expect(firstEntry).toBeVisible();

  const top = async (locator: Locator) => (await locator.boundingBox())?.y ?? Number.NaN;
  const bedTop = await top(bed);
  const commentTop = await top(comment);
  const filtersTop = await top(filters);
  const entryTop = await top(firstEntry);
  // In this order: the print, the notice under it, the filters, then the notebook.
  expect(bedTop).toBeLessThan(commentTop);
  expect(commentTop).toBeLessThan(filtersTop);
  expect(filtersTop).toBeLessThan(entryTop);
  // The notice is one line, cut short (44 px of room), however long the comment.
  expect((await comment.boundingBox())?.height).toBeLessThanOrEqual(48);
  // And the notebook starts on the first screen.
  expect(entryTop).toBeLessThan(page.viewportSize()?.height ?? 0);
});

test("phones: the filter row scrolls sideways edge to edge and fades where there is more", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The chip row scrolls on phones; desktop wraps it.");
  // A notebook with something in it (an empty one has no filters).
  await printing(page, "Bath tugboat", 20 * MINUTE, 120);
  await page.goto("/journal");
  const filters = page.getByRole("group", { name: "Filters" });
  await expect(filters.getByRole("button", { name: "Only failures" })).toBeVisible();
  const width = page.viewportSize()?.width ?? 0;
  const box = await filters.boundingBox();
  // Edge to edge: from the screen's left edge to its right.
  expect(Math.round(box?.x ?? -1)).toBe(0);
  expect(Math.round(box?.width ?? 0)).toBe(width);
  const scrolls = await filters.evaluate((node) => node.scrollWidth > node.clientWidth);
  // The end with more to see fades out; the start, scrolled to, does not.
  const fades = () =>
    filters.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        start: Number.parseFloat(style.getPropertyValue("--sg-fade-start")),
        end: Number.parseFloat(style.getPropertyValue("--sg-fade-end")),
      };
    });
  if (scrolls) {
    expect(await fades()).toEqual({ start: 0, end: expect.any(Number) });
    expect((await fades()).end).toBeGreaterThan(0);
    await filters.evaluate((node) => node.scrollTo({ left: node.scrollWidth }));
    await expect.poll(async () => (await fades()).end).toBe(0);
    expect((await fades()).start).toBeGreaterThan(0);
  } else {
    expect(await fades()).toEqual({ start: 0, end: 0 });
  }
});
