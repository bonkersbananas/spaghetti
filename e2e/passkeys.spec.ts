import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";
import { signInWithForm as signIn } from "./helpers";

// Passkeys belong to "localhost", not to 127.0.0.1 (an IP address can't be a relying party), so these tests
// open the same dev server by its name. Each one uses its own virtual authenticator (Chromium's CDP WebAuthn).
test.setTimeout(90_000);

const BASE = "http://localhost:5174";
test.use({ baseURL: BASE });
const origin = () => BASE;
const headers = () => ({ Origin: origin() });

/** This device was already asked about a passkey: no quiet offer to get in the way. */
const noOffer = (context: BrowserContext) =>
  context.addInitScript(() => localStorage.setItem("sg-passkey-offer", "done"));

async function addAuthenticator(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

/** Passkeys left by an earlier test or run on this server: start from none. */
async function clearPasskeys(page: Page) {
  const { passkeys } = await (await page.request.get("/api/account/passkeys")).json();
  for (const passkey of passkeys)
    await page.request.delete(`/api/account/passkeys/${passkey.id}`, { headers: headers() });
}

/** The account menu (desktop) or account sheet (phone), then one of its rows. */
async function openRow(page: Page, isMobile: boolean, row: string | RegExp) {
  if (isMobile) {
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("dialog").getByRole("button", { name: row }).click();
  } else {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("dialog", { name: "Account" }).getByRole("button", { name: row }).click();
  }
}

/**
 * Signs out the way a person does (the app keeps a copy of who was signed in, so clearing cookies isn't a
 * sign-out). Waits for the server to end the session, not for a button: with a virtual authenticator the
 * sign-in screen's own passkey offer (conditional UI) can sign straight back in, and then no Sign in button shows.
 */
async function signOut(page: Page, isMobile: boolean) {
  const ended = page.waitForResponse(
    (response) => response.url().endsWith("/api/session") && response.request().method() === "DELETE",
  );
  if (isMobile) {
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
  } else {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("dialog", { name: "Account" }).getByRole("button", { name: "Sign out" }).click();
  }
  expect((await ended).ok()).toBe(true);
  // The app has left the screen it was on (its heading may still be fading out, and would pass for Today).
  await page.waitForURL(/\/sign-in/);
}

async function expectAccessible(page: Page, name: string, include?: string) {
  let axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]);
  if (include) axe = axe.include(include);
  const { violations } = await axe.analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    name,
  ).toEqual([]);
}

test("adds a passkey, signs out and signs in with it; remove asks for no confirmation and can be undone", async ({
  page,
  context,
  isMobile,
}) => {
  await noOffer(context);
  await addAuthenticator(context, page);
  await signIn(page);
  await clearPasskeys(page);
  await openRow(page, isMobile, "Passkeys and password");
  const sheet = page.getByRole("dialog", { name: "Passkeys and password" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(/None yet/)).toBeVisible();
  await sheet.getByRole("button", { name: /^Sign in with .* next time$/ }).click();
  await expect(page.getByText(/Passkey added|is set up/)).toBeVisible();
  // One row: the device's name, when it was added, and that it hasn't been used.
  await expect(sheet.getByText(/not used yet/)).toBeVisible();
  await expectAccessible(page, "The passkeys sheet", "[role=dialog]");

  // Rename it.
  await sheet.getByRole("button", { name: /^Rename / }).click();
  const input = sheet.getByLabel("Passkey name");
  await input.fill("Kitchen laptop");
  await input.press("Enter");
  await expect(sheet.getByText("Kitchen laptop")).toBeVisible();

  // Sign out (the session only), then sign in with the passkey: no name, no password.
  await page.keyboard.press("Escape");
  await signOut(page, isMobile);
  // With a virtual authenticator the username field's own passkey offer (conditional UI) can sign in by itself,
  // before anything is pressed; otherwise the sign-in screen offers the passkey button. Either way no name or
  // password is typed.
  const today = page.getByRole("heading", { level: 1, name: "Today" });
  const passkeyButton = page.getByRole("button", { name: /^Sign in with / });
  await expect(today.or(passkeyButton)).toBeVisible();
  if (await passkeyButton.isVisible()) {
    // The screen we left (Today's empty state) is still fading out for a moment.
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
    await expectAccessible(page, "The sign-in screen with its passkey button");
    await passkeyButton.click({ timeout: 3000 }).catch(() => undefined);
  }
  await expect(today).toBeVisible();

  // It remembers being used. Removing it is undone with the toast, then done.
  await openRow(page, isMobile, "Passkeys and password");
  const again = page.getByRole("dialog", { name: "Passkeys and password" });
  await expect(again.getByText(/used (just now|\d+ min ago)/)).toBeVisible();
  await again.getByRole("button", { name: "Remove Kitchen laptop" }).click();
  await expect(again.getByText("Kitchen laptop")).toBeHidden();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(again.getByText("Kitchen laptop")).toBeVisible();
  await again.getByRole("button", { name: "Remove Kitchen laptop" }).click();
  await expect(page.getByText("Passkey removed").first()).toBeVisible();
  await expect
    .poll(async () => (await (await page.request.get("/api/account/passkeys")).json()).passkeys.length, {
      timeout: 15_000,
    })
    .toBe(0);
});

test("a sign-in link and a code sign in a second browser, once, and the first device sees it", async ({
  page,
  browser,
  isMobile,
}) => {
  await signIn(page);
  await openRow(page, isMobile, "Sign in on another device");
  const sheet = page.getByRole("dialog", { name: "Sign in on another device" });
  await expect(sheet).toBeVisible();
  // Desktop shows a QR code; phones show a link to share. Both show the short code.
  if (!isMobile) await expect(sheet.getByRole("img", { name: /QR code/ })).toBeVisible();
  else await expect(sheet.getByRole("button", { name: "Copy link" })).toBeVisible();
  const code = (await sheet.getByText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/).textContent()) ?? "";
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await expectAccessible(page, "The sign-in-on-another-device sheet", "[role=dialog]");

  // The other device types the code (no camera), and is offered a passkey before moving on.
  const other = await browser.newContext({ baseURL: origin() });
  const phone = await other.newPage();
  await addAuthenticator(other, phone);
  await phone.goto("/sign-in");
  await phone.getByRole("link", { name: /Use a code/ }).click();
  await phone.getByLabel("Code").fill(code);
  await phone.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(phone.getByText(/Welcome/)).toBeVisible();
  await expectAccessible(phone, "The add-a-passkey offer");
  await phone.getByRole("button", { name: /^Add / }).click();
  await expect(phone.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  expect((await phone.request.get("/api/session")).status()).toBe(200);

  // The first device hears about it.
  await expect(sheet.getByText(/Signed in on /)).toBeVisible({ timeout: 20_000 });
  await sheet.getByRole("button", { name: "Done" }).click();

  // The code is spent.
  const reuse = await other.request.post("/api/session/link", { data: { code }, headers: headers() });
  expect(reuse.status()).toBe(410);

  // A link works the same way, from its address; used again it says so calmly.
  const made = await (await page.request.post("/api/account/sign-in-links", { headers: headers() })).json();
  const third = await browser.newContext({ baseURL: origin() });
  const tab = await third.newPage();
  await tab.goto(made.url.replace(/^https?:\/\/[^/]+/, origin()));
  await expect(tab.getByText(/One tap and this device is signed in too/)).toBeVisible();
  await tab.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(tab.getByText(/Welcome/)).toBeVisible();
  await tab.getByRole("button", { name: "Not now" }).click();
  await expect(tab.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();

  const again = await browser.newContext({ baseURL: origin() });
  const late = await again.newPage();
  await late.goto(made.url.replace(/^https?:\/\/[^/]+/, origin()));
  await late.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(late.getByText("That link has done its job.")).toBeVisible();
  await expectAccessible(late, "A used link");
  await other.close();
  await third.close();
  await again.close();
});

test("an invite adds one person, who is signed in, and can't be used twice", async ({ page, browser, isMobile }) => {
  await signIn(page);
  const { invites } = await (await page.request.get("/api/account/invites")).json();
  for (const invite of invites) await page.request.delete(`/api/account/invites/${invite.id}`, { headers: headers() });
  await openRow(page, isMobile, "Invite someone");
  const sheet = page.getByRole("dialog", { name: "Invite someone" });
  await sheet.getByRole("button", { name: "Make an invite link" }).click();
  await expect(sheet.getByText(/\/join#spi_/)).toBeVisible();
  await expectAccessible(page, "The invite sheet", "[role=dialog]");
  // Make a second: the first is listed as waiting, and gone once withdrawn. The new one is the one to use.
  await sheet.getByRole("button", { name: "Make another invite" }).click();
  await expect(sheet.getByRole("button", { name: "Withdraw invite" })).toHaveCount(1);
  await sheet.getByRole("button", { name: "Withdraw invite" }).click();
  await expect(sheet.getByRole("button", { name: "Withdraw invite" })).toHaveCount(0);
  const link = (await sheet.getByText(/\/join#spi_/).textContent()) ?? "";
  expect(link).toMatch(/\/join#spi_/);

  const guest = await browser.newContext({ baseURL: origin() });
  const tab = await guest.newPage();
  const username = `mina${Date.now() % 1_000_000}`;
  await tab.goto(link.replace(/^https?:\/\/[^/]+/, origin()));
  await expect(tab.getByText(/saved you a seat/)).toBeVisible();
  await expectAccessible(tab, "The invite page");
  await tab.getByLabel("Your name").fill("Mina Park");
  await tab.getByLabel("Username").fill(username);
  await tab.getByRole("radio", { name: "plum" }).click();
  await tab.getByRole("radio", { name: "Password" }).click();
  await tab.locator("input[name=new-password]").fill("a-long-enough-password");
  await tab.getByRole("button", { name: "Join", exact: true }).click();
  await expect(tab.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  const me = await (await tab.request.get("/api/session")).json();
  expect(me.user).toMatchObject({ username, name: "Mina Park", color: "plum" });

  // The same link, again: used up, and said calmly.
  const late = await (await browser.newContext({ baseURL: origin() })).newPage();
  await late.goto(link.replace(/^https?:\/\/[^/]+/, origin()));
  await expect(late.getByText("This invite has done its job.")).toBeVisible();
  await guest.close();
});

test("an invite can be accepted with a passkey and no password", async ({ page, browser }) => {
  await signIn(page);
  const made = await (await page.request.post("/api/account/invites", { headers: headers() })).json();
  const guest = await browser.newContext({ baseURL: origin() });
  const tab = await guest.newPage();
  await addAuthenticator(guest, tab);
  const username = `pia${Date.now() % 1_000_000}`;
  await tab.goto(made.url.replace(/^https?:\/\/[^/]+/, origin()));
  await tab.getByLabel("Your name").fill("Pia Lind");
  await tab.getByLabel("Username").fill(username);
  await tab.getByRole("button", { name: /^Join with / }).click();
  await expect(tab.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  // They can sign in with it from scratch.
  await guest.clearCookies();
  await tab.goto("/sign-in");
  await tab
    .getByRole("button", { name: /^Sign in with / })
    .click({ timeout: 3000 })
    .catch(() => undefined);
  await expect(tab.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await guest.close();
});

test("after a password sign-in, a quiet offer for a passkey comes once and never again", async ({
  page,
  context,
  isMobile,
}) => {
  await context.addInitScript(() => sessionStorage.setItem("sg-force-offer", "1"));
  await addAuthenticator(context, page);
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(SEED_USERS[0].username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  const offer = page.getByText(/^Next time, just /);
  await expect(offer).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(offer).toBeHidden();

  // Signing in by password again on this device: it is not offered again.
  await signOut(page, isMobile);
  await page.getByLabel("Name").fill(SEED_USERS[0].username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.getByText(/^Next time, just /)).toHaveCount(0);
});

test("the signed-in devices list signs out another device", async ({ page, browser, isMobile }) => {
  await signIn(page);
  const other = await browser.newContext({ baseURL: origin() });
  const login = await other.request.post("/api/session", {
    data: { username: SEED_USERS[0].username, password: SEED_PASSWORD },
    headers: headers(),
  });
  expect(login.ok()).toBe(true);
  await openRow(page, isMobile, "Passkeys and password");
  const sheet = page.getByRole("dialog", { name: "Passkeys and password" });
  await expect(sheet.getByText("This device", { exact: true })).toBeVisible();
  await expectAccessible(page, "The passkeys and password sheet", "[role=dialog]");
  await sheet.getByRole("button", { name: "Sign out everywhere else" }).click();
  await expect.poll(async () => (await other.request.get("/api/session")).status()).toBe(401);
  expect((await page.request.get("/api/session")).status()).toBe(200);
  await other.close();
});
