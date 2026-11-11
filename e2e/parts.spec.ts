import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";
import { PARTS_FILE_NAME, partsSlicerFile } from "./fixtures/slicer-file.ts";

const user = SEED_USERS[0];
const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
});

// Leave nothing behind: the smoke test expects empty sections.
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) {
    if (item.title?.startsWith("Parts test")) {
      await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
    }
  }
});

async function makeBuild(page: Page, title: string) {
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id, title, stage: "building" },
  });
  return id;
}

async function addPart(page: Page, itemId: string, name: string, quantity: number) {
  const id = crypto.randomUUID();
  await page.request.put(`/api/items/${itemId}/parts`, {
    headers: { Origin: origin(page) },
    data: { parts: [{ id, name, quantity }] },
  });
  return id;
}

const getItem = async (page: Page, id: string) => (await (await page.request.get(`/api/items/${id}`)).json()).item;

test("a build without parts stays as it was, and adds parts inline", async ({ page }) => {
  const id = await makeBuild(page, "Parts test hull");
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Parts test hull");
  await expect(page.getByRole("region", { name: "Parts" }).getByRole("listitem")).toHaveCount(0);

  await page.getByRole("button", { name: "Add parts" }).click();
  const newPart = page.getByRole("textbox", { name: "New part" });
  await newPart.fill("Hull half");
  await newPart.press("Enter");
  // The next part takes its place from the list as it stands: let the first one land in it (typed faster than
  // that, both would claim the same place and their order would be left to chance).
  await expect(page.getByRole("button", { name: /^Hull half, needed: one more$/ })).toBeVisible();
  await newPart.fill("Deck");
  await newPart.press("Enter");
  await expect(page.getByRole("button", { name: /^Deck, needed: one more$/ })).toBeVisible();
  await expect
    .poll(async () => (await getItem(page, id)).parts.map((p: { name: string }) => p.name))
    .toEqual(["Hull half", "Deck"]);
  // Two are needed: step up, and rename the deck.
  await page.getByRole("button", { name: "Hull half, needed: one more" }).click();
  await page.getByRole("textbox", { name: "Name of Deck" }).fill("Top deck");
  await expect
    .poll(async () =>
      (await getItem(page, id)).parts.map((p: { name: string; quantity: number }) => [p.name, p.quantity]),
    )
    .toEqual([
      ["Hull half", 2],
      ["Top deck", 1],
    ]);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Hull half", { exact: true })).toBeVisible();
  await expect(page.getByText("0 of 2")).toBeVisible();

  // Removing is undone from the toast, in its old place.
  await page.getByRole("button", { name: "Edit parts" }).click();
  await page.getByRole("button", { name: "Remove Hull half" }).click();
  await expect.poll(async () => (await getItem(page, id)).parts.length).toBe(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(async () => (await getItem(page, id)).parts.map((p: { name: string }) => p.name))
    .toEqual(["Hull half", "Top deck"]);
});

test("logs what's on the plate, counts good pieces, and offers to finish when all are printed", async ({
  page,
  isMobile,
}) => {
  const id = await makeBuild(page, "Parts test steamer");
  const hull = await addPart(page, id, "Hull half", 2);
  await addPart(page, id, "Deck", 1);
  await page.goto(`/builds/${id}`);
  await expect(page.getByText("0 of 2")).toBeVisible();

  const openLog = async () => {
    if (isMobile) await page.getByRole("button", { name: "Log attempt" }).click();
    else await page.keyboard.press("a");
    return page.getByRole("dialog", { name: /^Attempt \d/ });
  };
  // Attempt 1: both hull halves came out, partly.
  let sheet = await openLog();
  await expect(sheet.getByText("What's on the plate")).toBeVisible();
  await sheet.getByRole("button", { name: "Hull half" }).click();
  await sheet.getByRole("button", { name: "Hull half, pieces: one more" }).click();
  await sheet.getByRole("radio", { name: "Partly" }).click();
  await sheet.getByRole("button", { name: "Log attempt" }).click();
  await expect(page.getByTestId("attempt-parts").filter({ hasText: "Hull half ×2" })).toBeVisible();
  await expect(page.getByText("done", { exact: true })).toBeVisible();
  await expect(page.getByTestId("all-printed")).toHaveCount(0);

  // Attempt 2: the deck, a spaghetti: it counts none.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  sheet = await openLog();
  await sheet.getByRole("button", { name: "Deck" }).click();
  await sheet.getByRole("radio", { name: "Spaghetti" }).click();
  await sheet.getByRole("button", { name: "Log attempt" }).click();
  await expect(page.getByTestId("attempt-parts").filter({ hasText: /^Deck$/ })).toBeVisible();
  await expect(page.getByText("0 of 1")).toBeVisible();
  const [, second] = (await getItem(page, id)).attempts;
  expect(second.parts).toEqual([{ partId: expect.any(String), count: 0 }]);

  // Attempt 3: the deck again, and it worked: everything is printed.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  sheet = await openLog();
  await sheet.getByRole("button", { name: "Deck" }).click();
  await sheet.getByRole("radio", { name: "Worked" }).click();
  await sheet.getByRole("button", { name: "Log attempt" }).click();
  await expect(page.getByTestId("all-printed")).toBeVisible();
  await expect(page.getByText("All parts printed")).toBeVisible();
  expect((await getItem(page, id)).stage).toBe("building");
  await page.getByRole("button", { name: "Finish the build" }).click();
  await expect.poll(async () => (await getItem(page, id)).stage).toBe("done");
  expect((await getItem(page, id)).attempts[0].parts).toEqual([{ partId: hull, count: 2 }]);
});

test("takes parts from the slicer file, and preselects a plate's parts", async ({ page }) => {
  const id = await makeBuild(page, "Parts test paddle");
  const headers = { Origin: origin(page) };
  const bytes = partsSlicerFile();
  const attemptId = crypto.randomUUID();
  await page.request.post(`/api/items/${id}/attempts`, {
    headers,
    data: { id: attemptId, outcome: "success", settings: {} },
  });
  await page.request.put(`/api/attempts/${attemptId}/file`, {
    headers,
    multipart: {
      id: crypto.randomUUID(),
      name: PARTS_FILE_NAME,
      size: String(bytes.length),
      plate: "1",
      plateCount: "2",
      prefill: "{}",
      objects: JSON.stringify(["hull_half", "hull_half_2", "deck"]),
      file: { name: PARTS_FILE_NAME, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) },
    },
  });
  await page.goto(`/builds/${id}`);
  const offer = page.getByRole("button", { name: /^Parts from the file Hull half ×2, Deck$/ });
  await expect(offer).toBeVisible();
  await offer.click();
  await expect(page.getByRole("button", { name: /^Parts from the file/ })).toHaveCount(0);
  await expect(page.getByText("Hull half", { exact: true })).toBeVisible();
  await expect(page.getByText("0 of 2")).toBeVisible();
  await expect
    .poll(async () =>
      (await getItem(page, id)).parts.map((p: { name: string; quantity: number }) => [p.name, p.quantity]),
    )
    .toEqual([
      ["Hull half", 2],
      ["Deck", 1],
    ]);

  // A new attempt from the same file's plate: its parts are on the plate already.
  await page.getByRole("button", { name: "Log attempt" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Attempt 2" });
  await sheet.getByTestId("slicer-file-input").setInputFiles({
    name: PARTS_FILE_NAME,
    mimeType: "application/octet-stream",
    buffer: Buffer.from(bytes),
  });
  await sheet
    .getByRole("region", { name: "Which plate?" })
    .getByRole("button", { name: /Hull and deck/ })
    .click();
  await expect(sheet.getByRole("group", { name: "Hull half, pieces" })).toBeVisible();
  await expect(sheet.getByRole("spinbutton", { name: "Hull half, pieces" })).toHaveAttribute("aria-valuenow", "2");
  await expect(sheet.getByRole("group", { name: "Deck, pieces" })).toBeVisible();
});
