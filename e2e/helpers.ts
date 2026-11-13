import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

/**
 * Signs in as `user` and lands on the Ideas inbox (what most tests start from). The session is made through the
 * API: the browser context keeps its cookie, so the sign-in form's page loads (two of them, about three seconds on
 * CI, for hundreds of tests) are skipped. The form itself is tested in smoke.spec.ts and passkeys.spec.ts.
 */
export async function signIn(
  page: Page,
  user: { username: string } = SEED_USERS[0],
  origin = new URL(page.url() === "about:blank" ? (test.info().project.use.baseURL ?? "") : page.url()).origin,
) {
  const response = await page.request.post("/api/session", {
    headers: { Origin: origin },
    data: { username: user.username, password: SEED_PASSWORD },
  });
  expect(response.ok(), "signing in through the API").toBe(true);
  await page.goto("/ideas");
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
}

/** The same through the sign-in form, for the tests that are about signing in (the quiet passkey offer follows a password sign-in). */
export async function signInWithForm(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(SEED_USERS[0].username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Signing in lands on Today (Journal on phones, which have no Today); these tests start from the inbox.
  await expect(page.getByRole("heading", { level: 1, name: /^(Today|Journal)$/ })).toBeVisible();
  await page.goto("/ideas");
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
}

/** Removes every idea and build through the API, so the next test starts with an empty inbox. */
export async function clearIdeas(page: Page) {
  const origin = new URL(page.url()).origin;
  const response = await page.request.get("/api/items?stage=idea,building,done,shelved");
  if (!response.ok()) return;
  const { items } = await response.json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin } });
}

/**
 * Controls drawn smaller than 44 px that have no 44 px hit area (`touch-target`), on the visible page or in a sheet.
 * Links inside running text are left out, as WCAG does.
 */
export async function smallTargets(page: Page, within = "body") {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector) ?? document.body;
    const small: string[] = [];
    const controls = root.querySelectorAll<HTMLElement>(
      "a[href], button, [role=switch], [role=radio], [role=checkbox], input:not([type=hidden]), select, textarea, summary",
    );
    for (const control of Array.from(controls)) {
      if (control.closest("[aria-hidden=true], [inert]")) continue;
      const box = control.getBoundingClientRect();
      // Hidden, or a native radio under a drawn control (SegmentedControl).
      if (box.width <= 1 || box.height <= 1) continue;
      const style = getComputedStyle(control);
      if (style.visibility === "hidden") continue;
      if (control.tagName === "A" && style.display === "inline" && control.parentElement?.closest("p")) continue;
      // A writing surface that reads as text (a title, the "for" line) is tapped anywhere along its full width.
      if ((control.tagName === "TEXTAREA" || control.tagName === "INPUT") && box.width >= 160 && box.height >= 28)
        continue;
      // A link around a button (the app's way to give a link a button's look) is as big as the button it holds.
      if (control.tagName === "A" && control.querySelector("button")) continue;
      // The hit area: the control, its touch-target (an ::after), or the label it sits in and that label's.
      let width = 0;
      let height = 0;
      for (const element of [control, control.closest("label")]) {
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        const hit = getComputedStyle(element, "::after");
        const extended = hit.content !== "none" && hit.position === "absolute";
        width = Math.max(width, rect.width, extended ? Number.parseFloat(hit.width) || 0 : 0);
        height = Math.max(height, rect.height, extended ? Number.parseFloat(hit.height) || 0 : 0);
      }
      if (width < 43.5 || height < 43.5) {
        const name = (control.getAttribute("aria-label") ?? control.textContent ?? "").trim().slice(0, 40);
        small.push(`${Math.round(width)}×${Math.round(height)} ${control.tagName.toLowerCase()} "${name}"`);
      }
    }
    return small;
  }, within);
}
