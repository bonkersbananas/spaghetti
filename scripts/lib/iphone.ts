import type { BrowserContext, Page } from "@playwright/test";

/** An iPhone's safe areas in standalone mode (Dynamic Island at the top, home indicator at the bottom), in px. */
export const IPHONE_INSETS = { top: 59, bottom: 34 };

/**
 * Makes a browser context behave like the Home Screen app on an iPhone: the display mode is
 * standalone and the safe areas are not zero. `env(safe-area-inset-*)` can't be set from Playwright,
 * so the app reads it through --sg-safe-top and --sg-safe-bottom (tokens.css), and this overrides those.
 */
export async function simulateIphone(context: BrowserContext, insets = IPHONE_INSETS) {
  await context.addInitScript((inset) => {
    const apply = () => {
      const style = document.createElement("style");
      style.textContent = `:root { --sg-safe-top: ${inset.top}px !important; --sg-safe-bottom: ${inset.bottom}px !important; }`;
      document.documentElement.append(style);
    };
    if (document.documentElement) apply();
    else
      new MutationObserver((_, observer) => document.documentElement && (observer.disconnect(), apply())).observe(
        document,
        { childList: true },
      );
  }, insets);
  const standalone = async (page: Page) => {
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setEmulatedMedia", { features: [{ name: "display-mode", value: "standalone" }] });
  };
  context.on("page", (page) => void standalone(page));
  await Promise.all(context.pages().map(standalone));
}
