import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items?stage=idea,building,done,shelved")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

// A build with an answered attempt and a newer one that came off the bed with no outcome: it must open.
for (const [withLink, staleFinish] of [
  [false, false],
  [true, false],
  [false, true],
] as const) {
  test(`@phone a build with an attempt off the bed and no outcome opens${withLink ? " from its link" : ""}${staleFinish ? " with a finish of an unknown kind waiting on this device" : ""}`, async ({
    page,
  }) => {
    const headers = { Origin: origin(page) };
    const itemId = crypto.randomUUID();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    await page.request.post("/api/items", { headers, data: { id: itemId, title: "Glass markers", stage: "building" } });
    await page.request.post(`/api/items/${itemId}/attempts`, {
      headers,
      data: { id: first, printedAt: Date.now() - 3 * 86_400_000, outcome: "partial" },
    });
    await page.request.post(`/api/items/${itemId}/attempts`, {
      headers,
      data: { id: second, printedAt: Date.now() - 90 * 60_000 },
    });
    await page.request.patch(`/api/attempts/${second}`, { headers, data: { endedAt: Date.now() - 10 * 60_000 } });

    if (staleFinish) {
      // A finish stored by some other version of the app, with an outcome this one has no word for.
      await page.evaluate(
        ([item, attempt]) =>
          new Promise<void>((resolve, reject) => {
            const open = indexedDB.open("spaghetti", 1);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const tx = open.result.transaction("outbox", "readwrite");
              tx.objectStore("outbox").put({
                itemId: item,
                photos: [],
                queuedAt: Date.now(),
                finishes: [
                  {
                    attemptId: attempt,
                    outcome: "constructor",
                    finishedAt: Date.now(),
                    note: "",
                    failureTags: [],
                    successNotes: [],
                  },
                ],
              });
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
            };
          }),
        [itemId, second],
      );
    }
    await page.goto(`/builds/${itemId}${withLink ? `?attempt=${second}` : ""}`);
    await expect(page.getByText("That got tangled")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Attempt 2: off the bed" }).first()).toBeVisible();
  });
}
