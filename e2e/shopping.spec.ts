import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();

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

test("shopping: opens, and has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/shopping");
  await expect(page.getByRole("heading", { level: 1, name: "Shopping list" })).toBeVisible();
  await add(page, `Glue ${tag()}`);
  expect((await axe(page)).violations.map((violation) => violation.id)).toEqual([]);
});

test("shopping: add a name and links, tick it off and back, edit it, delete with undo", async ({ page }) => {
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
  expect((await axe(page)).violations.map((violation) => violation.id)).toEqual([]);
  await sheet.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(toBuy(page).getByText(renamed)).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  const back = toBuy(page).getByRole("listitem").filter({ hasText: renamed });
  await expect(back).toBeVisible();
  await expect(back.getByRole("link", { name: /bambulab\.com/ })).toHaveCount(0);
});

test("shopping: unticking within the pause keeps it on the list", async ({ page }) => {
  await signIn(page);
  await page.goto("/shopping");
  const name = `Spare nozzle ${tag()}`;
  await add(page, name);
  const box = toBuy(page).getByRole("checkbox", { name: `Bought: ${name}` });
  await box.click();
  await expect(box).toBeChecked();
  await box.click();
  await expect(box).not.toBeChecked();
  // Well past the pause: nothing was sent, and a reload agrees.
  await page.waitForTimeout(1000);
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
