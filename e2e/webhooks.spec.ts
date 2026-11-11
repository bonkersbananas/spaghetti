import { createHmac } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;
/** The e2e server's stand-in for Claude also receives webhooks, on the port 100 above the app (scripts/lib/fake-claude.ts). */
const receiver = (page: Page) => `http://127.0.0.1:${Number(new URL(page.url()).port) + 100}`;

interface Received {
  path: string;
  signature: string;
  timestamp: string;
  delivery: string;
  body: string;
}

async function goToAgents(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole("button", { name: "Account" }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: /^Agents/ })
      .click();
  } else {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("link", { name: "Agents" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Agents" })).toBeVisible();
}

async function removeAll(page: Page) {
  const { webhooks } = await (await page.request.get("/api/webhooks")).json();
  for (const webhook of webhooks) {
    await page.request.delete(`/api/webhooks/${webhook.id}`, { headers: { Origin: origin(page) } });
  }
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  await removeAll(page);
  await page.request.delete(`${receiver(page)}/hooks`);
});

test.afterEach(async ({ page }) => {
  await removeAll(page);
});

test("adds a webhook, copies its secret once, sends a test event and sees it arrive signed", async ({
  page,
  isMobile,
}) => {
  test.setTimeout(90_000);
  await goToAgents(page, isMobile);
  const section = page.getByRole("region", { name: "Webhooks" });
  await expect(section.getByText("None yet.")).toBeVisible();

  await section.getByRole("button", { name: "New webhook" }).click();
  const sheet = page.getByRole("dialog", { name: "New webhook" });
  await sheet.getByLabel("Address").fill(`${receiver(page)}/hooks/ok`);
  await sheet.getByRole("button", { name: "Comments" }).click();
  await sheet.getByRole("button", { name: "Add webhook" }).click();

  // The secret is shown once, with a Copy button.
  const shown = page.getByRole("dialog", { name: "Copy the secret" });
  const secret = (await shown.getByTestId("new-secret").textContent()) ?? "";
  expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
  await shown.getByRole("button", { name: "Copy secret" }).click();
  await expect(shown.getByRole("button", { name: "Copied" })).toBeVisible();
  await shown.getByRole("button", { name: "Done" }).click();
  await expect(shown).toHaveCount(0);

  // Afterwards only its first letters are kept: the API never gives it back.
  const listed = JSON.stringify(await (await page.request.get("/api/webhooks")).json());
  expect(listed).not.toContain(secret);
  expect(listed).toContain(secret.slice(0, 10));

  const card = section.getByRole("listitem").first();
  await expect(card.getByText("comments")).toBeVisible();
  await expect(card.getByText("Nothing sent yet")).toBeVisible();

  await card.getByRole("button", { name: "Send a test event" }).filter({ visible: true }).click();
  const deliveries = card.getByRole("list", { name: "Recent deliveries" });
  await expect(deliveries.getByText("Test event")).toBeVisible();
  await expect(deliveries.getByText("Delivered")).toBeVisible();
  await expect(card.getByText(/Last delivery/)).toBeVisible();

  // The receiver got one signed request.
  const received: Received[] = await (await page.request.get(`${receiver(page)}/hooks`)).json();
  expect(received).toHaveLength(1);
  const [hook] = received;
  expect(hook?.signature).toBe(
    `v1=${createHmac("sha256", secret).update(`${hook?.timestamp}.${hook?.body}`).digest("hex")}`,
  );
  expect(JSON.parse(hook?.body ?? "{}")).toMatchObject({ test: true, more: false, reset: false });

  // Accessible, with the sheet closed and the deliveries open.
  const { violations } = await new AxeBuilder({ page })
    .include("#webhooks")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(violations.map((violation) => violation.id)).toEqual([]);
});

test("says why a webhook can't be reached, retries it, and removes it with an undo", async ({ page, isMobile }) => {
  test.setTimeout(90_000);
  await goToAgents(page, isMobile);
  const section = page.getByRole("region", { name: "Webhooks" });
  await section.getByRole("button", { name: "New webhook" }).click();
  const sheet = page.getByRole("dialog", { name: "New webhook" });
  await sheet.getByLabel("Address").fill(`${receiver(page)}/hooks/broken`);
  await sheet.getByRole("button", { name: "Add webhook" }).click();
  await page.getByRole("dialog", { name: "Copy the secret" }).getByRole("button", { name: "Done" }).click();

  const card = section.getByRole("listitem").first();
  await card.getByRole("button", { name: "Send a test event" }).filter({ visible: true }).click();
  const deliveries = card.getByRole("list", { name: "Recent deliveries" });
  await expect(deliveries.getByText("Retrying")).toBeVisible();
  await expect(deliveries.getByText(/It answered 500/)).toBeVisible();

  // Retry sends it again right away.
  await deliveries.getByRole("button", { name: "Retry" }).click();
  await expect
    .poll(async () => ((await (await page.request.get(`${receiver(page)}/hooks`)).json()) as Received[]).length)
    .toBe(2);

  await card
    .getByRole("button", { name: /^Remove/ })
    .filter({ visible: true })
    .click();
  await expect(section.getByText("None yet.")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(section.getByRole("listitem").first()).toBeVisible();
});

test("refuses an address that isn't https and public (in the real Worker; here only http is let through)", async ({
  page,
  isMobile,
}) => {
  await goToAgents(page, isMobile);
  const section = page.getByRole("region", { name: "Webhooks" });
  await section.getByRole("button", { name: "New webhook" }).click();
  const sheet = page.getByRole("dialog", { name: "New webhook" });
  await sheet.getByLabel("Address").fill("ftp://hooks.example.org/x");
  await sheet.getByRole("button", { name: "Add webhook" }).click();
  await expect(sheet.getByText(/public https address/)).toBeVisible();
});

test("the Agents page links the API reference, and the document is served", async ({ page, isMobile }) => {
  await goToAgents(page, isMobile);
  const link = page.getByRole("link", { name: "API reference" });
  await expect(link).toHaveAttribute("href", "/api/openapi.json");
  const document = await (await page.request.get("/api/openapi.json")).json();
  expect(document.openapi).toBe("3.1.0");
  expect(Object.keys(document.paths)).toContain("/api/webhooks");
});
