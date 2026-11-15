import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

/** Principle 7, fourth part: the failed and late answers of spools, the AMS and the printer's setup. */
const origin = (page: Page) => new URL(page.url()).origin;
const headers = (page: Page) => ({ Origin: origin(page) });

test.beforeEach(async ({ page }) => {
  await signIn(page);
});
test.afterEach(async ({ page }) => {
  const { spools } = await (await page.request.get("/api/spools")).json();
  for (const spool of spools) await page.request.delete(`/api/spools/${spool.id}`, { headers: headers(page) });
});

const makeSpool = async (page: Page, data: Record<string, unknown>) => {
  const id = crypto.randomUUID();
  const { gramsLeft, ...rest } = data;
  await page.request.post("/api/spools", { headers: headers(page), data: { id, material: "PLA", ...rest } });
  // The weight is a weighing: a spool is created without one.
  if (gramsLeft)
    await page.request.post(`/api/spools/${id}/weighings`, {
      headers: headers(page),
      data: { id: crypto.randomUUID(), gramsLeft },
    });
  return id;
};
const spoolOf = async (page: Page, id: string) =>
  (await (await page.request.get(`/api/spools/${id}`)).json()).spool as {
    gramsLeft: number | null;
    note: string;
  };

test("a failed weighing puts back only the weight, and a note typed meanwhile stays", async ({ page }) => {
  const id = await makeSpool(page, { colorName: "Weighed", gramsLeft: 900, note: "" });
  await page.goto(`/pantry/${id}`);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = 0;
  await page.route(`**/api/spools/${id}/weighings`, async (route) => {
    held += 1;
    await gate;
    return route.fulfill({ status: 500, json: { error: "nope" } });
  });
  await page.getByRole("button", { name: "Weigh it" }).click();
  const weigh = page.getByRole("dialog", { name: "Weigh it" });
  await weigh.getByLabel("On the scale").fill("500");
  await weigh.getByLabel("The empty spool weighs").fill("250");
  await weigh.getByRole("button", { name: "Save weighing" }).click();
  await expect.poll(() => held).toBe(1);
  await page.getByRole("textbox", { name: "Note" }).fill("Typed while weighing");
  await expect.poll(async () => (await spoolOf(page, id)).note).toBe("Typed while weighing");
  release();
  await expect(page.getByText("Couldn't save the weighing")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Note" })).toHaveValue("Typed while weighing");
  expect((await spoolOf(page, id)).gramsLeft).toBe(900);
  await expect(page.getByText("Weighed: about 250 g")).toHaveCount(0);
});

test("a weighing's late answer doesn't put back an older note", async ({ page }) => {
  const id = await makeSpool(page, { colorName: "Late", gramsLeft: 900, note: "" });
  await page.goto(`/pantry/${id}`);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = 0;
  await page.route(`**/api/spools/${id}/weighings`, async (route) => {
    held += 1;
    const response = await route.fetch();
    await gate;
    return route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Weigh it" }).click();
  const weigh = page.getByRole("dialog", { name: "Weigh it" });
  await weigh.getByLabel("On the scale").fill("500");
  await weigh.getByLabel("The empty spool weighs").fill("250");
  await weigh.getByRole("button", { name: "Save weighing" }).click();
  await expect.poll(() => held).toBe(1);
  await page.getByRole("textbox", { name: "Note" }).fill("Newer than the answer");
  await expect.poll(async () => (await spoolOf(page, id)).note).toBe("Newer than the answer");
  release();
  await expect.poll(async () => (await spoolOf(page, id)).gramsLeft).toBe(250);
  await expect(page.getByRole("textbox", { name: "Note" })).toHaveValue("Newer than the answer");
  // The answer reached the page: back from the pantry, the spool is as it was left.
  await page
    .getByRole("link", { name: /Pantry/ })
    .first()
    .click();
  await page.getByRole("link", { name: /Late/ }).first().click();
  await expect(page.getByText("Newer than the answer")).toBeVisible();
});

test("a spool that fails to be taken out comes back with its weight", async ({ page }) => {
  const gone = await makeSpool(page, { colorName: "Stays", gramsLeft: 800 });
  const other = await makeSpool(page, { colorName: "Other", gramsLeft: 700 });
  await page.route(`**/api/spools/${gone}`, (route) =>
    route.request().method() === "DELETE" ? route.fulfill({ status: 500, json: { error: "nope" } }) : route.continue(),
  );
  await page.goto(`/pantry/${gone}`);
  await page.getByRole("button", { name: "Take out of the pantry" }).click();
  await expect(page).toHaveURL(/\/pantry$/);
  await expect(page.getByText("Couldn't take that spool out")).toBeVisible();
  await expect(page.getByRole("link", { name: /Stays/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Other/ })).toBeVisible();
  expect((await spoolOf(page, gone)).gramsLeft).toBe(800);
  expect((await spoolOf(page, other)).gramsLeft).toBe(700);
});

test("a failed AMS slot change goes back alone, a slot loaded meanwhile stays", async ({ page }) => {
  await makeSpool(page, { colorName: "Rose", material: "PETG" });
  await makeSpool(page, { colorName: "Teal", material: "PETG" });
  await page.goto("/pantry");
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = 0;
  await page.route("**/api/printer/slots/A3", async (route) => {
    held += 1;
    await gate;
    return route.fulfill({ status: 500, json: { error: "nope" } });
  });
  await page.getByRole("button", { name: /^A3 Empty/ }).click();
  await page.getByRole("dialog", { name: "Slot A3" }).getByRole("button", { name: /Rose/ }).click();
  await expect.poll(() => held).toBe(1);
  await expect(page.getByRole("button", { name: /^A3 Rose/ })).toBeVisible();
  await page.getByRole("button", { name: /^A1 Empty/ }).click();
  await page.getByRole("dialog", { name: "Slot A1" }).getByRole("button", { name: /Teal/ }).click();
  await expect(page.getByRole("button", { name: /^A1 Teal/ })).toBeVisible();
  release();
  await expect(page.getByText("Couldn't change the AMS")).toBeVisible();
  await expect(page.getByRole("button", { name: /^A3 Empty/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^A1 Teal/ })).toBeVisible();
  await expect
    .poll(async () => Object.keys((await (await page.request.get("/api/printer")).json()).slots))
    .toEqual(["A1"]);
  await page.request.put("/api/printer/slots/A1", { headers: headers(page), data: { spoolId: null } });
});
