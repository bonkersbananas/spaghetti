import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;

test.afterEach(async ({ page }) => {
  const headers = { Origin: origin(page) };
  const { twists } = await (await page.request.get("/api/twists")).json();
  for (const twist of twists) await page.request.delete(`/api/twists/${twist.id}`, { headers });
  await clearIdeas(page);
});

test("makes a twist from an idea with a model, writes what changed, finds it in the list, and deletes it with undo", async ({
  page,
}) => {
  await signIn(page);
  const ideaId = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id: ideaId, title: "Drawer bins", note: "https://makerworld.com/en/models/487213-drawer-bins" },
  });

  // One tap on the idea: the twist opens with the idea's title and its model.
  await page.goto(`/ideas/${ideaId}`);
  await page.getByRole("button", { name: "Make a twist" }).click();
  await expect(page).toHaveURL(/\/twists\/[\w-]+$/);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Drawer bins");
  await expect(page.getByText("From MakerWorld")).toBeVisible();

  // Adding a change focuses its value, so typing starts at once.
  await page.getByRole("button", { name: "Scale", exact: true }).click();
  await page.keyboard.type("84 %");
  await page.getByRole("textbox", { name: "Why, for scale" }).fill("fits the 42 mm grid");
  // Leaving the fields turns the change back into a line of text; a tap on it opens the fields again.
  await page.getByRole("heading", { name: "What we changed" }).click();
  const line = page.getByRole("button", { name: "Edit scale" });
  await expect(line).toHaveText("Scale 84 % fits the 42 mm grid");
  await line.click();
  await expect(page.getByRole("textbox", { name: "Scale value" })).toHaveValue("84 %");
  await page.getByRole("heading", { name: "What we changed" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  // The list shows it with its changes in a quiet line, and the idea's chip now opens it.
  await page.goto("/twists");
  const card = page.getByRole("link", { name: /Drawer bins/ });
  await expect(card).toContainText("Scale 84 %");
  await page.goto(`/ideas/${ideaId}`);
  await page.getByRole("button", { name: "Twist", exact: true }).click();
  await expect(page).toHaveURL(/\/twists\/[\w-]+$/);

  // Delete is immediate, with Undo.
  await page.getByRole("button", { name: "Delete twist" }).click();
  await expect(page).toHaveURL(/\/twists$/);
  await expect(page.getByText("Nothing twisted yet")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("link", { name: /Drawer bins/ })).toBeVisible();
});

test("makes a twist from nothing but a name", async ({ page }) => {
  await signIn(page);
  await page.goto("/twists");
  await page
    .getByRole("button", { name: /New twist|Make a twist/ })
    .first()
    .click();
  const sheet = page.getByRole("dialog", { name: "A new twist" });
  await sheet.getByRole("textbox", { name: "Name it" }).fill("Planter, 0.2 looser");
  await sheet.getByRole("button", { name: "Make the twist" }).click();
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Planter, 0.2 looser");

  // A link the server wouldn't keep stays on screen with its message, and doesn't hold back the name beside it.
  await page.getByRole("textbox", { name: "Link" }).fill("http://nowhere");
  await expect(page.getByText("That needs to be a full https:// link")).toBeVisible();
  await page.getByRole("textbox", { name: "Name" }).fill("Planter, looser still");
  await expect
    .poll(async () => {
      const { twists } = await (await page.request.get("/api/twists")).json();
      return twists.map((twist: { name: string }) => twist.name);
    })
    .toContain("Planter, looser still");
});

test("Print it makes a build for the twist, which the twist then lists", async ({ page }) => {
  await signIn(page);
  await page.goto("/twists");
  await page
    .getByRole("button", { name: /New twist|Make a twist/ })
    .first()
    .click();
  const sheet = page.getByRole("dialog", { name: "A new twist" });
  await sheet.getByRole("textbox", { name: "Name it" }).fill("Hook, thicker");
  await sheet.getByRole("button", { name: "Make the twist" }).click();
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Hook, thicker");
  const twistUrl = page.url();
  await page.getByRole("button", { name: "Print it", exact: true }).click();
  await expect(page).toHaveURL(/\/builds\/[\w-]+$/);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Hook, thicker");
  await page.goto(twistUrl);
  await expect(page.getByRole("heading", { name: "Printed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print it again" })).toBeVisible();
});

test("a build from someone else's model is kept as a twist from its page, and search finds twists", async ({
  page,
}) => {
  await signIn(page);
  const buildId = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: {
      id: buildId,
      title: "Cable chain",
      stage: "building",
      note: "https://makerworld.com/en/models/301122-cable-chain",
    },
  });
  await page.goto(`/builds/${buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  await page.getByRole("button", { name: "Save as twist" }).click();
  await expect(page).toHaveURL(/\/twists\/[\w-]+$/);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Cable chain");
  // The build is listed as printed, and the action is gone from it.
  await expect(page.getByRole("heading", { name: "Printed" })).toBeVisible();
  await page.goto(`/builds/${buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  await expect(page.getByRole("button", { name: "Save as twist" })).toHaveCount(0);

  // Search finds the twist by its name, in its own group.
  await page.goto("/search?q=cable");
  const found = page.getByRole("region", { name: "Twists" });
  await expect(found.getByRole("link", { name: /Cable chain/ })).toBeVisible();
});
