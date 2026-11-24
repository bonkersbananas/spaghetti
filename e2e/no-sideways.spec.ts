import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, clearTwists, signIn } from "./helpers";

/**
 * No main screen scrolls sideways on a phone, with the long titles, names and notes real prints have ("Quick
 * Release Poop Bucket (P2S, X2D, H2S, H2D…)"). A row whose text can't shrink (a flex or grid child without
 * min-w-0) widens the page, and the whole screen pans under the thumb. The guard reads the page's own width; it
 * isn't hidden by overflow-x on the page, which would only mask the row.
 */

const origin = (page: Page) => new URL(page.url()).origin;

const LONG = [
  "Quick Release Poop Bucket (P2S, X2D, H2S, H2D, A1 mini and a few other printers too)",
  "Silica Dry Box for BambuLab AMS 2 Pro with a hygrometer and a very long name",
  "Mini Cute Marshmallow Adorable 3D Printed Figurine",
];
const NOTE = `${"A long note about how this one went, with many words. ".repeat(6)}https://www.printables.com/model/1234567-quick-release-poop-bucket-for-p2s-x2d-h2s-h2d-and-more/files`;

async function post(page: Page, url: string, data: unknown, method: "post" | "put" = "post") {
  const response = await page.request[method](url, { headers: { Origin: origin(page) }, data });
  expect(response.ok(), `${url}: ${response.status()} ${await response.text()}`).toBe(true);
  return response;
}

async function clearAll(page: Page) {
  await clearIdeas(page);
  await clearTwists(page);
  const headers = { Origin: origin(page) };
  const { spools } = await (await page.request.get("/api/spools")).json();
  for (const spool of spools) await page.request.delete(`/api/spools/${spool.id}`, { headers });
  const { shoppingItems } = await (await page.request.get("/api/shopping-items")).json();
  for (const item of shoppingItems) await page.request.delete(`/api/shopping-items/${item.id}`, { headers });
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearAll(page);
});

test.afterEach(async ({ page }) => {
  await clearAll(page);
});

test("no main screen scrolls sideways on a phone with long titles, names and notes", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "phone only");
  // Seventeen screens at three widths.
  test.setTimeout(150_000);
  const ideaId = crypto.randomUUID();
  const doneIds = LONG.map(() => crypto.randomUUID());
  const buildingId = crypto.randomUUID();
  const printingId = crypto.randomUUID();
  const shelvedId = crypto.randomUUID();
  const spoolId = crypto.randomUUID();
  const twistId = crypto.randomUUID();
  const filaments = [{ type: "PETG", brand: "Bambu", colorName: "Teal", colorHex: "#2a8a85", spoolId }];

  await post(page, "/api/spools", {
    id: spoolId,
    material: "PETG",
    brand: "Bambu Lab Extra Long Brand Name Incorporated",
    colorName: "Translucent Iridescent Sunset Orange",
    colorHex: "#d9822b",
    note: NOTE,
  });
  await post(page, "/api/items", { id: ideaId, title: LONG[0], note: NOTE });
  for (const [index, id] of doneIds.entries()) {
    await post(page, "/api/items", { id, title: LONG[index], note: NOTE, stage: "building" });
    await post(page, `/api/items/${id}/attempts`, {
      id: crypto.randomUUID(),
      outcome: "success",
      note: NOTE,
      settings: { filaments, layerHeight: 0.2 },
    });
    await page.request.patch(`/api/items/${id}`, { headers: { Origin: origin(page) }, data: { stage: "done" } });
  }
  await post(page, "/api/items", { id: buildingId, title: LONG[1], note: NOTE, stage: "building" });
  await post(page, `/api/items/${buildingId}/attempts`, {
    id: crypto.randomUUID(),
    outcome: "partial",
    note: NOTE,
    failureTags: ["stringing"],
    settings: { filaments, layerHeight: 0.2 },
  });
  await post(page, "/api/items", { id: printingId, title: LONG[2], note: NOTE, stage: "building" });
  await post(page, `/api/items/${printingId}/attempts`, { id: crypto.randomUUID(), outcome: null });
  await post(page, "/api/items", { id: shelvedId, title: LONG[0], note: NOTE, stage: "building" });
  await page.request.patch(`/api/items/${shelvedId}`, {
    headers: { Origin: origin(page) },
    data: { stage: "shelved" },
  });
  await post(page, "/api/shopping-items", { id: crypto.randomUUID(), name: LONG[0] });
  await post(page, `/api/wishlists/me/items/${ideaId}`, {}, "put");
  await post(page, "/api/twists", { id: twistId, name: LONG[1], note: NOTE, designer: "A Designer With A Long Name" });

  const screens: [string, string][] = [
    ["Ideas", "/ideas"],
    ["an idea", `/ideas/${ideaId}`],
    ["Builds", "/builds"],
    ["an in-progress build", `/builds/${buildingId}`],
    ["a build on the bed", `/builds/${printingId}`],
    ["a done build", `/builds/${doneIds[0]}`],
    ["a shelved build", `/builds/${shelvedId}`],
    ["Journal", "/journal"],
    ["Search", `/search?q=${encodeURIComponent("Quick Release")}`],
    ["Shopping list", "/shopping"],
    ["Wishlists", "/wishlist"],
    ["Pantry", "/pantry"],
    ["a spool", `/pantry/${spoolId}`],
    ["Printer", "/printer"],
    ["Workshop", "/workshop"],
    ["Twists", "/twists"],
    ["a twist", `/twists/${twistId}`],
  ];
  const wide: string[] = [];
  // The project's 390 px, and the narrower phones (an iPhone SE or mini, a small Android).
  for (const width of [390, 375, 360]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [name, path] of screens) await measure(name, path);
  }
  expect(wide, "screens that scroll sideways").toEqual([]);

  async function measure(name: string, path: string) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    // Let lists and lazy chunks arrive before measuring.
    await page.waitForLoadState("networkidle");
    const { scroll, inner } = await page.evaluate(() => ({
      scroll: document.scrollingElement?.scrollWidth ?? 0,
      inner: window.innerWidth,
    }));
    if (scroll > inner) wide.push(`${name} (${path}): ${scroll} > ${inner}`);
  }
});
