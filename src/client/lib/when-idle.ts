import { useEffect } from "react";

/**
 * Runs `warm` once, when the browser is idle after the first screen (or after 1.5 s where there is no
 * requestIdleCallback): for code a screen rarely needs but should open at once when asked, such as the account
 * sheet and menu. The first-load budgets (e2e/performance.spec.ts) don't count it.
 */
export function useWhenIdle(warm: () => void) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per mount; warm only starts a load.
  useEffect(() => {
    if (!("requestIdleCallback" in window)) {
      const timer = setTimeout(warm, 1500);
      return () => clearTimeout(timer);
    }
    const id = requestIdleCallback(warm, { timeout: 4000 });
    return () => cancelIdleCallback(id);
  }, []);
}
