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
  await expect(row.getByRole("link", { name: /bambulab\.com/ })).toHaveAttribute(
    "href",
    "https://eu.store.bambulab.com/products/liquid-glue",
  );
  await expect(row.getByRole("link", { name: /Prisjakt/ })).toHaveAttribute(
    "href",
    "https://www.prisjakt.nu/produkt.php?p=1",
  );

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
  await expect(back.getByRole("link", { name: /bambulab\.com/ })).toHaveCount(0);
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
}, async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  await page.goto("/shopping");
  const name = `PLA Basic black ${tag()}`;
  await add(page, name);
  const row = toBuy(page).getByRole("listitem").filter({ hasText: name });
  // The search runs in the background; the row hints at a match without using it.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(row.getByRole("button", { name: "Prisjakt match?" })).toBeVisible({ timeout: 20_000 });
  await expect(row.getByRole("link", { name: /Prisjakt/ })).toHaveCount(0);

  await row.getByRole("button", { name: "Prisjakt match?" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Is this it?")).toBeVisible();
  await sheet.getByRole("button", { name: "Use it" }).click();

  // The page is read in the background: the cheapest offers, as found, with a link to the product page.
  await expect(sheet.getByRole("list", { name: "Cheapest offers" })).toBeVisible({ timeout: 20_000 });
  const offers = sheet.getByRole("list", { name: "Cheapest offers" }).getByRole("link");
  await expect(offers).toHaveCount(3);
  await expect(offers.first()).toContainText("3D Prima");
  await expect(offers.first()).toContainText("7\u00a0699");
  await expect(offers.first()).toHaveAttribute("href", "https://www.prisjakt.nu/produkt.php?p=1");
  await expect(sheet.getByText("checked today").first()).toBeVisible();
  await sheet
    .getByRole("button", { name: "Close" })
    .first()
    .click()
    .catch(() => page.keyboard.press("Escape"));
  await expect(row).toContainText("7\u00a0699\u00a0kr");
  // The picture really loads in its slot (also on a phone), and the line under the name is short.
  await expect(row.locator("img")).toBeVisible();
  await expect.poll(() => row.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
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
  await row.getByRole("button", { name: "Prisjakt match?" }).click({ timeout: 20_000 });
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Not this one" }).click();
  await expect(sheet.getByText("Is this it?")).toHaveCount(0);
  await expect(sheet.getByText("No Prisjakt page found for it.")).toBeVisible();
  await expect(sheet.getByLabel("Prisjakt")).toHaveValue("");
});
