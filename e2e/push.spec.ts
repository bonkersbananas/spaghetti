import { createECDH, randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { SEED_USERS } from "../scripts/lib/local-app.ts";
import { clearIdeas, signIn } from "./helpers";

// These run against the production build: the dev server has no service worker, so nothing can subscribe.

const ENDPOINT = "https://push.example/e2e-device";

async function waitForServiceWorker(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

/** A browser that can subscribe: the real push service needs the internet, so the subscription is a stand-in with a real key. */
async function fakeSubscription(page: Page) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const keys = {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: Buffer.from(randomUUID().slice(0, 16)).toString("base64url"),
  };
  await page.addInitScript(
    ({ endpoint, keys }) => {
      // Kept across reloads, as a browser keeps a real subscription.
      let current: unknown = null;
      const subscription = {
        endpoint,
        toJSON: () => ({ endpoint, keys }),
        unsubscribe: async () => {
          current = null;
          localStorage.removeItem("e2e-push");
          return true;
        },
      };
      // Headless Chromium answers "denied" however the context is set up; a person who allows it gets "granted".
      let permission: NotificationPermission = "default";
      Object.defineProperty(Notification, "permission", { get: () => permission });
      Notification.requestPermission = async () => {
        permission = "granted";
        localStorage.setItem("e2e-push", "on");
        return permission;
      };
      const kept = () => localStorage.getItem("e2e-push") === "on";
      if (kept()) {
        current = subscription;
        permission = "granted";
      }
      PushManager.prototype.getSubscription = async () => current as PushSubscription | null;
      PushManager.prototype.subscribe = async () => {
        current = subscription;
        return subscription as unknown as PushSubscription;
      };
    },
    { endpoint: ENDPOINT, keys },
  );
}

async function openNotifications(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole("button", { name: "Account" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Notifications/ })
      .click();
  } else {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("dialog", { name: "Account" }).getByRole("button", { name: "Notifications" }).click();
  }
  const sheet = page.getByRole("dialog", { name: "Notifications" });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** A build with one print on the bed. */
async function printing(page: Page) {
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin };
  const itemId = randomUUID();
  const attemptId = randomUUID();
  await page.request.post("/api/items", { data: { id: itemId, title: "Tugboat", stage: "building" }, headers });
  await page.request.post(`/api/items/${itemId}/attempts`, { data: { id: attemptId }, headers });
  return { itemId, attemptId, headers };
}

const outcomeOf = async (page: Page, itemId: string, attemptId: string) => {
  const { item } = await (await page.request.get(`/api/items/${itemId}`)).json();
  return item.attempts.find((a: { id: string }) => a.id === attemptId)?.outcome ?? null;
};

test.afterEach(async ({ page }) => {
  await page.request.delete("/api/push/subscription", {
    data: { endpoint: ENDPOINT },
    headers: { Origin: new URL(page.url()).origin },
  });
  await clearIdeas(page);
});

test("turns notifications on and off for this device, and asks about the other person's prints", async ({
  page,
  isMobile,
}) => {
  await fakeSubscription(page);
  await signIn(page);
  await waitForServiceWorker(page);

  const sheet = await openNotifications(page, isMobile);
  const device = sheet.getByRole("switch", { name: /Notify this device/ });
  await expect(device).toHaveAttribute("aria-checked", "false");
  // Permission is asked for only when this is turned on, and the sheet says so beforehand.
  await expect(sheet.getByText("Your browser will ask for permission when you turn this on.")).toBeVisible();
  await expect(sheet.getByRole("switch", { name: /Also tell me/ })).toHaveCount(0);

  await device.click();
  await expect(device).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Notifications are on")).toBeVisible();
  await expect(sheet.getByText(/Quiet from 22:00 to 07:00/)).toBeVisible();
  const others = sheet.getByRole("switch", { name: /Also tell me about Sam Okafor's prints/ });
  await expect(others).toHaveAttribute("aria-checked", "false");

  const devices = async () => (await (await page.request.get("/api/push")).json()).subscriptions;
  await expect.poll(async () => (await devices()).map((d: { endpoint: string }) => d.endpoint)).toEqual([ENDPOINT]);

  await others.click();
  await expect(others).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await devices())[0]?.alsoOthers).toBe(true);

  // It survives a visit: the choice is on the server.
  await page.reload();
  const again = await openNotifications(page, isMobile);
  await expect(again.getByRole("switch", { name: /Notify this device/ })).toHaveAttribute("aria-checked", "true");
  await expect(again.getByRole("switch", { name: /Also tell me/ })).toHaveAttribute("aria-checked", "true");

  await again.getByRole("switch", { name: /Notify this device/ }).click();
  await expect(again.getByRole("switch", { name: /Notify this device/ })).toHaveAttribute("aria-checked", "false");
  await expect.poll(devices).toEqual([]);
  expect(SEED_USERS[1].name).toBe("Sam Okafor");
});

test("a device the server forgot signs itself up again, and signing out lets go of it", async ({ page, isMobile }) => {
  await fakeSubscription(page);
  await signIn(page);
  await waitForServiceWorker(page);
  const sheet = await openNotifications(page, isMobile);
  await sheet.getByRole("switch", { name: /Notify this device/ }).click();
  const devices = async () =>
    (await (await page.request.get("/api/push")).json()).subscriptions.map((d: { endpoint: string }) => d.endpoint);
  await expect.poll(devices).toEqual([ENDPOINT]);

  // The server lets go of it (as when the push service once answers "gone"), the browser still holds it.
  const origin = new URL(page.url()).origin;
  await page.request.delete("/api/push/subscription", { data: { endpoint: ENDPOINT }, headers: { Origin: origin } });
  await expect.poll(devices).toEqual([]);

  // The next start signs it up again, with nobody touching anything.
  await page.reload();
  await expect.poll(devices).toEqual([ENDPOINT]);

  // Signing out forgets it on both sides, so the next start has nothing to bring back.
  if (isMobile) {
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
  } else {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("dialog", { name: "Account" }).getByRole("button", { name: "Sign out" }).click();
  }
  await expect(page).toHaveURL(/\/sign-in/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("e2e-push"))).toBeNull();
  await signIn(page);
  await waitForServiceWorker(page);
  await page.waitForTimeout(1500);
  expect(await devices()).toEqual([]);
});

test("a notification's answer records the outcome through the service worker, and the notification opens the sheet", async ({
  page,
}) => {
  await signIn(page);
  await waitForServiceWorker(page);
  const { itemId, attemptId } = await printing(page);

  // Tapping the notification itself opens the attempt sheet, once, and the address forgets the flag.
  await page.goto(`/builds/${itemId}?attempt=${attemptId}&finish=1`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).not.toHaveURL(/finish=1/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await waitForServiceWorker(page);

  // What tapping "Partly" on the notification does.
  await page.evaluate(
    async ({ attemptId, itemId }) => {
      const registration = await navigator.serviceWorker.ready;
      registration.active?.postMessage({
        type: "answer-nudge",
        nudge: { attemptId, itemId, url: `/builds/${itemId}?attempt=${attemptId}&finish=1` },
        outcome: "partial",
      });
    },
    { attemptId, itemId },
  );
  await expect.poll(() => outcomeOf(page, itemId, attemptId)).toBe("partial");
});

test("with no connection the answer waits in the outbox and lands when the app is back", async ({ page, context }) => {
  await signIn(page);
  await waitForServiceWorker(page);
  const { itemId, attemptId } = await printing(page);

  // The service worker's own request fails, as it does with no signal.
  await context.route("**/api/attempts/*/finish", (route) => route.abort());
  await page.evaluate(
    async ({ attemptId, itemId }) => {
      const registration = await navigator.serviceWorker.ready;
      registration.active?.postMessage({
        type: "answer-nudge",
        nudge: { attemptId, itemId, url: `/builds/${itemId}` },
        outcome: "failed",
      });
    },
    { attemptId, itemId },
  );
  const queued = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open("spaghetti", 1);
          open.onsuccess = () => {
            const read = open.result.transaction("outbox").objectStore("outbox").getAll();
            read.onsuccess = () => resolve(read.result.flatMap((entry) => entry.finishes ?? []).length);
          };
        }),
    );
  await expect.poll(queued).toBe(1);
  expect(await outcomeOf(page, itemId, attemptId)).toBeNull();

  // Back online: the open app picks the queued answer up and sends it.
  await context.unroute("**/api/attempts/*/finish");
  await page.reload();
  await expect.poll(() => outcomeOf(page, itemId, attemptId)).toBe("failed");
});
