import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

test("ideas with a model are marked, found with one tap, and show a model card on their page", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const withModel = crypto.randomUUID();
  const without = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers,
    data: { id: withModel, title: "Bins", note: "https://makerworld.com/en/models/487213-drawer-bins" },
  });
  await page.request.post("/api/items", {
    headers,
    data: { id: without, title: "Wobbly idea", note: "see https://makerworld.com/en/search/models?keyword=x" },
  });
  await page.goto("/ideas");
  const list = page.getByRole("list", { name: "Ideas" });
  await expect(list.getByText("Ready to print, model on MakerWorld")).toHaveCount(1);
  await page.getByRole("button", { name: /^Has a model/ }).click();
  await expect(list.getByRole("heading", { name: "Bins" })).toBeVisible();
  await expect(list.getByRole("heading", { name: "Wobbly idea" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Needs designing/ }).click();
  await expect(list.getByRole("heading", { name: "Wobbly idea" })).toBeVisible();
  await expect(list.getByRole("heading", { name: "Bins" })).toHaveCount(0);

  await page.goto(`/ideas/${withModel}`);
  const card = page.getByRole("link", { name: /Model on MakerWorld/ });
  await expect(card).toHaveAttribute("href", "https://makerworld.com/en/models/487213-drawer-bins");
  await expect(card).toHaveAttribute("target", "_blank");
  // The model's link isn't shown twice.
  await expect(page.getByRole("list", { name: "Links in the note" })).toHaveCount(0);
});

test("a MakerWorld link shows once, as the model's card, without its tracking bits @phone", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const flexi = "https://makerworld.com/en/models/3531476-flexi-mini-hummingbird?from=search#profileId-4037895";
  const clean = "https://makerworld.com/en/models/3531476-flexi-mini-hummingbird";
  const only = crypto.randomUUID();
  const words = crypto.randomUUID();
  // As a note saved before links were tidied: a person's edit is stored as sent.
  await page.request.post("/api/items", { headers, data: { id: only, title: "Flexi Mini Hummingbird", note: "" } });
  await page.request.patch(`/api/items/${only}`, { headers, data: { note: flexi } });
  await page.request.post("/api/items", { headers, data: { id: words, title: "Hummingbirds", note: "" } });
  await page.request.patch(`/api/items/${words}`, {
    headers,
    data: {
      note: `Print it in green: ${flexi}\nand the stand https://www.thingiverse.com/thing:4512?ref=x for the shelf`,
    },
  });

  // A note that is only the link: the model's card says it all.
  await page.goto(`/ideas/${only}`);
  const card = page.getByRole("link", { name: /Model on MakerWorld/ });
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute("href", clean);
  await expect(page.getByRole("list", { name: "Links in the note" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /makerworld\.com/ })).toHaveCount(1);
  await expect(page.getByText(/from=search|profileId/)).toHaveCount(0);
  // Editing the note still has the link, and leaving it keeps only what names the model.
  await page.getByRole("button", { name: "Edit note" }).click();
  const field = page.getByRole("textbox", { name: "Note" });
  await expect(field).toHaveValue(flexi);
  await field.blur();
  await expect
    .poll(async () => (await (await page.request.get(`/api/items/${only}`)).json()).item.note, { timeout: 10_000 })
    .toBe(clean);

  // Inside other words it reads short, and a second model keeps its own card.
  await page.goto(`/ideas/${words}`);
  await expect(page.getByRole("link", { name: /Model on MakerWorld/ })).toHaveAttribute("href", clean);
  const inNote = page.getByRole("link", { name: "makerworld.com/…", exact: true });
  await expect(inNote).toHaveAttribute("href", clean);
  await expect(page.getByText(/from=search|profileId|ref=x/)).toHaveCount(0);
  const others = page.getByRole("list", { name: "Links in the note" }).getByRole("link");
  await expect(others).toHaveCount(1);
  await expect(others).toHaveAttribute("href", "https://www.thingiverse.com/thing:4512");

  // A new idea's link is saved without them.
  const fresh = crypto.randomUUID();
  const made = await page.request.post("/api/items", { headers, data: { id: fresh, note: `see ${flexi}` } });
  expect((await made.json()).item.note).toBe(`see ${clean}`);
});

test("a build shows its model's link once, as the model's card", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const id = crypto.randomUUID();
  const flexi = "https://makerworld.com/models/3531476?from=search";
  await page.request.post("/api/items", { headers, data: { id, title: "Flexi", note: "", stage: "building" } });
  await page.request.patch(`/api/items/${id}`, {
    headers,
    data: { note: `${flexi}\nSame bird: https://makerworld.com/en/models/3531476-flexi-mini-hummingbird` },
  });
  await page.goto(`/builds/${id}`);
  const cards = page.getByRole("list", { name: "Links in the note" }).getByRole("link");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Model on MakerWorld");
  await expect(cards).toHaveAttribute("href", "https://makerworld.com/models/3531476");
  await expect(page.getByText(/from=search/)).toHaveCount(0);
});
