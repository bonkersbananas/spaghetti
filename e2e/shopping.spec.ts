import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

/** Names unique to this run: the e2e tests share one database. */
const tag = () => Math.random().toString(36).slice(2, 7);

async function add(page: Page, text: string) {
  const field = page.getByRole("textbox", { name: "Add something to buy" });
  await field.fill(text);
  await field.press("Enter");
  await expect(field).toHaveValue("");
}

const toBuy = (page: Page) => page.getByRole("list", { name: "To buy" });
const bought = (page: Page) => page.getByRole("list", { name: "Bought" });

test("shopping: add a name and links, tick it off and back, edit it, delete with undo", async ({ page }) => {
  // Many steps, and on a cold dev server the sheet's chunk compiles on first use.
  test.setTimeout(60_000);
  await signIn(page);
  await page.goto("/shopping");
  const name = `Liquid glue ${tag()}`;
  await add(page, `${name} https://eu.store.bambulab.com/products/liquid-glue https://www.prisjakt.nu/produkt.php?p=1`);

  const row = toBuy(page).getByRole("listitem").filter({ hasText: name });
  // One line: the links are a tap away, in its sheet.
  await expect(row.getByRole("link")).toHaveCount(0);
  await row.getByRole("button", { name, exact: true }).click();
  const opened = page.getByRole("dialog");
  await expect(opened.getByRole("link", { name: /bambulab\.com/ })).toHaveAttribute(
    "href",
    "https://eu.store.bambulab.com/products/liquid-glue",
  );
  await expect(opened.getByRole("link", { name: /^Prisjakt/ })).toHaveAttribute(
    "href",
    "https://www.prisjakt.nu/produkt.php?p=1",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Ticked off: it moves to Bought, and survives a reload.
  await row.getByRole("checkbox", { name: `Bought: ${name}` }).click();
  const done = bought(page).getByRole("listitem").filter({ hasText: name });
  await expect(done.getByRole("checkbox")).toBeChecked();
  await expect(done).toContainText("got it just now");
  await page.reload();
  await expect(bought(page).getByRole("listitem").filter({ hasText: name })).toBeVisible();

  // Back on the list, at the top.
  await bought(page)
    .getByRole("checkbox", { name: `Bought: ${name}` })
    .click();
  await expect(toBuy(page).getByRole("listitem").first()).toContainText(name);

  // Edit: rename and clear the shop link; autosaved.
  await toBuy(page).getByRole("button", { name, exact: true }).click();
  const sheet = page.getByRole("dialog");
  const renamed = `${name} 2`;
  await sheet.getByLabel("Name").fill(renamed);
  await sheet.getByLabel("Shop").fill("");
  await expect(sheet.getByText("Saved")).toBeVisible();
  await sheet.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(toBuy(page).getByText(renamed)).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  const back = toBuy(page).getByRole("listitem").filter({ hasText: renamed });
  await expect(back).toBeVisible();
  await back.getByRole("button", { name: renamed, exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: /bambulab\.com/ })).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
});

test("shopping: a tick says so in a toast, and its Undo puts the thing back where it was", {
  tag: "@phone",
}, async ({ page }) => {
  await signIn(page);
  await page.goto("/shopping");
  const [first, middle, last] = ["Spare PEI plate", "Spare nozzle wipe", "Spare cutter"].map((n) => `${n} ${tag()}`);
  for (const name of [last, middle, first]) await add(page, name as string);
  const names = toBuy(page).getByRole("button", { name: new RegExp(`^(${[first, middle, last].join("|")})$`) });
  await expect(names).toHaveText([first, middle, last] as string[]);

  await toBuy(page)
    .getByRole("checkbox", { name: `Bought: ${middle}` })
    .click();
  await expect(bought(page).getByRole("checkbox", { name: `Bought: ${middle}` })).toBeChecked();
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Bought" });
  await expect(toast).toContainText(middle as string);
  await toast.getByRole("button", { name: "Undo" }).click();

  // Back in its place between the other two, not on top, and the server agrees.
  await expect(names).toHaveText([first, middle, last] as string[]);
  await expect(bought(page).getByText(middle as string)).toHaveCount(0);
  await page.reload();
  await expect(names).toHaveText([first, middle, last] as string[]);
  for (const name of [first, middle, last]) {
    await toBuy(page).getByRole("button", { name, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("shopping: unticking within the pause keeps it on the list", async ({ page }) => {
  await page.clock.install();
  await signIn(page);
  await page.goto("/shopping");
  const name = `Spare nozzle ${tag()}`;
  await add(page, name);
  const box = toBuy(page).getByRole("checkbox", { name: `Bought: ${name}` });
  // The page's timers stand still while both taps land, however slow the machine: the second is within the pause.
  await page.clock.pauseAt(Date.now() + 60_000);
  await box.click();
  await expect(box).toBeChecked();
  await box.click();
  await expect(box).not.toBeChecked();
  // Well past the pause: nothing was sent, and a reload agrees.
  await page.clock.runFor(1000);
  await page.clock.resume();
  await expect(toBuy(page).getByRole("checkbox", { name: `Bought: ${name}` })).not.toBeChecked();
  await page.reload();
  await expect(toBuy(page).getByRole("checkbox", { name: `Bought: ${name}` })).toBeVisible();
  await expect(bought(page).getByText(name)).toHaveCount(0);
});

test("shopping: the arrow keys on a handle sort the list, and the order is kept", async ({ page }) => {
  await signIn(page);
  await page.goto("/shopping");
  const id = tag();
  const [a, b] = [`Nozzle ${id}`, `Silica gel ${id}`];
  await add(page, a);
  // The second one is still being saved when it's moved: the move waits for it, and the save doesn't undo the move.
  await page.route("**/api/shopping-items", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await add(page, b);
  // Newest on top: b, a.
  const names = toBuy(page).getByRole("button", { name: new RegExp(`^(${a}|${b})$`) });
  await expect(names).toHaveText([b, a]);

  await toBuy(page)
    .getByRole("button", { name: new RegExp(`^Move ${b}`) })
    .press("ArrowDown");
  await expect(names).toHaveText([a, b]);
  await expect(toBuy(page).getByRole("button", { name: new RegExp(`^Move ${b}`) })).toBeFocused();
  // Past the delayed save and the order it waited for.
  await page.waitForTimeout(1500);
  await expect(names).toHaveText([a, b]);
  await page.unroute("**/api/shopping-items");
  await page.reload();
  await expect(names).toHaveText([a, b]);
});

test("shopping: what's added or ticked while an order is being saved stays", async ({ page }) => {
  // It waits out a slowed order on purpose, then reloads.
  test.setTimeout(60_000);
  await signIn(page);
  await page.goto("/shopping");
  const id = tag();
  const [a, b, c] = [`Glue ${id}`, `Brush ${id}`, `Tape ${id}`];
  await add(page, a);
  await add(page, b);
  const names = toBuy(page).getByRole("button", { name: new RegExp(`^(${a}|${b}|${c})$`) });
  await expect(names).toHaveText([b, a]);
  // The order's answer is slow; meanwhile a third thing is added and the first is ticked off.
  await page.route("**/api/shopping-items/order", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await toBuy(page)
    .getByRole("button", { name: new RegExp(`^Move ${b}`) })
    .press("ArrowDown");
  await expect(names).toHaveText([a, b]);
  await add(page, c);
  await toBuy(page)
    .getByRole("checkbox", { name: `Bought: ${a}` })
    .click();
  await expect(bought(page).getByText(a)).toBeVisible();
  // Past the order's answer: nothing came back or went missing.
  await page.waitForTimeout(2000);
  await expect(names).toHaveText([c, b]);
  await expect(bought(page).getByText(a)).toBeVisible();
  await page.unroute("**/api/shopping-items/order");
  await page.reload();
  await expect(names).toHaveText([c, b]);
  await expect(bought(page).getByText(a)).toBeVisible();
});

test("shopping: a Prisjakt page is suggested for a name, confirmed, and its picture and cheapest offers show", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  test.setTimeout(60_000);
  await signIn(page);
  await page.goto("/shopping");
  const name = `PLA Basic black ${tag()}`;
  await add(page, name);
  const row = toBuy(page).getByRole("listitem").filter({ hasText: name });
  // The search runs in the background; one offer at the top of the list says a match waits, without using it.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const offer = page.getByRole("button", { name: "Match prices" });
  await expect(offer).toBeVisible({ timeout: 20_000 });
  await expect(row.getByRole("button", { name: "Prisjakt match?" })).toHaveCount(0);

  // Its page, among the others found, is used only once someone says so.
  await offer.click();
  const matches = page.getByRole("dialog", { name: "Match prices" });
  const match = matches.getByRole("listitem").filter({ hasText: name });
  // Other things' pages may have been found first: this one's joins the open sheet once its search answers.
  await expect(match.getByRole("link")).toHaveAttribute("href", "https://www.prisjakt.nu/produkt.php?p=1", {
    timeout: 20_000,
  });
  await match.getByRole("button", { name: "Use it" }).click();
  await expect(match.getByRole("status")).toContainText("Matched");
  await matches.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await row.getByRole("button", { name, exact: true }).click();
  const sheet = page.getByRole("dialog");

  // The page is read in the background: the cheapest offers, as found, with a link to the product page.
  await expect(sheet.getByRole("list", { name: "Cheapest offers" })).toBeVisible({ timeout: 20_000 });
  const offers = sheet.getByRole("list", { name: "Cheapest offers" }).getByRole("link");
  await expect(offers).toHaveCount(3);
  await expect(offers.first()).toContainText("3D Prima");
  await expect(offers.first()).toContainText("7\u00a0699");
  await expect(offers.first()).toHaveAttribute("href", "https://www.prisjakt.nu/produkt.php?p=1");
  await expect(sheet.getByText("checked today").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toContainText("7\u00a0699\u00a0kr");
  // The picture really loads, beside the name on a laptop (a phone's line is the name's: it is in the sheet there),
  // and the row stays one line: just the price.
  const picture = isMobile ? page.getByRole("dialog").locator("img") : row.locator("img");
  if (isMobile) await row.getByRole("button", { name, exact: true }).click();
  await expect(picture).toBeVisible();
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  if (isMobile) await page.keyboard.press("Escape");
  await expect(row).not.toContainText("checked today");
});

test("shopping: 'Not this one' drops a suggested page, and a name with no match says so", async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  await page.goto("/shopping");
  const name = `Cleaning pad ${tag()}`;
  await add(page, name);
  const row = toBuy(page).getByRole("listitem").filter({ hasText: name });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "Match prices" })).toBeVisible({ timeout: 20_000 });
  await row.getByRole("button", { name, exact: true }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Not this one" }).click();
  await expect(sheet.getByText("Is this it?")).toHaveCount(0);
  await expect(sheet.getByText("No Prisjakt page found for it.")).toBeVisible();
  await expect(sheet.getByLabel("Prisjakt")).toHaveValue("");
});

test("shopping: a rename made while the thing is still being added stays, and reaches the server", async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  // Hold the server's answer to the add (a slow connection): the rename comes before it.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/shopping-items", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await held;
    await route.fallback();
  });
  await page.goto("/shopping");
  const name = `Glue stick ${tag()}`;
  await add(page, name);
  await toBuy(page).getByRole("button", { name, exact: true }).click();
  const sheet = page.getByRole("dialog");
  const renamed = `${name} XL`;
  await sheet.getByLabel("Name").fill(renamed);
  await page.waitForTimeout(1500);
  release();
  await expect(sheet.getByText("Saved")).toBeVisible();
  await expect(sheet.getByLabel("Name")).toHaveValue(renamed);
  await expect
    .poll(async () =>
      (await (await page.request.get("/api/shopping-items")).json()).shoppingItems.map((i: { name: string }) => i.name),
    )
    .toContain(renamed);
  await sheet.getByRole("button", { name: "Delete" }).click();
});

test("shopping: a delete waits only for its own thing's add", async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  let holding = false;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/shopping-items", async (route) => {
    if (route.request().method() !== "POST" || !holding) return route.fallback();
    await held;
    await route.fallback();
  });
  await page.goto("/shopping");
  const first = `Nozzle ${tag()}`;
  await add(page, first);
  await expect
    .poll(async () => JSON.stringify(await (await page.request.get("/api/shopping-items")).json()))
    .toContain(first);
  // Another thing is still being added when the first is deleted: the delete goes out at once.
  holding = true;
  const second = `Bed tape ${tag()}`;
  await add(page, second);
  const sent = page.waitForRequest(
    (request) => request.method() === "DELETE" && request.url().includes("/api/shopping-items/"),
    {
      timeout: 10_000,
    },
  );
  await toBuy(page).getByRole("button", { name: first, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await sent;
  release();
  await expect(toBuy(page).getByRole("button", { name: second, exact: true })).toBeVisible();
  await toBuy(page).getByRole("button", { name: second, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
});

test("ticking a thing with the space bar keeps the keyboard on its box in the Bought list", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "A keyboard test.");
  await signIn(page);
  await page.goto("/shopping");
  const name = `Glue stick ${tag()}`;
  await add(page, name);
  const box = toBuy(page).getByRole("checkbox", { name: `Bought: ${name}` });
  await box.focus();
  await page.keyboard.press("Space");
  const done = bought(page).getByRole("checkbox", { name: `Bought: ${name}` });
  await expect(done).toBeChecked();
  await expect(done).toBeFocused();
  // Back to the list the same way.
  await page.keyboard.press("Space");
  await expect(toBuy(page).getByRole("checkbox", { name: `Bought: ${name}` })).toBeFocused();
  await toBuy(page).getByRole("button", { name, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
});
