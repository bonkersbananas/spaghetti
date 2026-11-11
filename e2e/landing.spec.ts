import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";
import { signIn } from "./helpers";

/**
 * The landing page (landing.html): what someone signed out sees at /. Signed in, / is the app as before; deep links
 * still go through sign-in and back. The page carries none of the app's code.
 */

const landingHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Spaghetti" });

test("a visitor sees the landing page at /, and Sign in leads to signing in", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.headers()["cache-control"]).toContain("no-cache");
  expect(response?.headers().vary).toContain("Cookie");
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle(/Spaghetti · The 3D printing notebook for two/);
  await expect(landingHeading(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spaghetti happens. Write it down." })).toBeAttached();
  // Shared links get a picture and words.
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://spaghetti.day/og.jpg");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://spaghetti.day/");
  // Nothing of the app's code comes with it: one small script of its own.
  const scripts = await page.locator("script[src]").evaluateAll((all) => all.map((s) => s.getAttribute("src") ?? ""));
  // (The dev server adds its own client.)
  expect(scripts.filter((src) => !src.startsWith("/@vite/"))).toEqual([expect.stringMatching(/landing/)]);
  // Someone who isn't one of the two can host their own.
  await expect(page.getByRole("link", { name: "host your own" })).toHaveAttribute(
    "href",
    "https://github.com/bonkersbananas/spaghetti",
  );
  // No sign-up and no waiting list, anywhere: Sign in is the one way in.
  await expect(page.getByRole("link", { name: /sign up|join|waitlist|waiting list/i })).toHaveCount(0);

  // The top bar's Sign in, and the one at the end.
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(3);
  await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel("Name").fill(SEED_USERS[0].username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();

  // Signed in now: / is the app, straight to Today, without a glimpse of the landing page.
  await page.goto("/");
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
});

test("signed in, / opens the app and never shows the landing page", async ({ page }) => {
  await signIn(page);
  let sawLanding = false;
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/assets/landing/")) sawLanding = true;
  });
  const response = await page.goto("/");
  expect(await response?.text()).not.toContain("lp-word");
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  expect(sawLanding).toBe(false);
});

test("the service worker's shell, /?shell, is the app for anyone", async ({ request }) => {
  // A fetch, not a navigation: on Cloudflare only navigations get the assets' single-page fallback, so an app route
  // like /today would reach the Worker's 404 (wrangler serves index.html either way, so this can't be shown here).
  const response = await request.get("/?shell", { headers: { "Sec-Fetch-Mode": "cors" } });
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain('<div id="root">');
  expect(html).not.toContain("lp-word");
});

test("a deep link still goes to sign-in and back, not to the landing page", async ({ page }) => {
  await page.goto("/journal?outcome=failures");
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await page.getByLabel("Name").fill(SEED_USERS[0].username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/journal\?outcome=failures$/);
});

test("How did it go? answers each pick", async ({ page }) => {
  await page.goto("/");
  const toy = page.getByRole("group", { name: "How did it go?" });
  await toy.scrollIntoViewIfNeeded();
  await toy.getByRole("button", { name: "Spaghetti" }).click();
  await expect(toy.getByRole("button", { name: "Spaghetti" })).toHaveAttribute("aria-pressed", "true");
  const answer = page.locator("[data-answer]");
  await expect(answer).toHaveText(/^A proud nest\./);
  await toy.getByRole("button", { name: "Worked" }).click();
  await expect(toy.getByRole("button", { name: "Spaghetti" })).toHaveAttribute("aria-pressed", "false");
  await expect(answer).toHaveText(/^Al dente\./);
});

test("the landing page passes axe, with motion and without", async ({ page }) => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/");
    await expect(landingHeading(page)).toBeVisible();
    // Everything that arrives on scroll has arrived (axe measures contrast on what is drawn).
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) {
        scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      scrollTo(0, 0);
    });
    await page.waitForTimeout(3500);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }
});
