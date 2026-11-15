import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, clearTwists, signIn } from "./helpers";

/** Principle 7, third part: recipes, the shopping sheet, twists, parts and the slicing defaults. */
const origin = (page: Page) => new URL(page.url()).origin;
const headers = (page: Page) => ({ Origin: origin(page) });

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

/** What a killed tab leaves behind (see never-lose-2.spec.ts): the unsent words as lib/unsent.ts writes them. */
const leaveUnsent = (page: Page, name: string, value: Record<string, unknown>) =>
  page.addInitScript(
    ([key, text]) => localStorage.setItem(key as string, text as string),
    [`spaghetti:unsent:${name}`, JSON.stringify({ at: Date.now(), value })],
  );

/** Holds the first PATCH's answer until `release()`, after the server has it. */
async function holdFirstAnswer(page: Page, url: string) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen = { held: 0 };
  await page.route(url, async (route) => {
    if (route.request().method() !== "PATCH" || seen.held > 0) return route.continue();
    seen.held += 1;
    const response = await route.fetch();
    await gate;
    return route.fulfill({ response });
  });
  return { release, seen };
}

test.describe("twists", () => {
  test.afterEach(async ({ page }) => clearTwists(page));
  const make = async (page: Page) => {
    const id = crypto.randomUUID();
    await page.request.post("/api/twists", { headers: headers(page), data: { id, name: "Start", note: "" } });
    return id;
  };
  const server = async (page: Page, id: string) =>
    (
      (await (await page.request.get("/api/twists")).json()) as {
        twists: Array<{ id: string; name: string; note: string }>;
      }
    ).twists.find((t) => t.id === id);

  test("a name and note left unsent by a killed tab come back and are saved", async ({ page }) => {
    const id = await make(page);
    await leaveUnsent(page, `twist:${id}`, { name: "Typed offline", note: "A note from the printer" });
    await page.goto(`/twists/${id}`);
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Typed offline");
    await expect.poll(async () => (await server(page, id))?.name, { timeout: 15_000 }).toBe("Typed offline");
    await expect.poll(async () => (await server(page, id))?.note).toBe("A note from the printer");
  });

  test("two quick edits keep the later one when the first answer comes late", async ({ page }) => {
    const id = await make(page);
    await page.goto(`/twists/${id}`);
    const { release, seen } = await holdFirstAnswer(page, `**/api/twists/${id}`);
    const name = page.getByRole("textbox", { name: "Name" });
    await name.fill("First");
    await expect.poll(() => seen.held).toBe(1);
    await name.fill("Second");
    release();
    await expect.poll(async () => (await server(page, id))?.name).toBe("Second");
    await expect(name).toHaveValue("Second");
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Second");
  });
});

test.describe("recipes", () => {
  const make = async (page: Page) => {
    const buildId = crypto.randomUUID();
    const recipeId = crypto.randomUUID();
    await page.request.post("/api/items", {
      headers: headers(page),
      data: { id: buildId, title: "Recipe build", stage: "building" },
    });
    const attemptId = crypto.randomUUID();
    await page.request.post(`/api/items/${buildId}/attempts`, {
      headers: headers(page),
      data: {
        id: attemptId,
        outcome: "success",
        settings: { filaments: [{ type: "PLA", colorName: "Red", colorHex: "#cc3333" }], layerHeight: 0.2 },
      },
    });
    const made = await page.request.post("/api/recipes", {
      headers: headers(page),
      data: { id: recipeId, name: "Start", note: "", sourceAttemptId: attemptId },
    });
    expect(made.ok()).toBe(true);
    return recipeId;
  };
  test.afterEach(async ({ page }) => {
    const { recipes } = await (await page.request.get("/api/recipes")).json();
    for (const recipe of recipes) await page.request.delete(`/api/recipes/${recipe.id}`, { headers: headers(page) });
    await clearIdeas(page);
  });
  const server = async (page: Page, id: string) =>
    (
      (await (await page.request.get("/api/recipes")).json()) as {
        recipes: Array<{ id: string; name: string; note: string }>;
      }
    ).recipes.find((r) => r.id === id);
  const open = async (page: Page) => {
    await page.goto("/search?q=Start");
    await page.getByRole("region", { name: "Recipes" }).getByRole("button", { name: /Start/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("textbox", { name: "Name" })).toBeVisible();
    return sheet;
  };

  test("a name and note left unsent by a killed tab come back and are saved", async ({ page }) => {
    const id = await make(page);
    await leaveUnsent(page, `recipe:${id}`, { name: "Typed offline", note: "Dry it first" });
    const sheet = await open(page);
    await expect(sheet.getByRole("textbox", { name: "Name" })).toHaveValue("Typed offline");
    await expect(sheet.getByRole("textbox", { name: "Note" })).toHaveValue("Dry it first");
    await expect.poll(async () => (await server(page, id))?.name, { timeout: 15_000 }).toBe("Typed offline");
    await expect.poll(async () => (await server(page, id))?.note).toBe("Dry it first");
  });

  test("two quick edits keep the later one when the first answer comes late", async ({ page }) => {
    const id = await make(page);
    const { release, seen } = await holdFirstAnswer(page, `**/api/recipes/${id}`);
    const sheet = await open(page);
    const name = sheet.getByRole("textbox", { name: "Name" });
    await name.fill("First");
    await expect.poll(() => seen.held).toBe(1);
    await name.fill("Second");
    release();
    await expect.poll(async () => (await server(page, id))?.name).toBe("Second");
    await expect(name).toHaveValue("Second");
  });
});

test.describe("the shopping sheet", () => {
  const make = async (page: Page) => {
    const id = crypto.randomUUID();
    await page.request.post("/api/shopping-items", {
      headers: headers(page),
      data: { id, name: `Glue ${id.slice(0, 6)}` },
    });
    return id;
  };
  test.afterEach(async ({ page }) => {
    const { shoppingItems } = await (await page.request.get("/api/shopping-items")).json();
    for (const item of shoppingItems)
      await page.request.delete(`/api/shopping-items/${item.id}`, { headers: headers(page) });
  });
  const server = async (page: Page, id: string) =>
    (
      (await (await page.request.get("/api/shopping-items")).json()) as {
        shoppingItems: Array<{ id: string; name: string; link: string | null }>;
      }
    ).shoppingItems.find((i) => i.id === id);

  test("a name and shop left unsent by a killed tab come back and are saved", async ({ page }) => {
    const id = await make(page);
    await leaveUnsent(page, `shopping:${id}`, { name: "Typed offline", link: "https://example.com/glue" });
    await page.goto("/shopping");
    await page.getByRole("list", { name: "To buy" }).getByRole("button", { name: /^Glue/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Name")).toHaveValue("Typed offline");
    await expect.poll(async () => (await server(page, id))?.name, { timeout: 15_000 }).toBe("Typed offline");
    await expect.poll(async () => (await server(page, id))?.link).toBe("https://example.com/glue");
  });

  test("two quick edits keep the later one when the first answer comes late", async ({ page }) => {
    const id = await make(page);
    const { release, seen } = await holdFirstAnswer(page, `**/api/shopping-items/${id}`);
    await page.goto("/shopping");
    await page.getByRole("list", { name: "To buy" }).getByRole("button", { name: /^Glue/ }).click();
    const name = page.getByRole("dialog").getByLabel("Name");
    await name.fill("First");
    await expect.poll(() => seen.held).toBe(1);
    await name.fill("Second");
    release();
    await expect.poll(async () => (await server(page, id))?.name).toBe("Second");
    await expect(name).toHaveValue("Second");
  });

  test("a failed tick puts back only the tick, not a rename made meanwhile", async ({ page }) => {
    const id = await make(page);
    const first = (await server(page, id))?.name ?? "";
    await page.goto("/shopping");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = 0;
    await page.route(`**/api/shopping-items/${id}`, async (route) => {
      const body = route.request().postDataJSON() as { bought?: boolean };
      if (route.request().method() !== "PATCH" || body.bought === undefined) return route.continue();
      held += 1;
      await gate;
      return route.fulfill({ status: 500, json: { error: "nope" } });
    });
    await page.getByRole("checkbox", { name: `Bought: ${first}` }).click();
    await expect.poll(() => held).toBe(1);
    await page.getByRole("list", { name: "Bought" }).getByRole("button", { name: first, exact: true }).click();
    await page.getByRole("dialog").getByLabel("Name").fill(`${first} stick`);
    await expect.poll(async () => (await server(page, id))?.name).toBe(`${first} stick`);
    release();
    await page.keyboard.press("Escape");
    const list = page.getByRole("list", { name: "To buy" });
    await expect(list.getByText(`${first} stick`)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("list", { name: "Bought" }).getByText(first)).toHaveCount(0);
  });
});

test.describe("parts", () => {
  test.afterEach(async ({ page }) => clearIdeas(page));
  test("a part's name and count left unsent by a killed tab come back and are saved", async ({ page }) => {
    const id = crypto.randomUUID();
    const partId = crypto.randomUUID();
    await page.request.post("/api/items", {
      headers: headers(page),
      data: { id, title: "Parts build", stage: "building" },
    });
    await page.request.put(`/api/items/${id}/parts`, {
      headers: headers(page),
      data: { parts: [{ id: partId, name: "Hull", quantity: 1 }] },
    });
    await leaveUnsent(page, `part:${partId}`, { name: "Hull half", quantity: 3 });
    await page.goto(`/builds/${id}`);
    await expect(page.getByRole("textbox", { name: "Name of Hull" })).toHaveValue("Hull half");
    await expect
      .poll(
        async () =>
          (
            (await (await page.request.get(`/api/items/${id}`)).json()) as {
              item: { parts: Array<{ name: string; quantity: number }> };
            }
          ).item.parts.map((p) => [p.name, p.quantity]),
        { timeout: 15_000 },
      )
      .toEqual([["Hull half", 3]]);
  });
});

test("slicing defaults left unsent by a killed tab are saved on the next visit", async ({ page }) => {
  const slicing = {
    layerHeight: 0.28,
    walls: 3,
    infill: 20,
    pattern: "gyroid",
    supports: "off",
    supportStyle: "tree",
    brim: "auto",
  };
  const printer = async () =>
    (
      (await (await page.request.get("/api/printer")).json()) as {
        setup: { slicing?: { layerHeight?: number } | null };
      }
    ).setup;
  try {
    await leaveUnsent(page, "slicing-defaults", { slicing });
    await page.goto("/printer");
    await expect.poll(async () => (await printer()).slicing?.layerHeight, { timeout: 15_000 }).toBe(0.28);
  } finally {
    await page.request.put("/api/printer", { headers: headers(page), data: { slicing: null } });
  }
});
