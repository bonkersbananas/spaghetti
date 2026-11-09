import type { Page } from "@playwright/test";
import { SEED_IDS } from "./seed/ideas.ts";

export interface Shot {
  /** File name, without width or extension: "ideas" → ideas-390.png. */
  name: string;
  path: string;
  /** Take it signed out (sign-in screen). */
  signedOut?: boolean;
  /** The whole scrollable page, not just the viewport. */
  fullPage?: boolean;
  /** Only at this width, for screens that exist on one layout. */
  width?: 390 | 1440;
  /** Runs after the page loads, to open a sheet or reach a state. */
  prepare?: (page: Page) => Promise<void>;
  /** Runs after the screenshot, to undo what prepare changed for the next width. */
  cleanup?: (page: Page) => Promise<void>;
}

/**
 * The screens `pnpm screenshots` captures, at 390×844 and 1440×900.
 * Add your feature's screens here.
 */
export const shots: Shot[] = [
  { name: "sign-in", path: "/sign-in", signedOut: true },
  { name: "ideas", path: "/ideas" },
  { name: "builds", path: "/builds" },
  { name: "journal", path: "/journal" },
  { name: "search", path: "/search" },
  {
    name: "capture",
    path: "/ideas",
    prepare: async (page) => {
      await page.getByRole("button", { name: "New idea" }).first().click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor();
      await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/tugboat.jpg");
      await sheet.getByRole("textbox", { name: "Note" }).fill("Tugboat, take two: a flatter hull and a bigger funnel");
      await sheet.getByRole("button", { name: "Remove Photo 1" }).waitFor();
      await page.waitForTimeout(400);
      await sheet.getByRole("textbox", { name: "Note" }).blur();
    },
  },
  { name: "idea", path: `/ideas/${SEED_IDS.deskTidy}` },
  {
    name: "undo",
    path: "/ideas",
    prepare: async (page) => {
      await page.goto(`/ideas/${SEED_IDS.tugboat}`);
      await page.getByRole("button", { name: "Delete idea" }).first().click();
      await page.getByText("Idea deleted").waitFor();
      await page.locator("h1").first().waitFor();
    },
    cleanup: async (page) => {
      await page.getByRole("button", { name: "Undo" }).click();
      await page.getByRole("link", { name: /Bath tugboat/ }).waitFor();
    },
  },
  {
    name: "account",
    path: "/ideas",
    width: 390,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Account" }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  { name: "styleguide", path: "/styleguide", fullPage: true },
];
