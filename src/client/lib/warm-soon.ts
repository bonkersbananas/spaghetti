import { useEffect } from "react";

/**
 * Starts `load` (a dynamic import) shortly after the first screen, or at the first key press or touch, whichever comes
 * first: for sheets whose code is not part of any screen's first load but must open at once when asked. The timer
 * (rather than only an idle callback) is there because a busy first second may never give the browser an idle moment.
 */
export function useWarmSoon(load: () => Promise<unknown>) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per mount; load only starts a fetch.
  useEffect(() => {
    const events = ["keydown", "pointerdown"] as const;
    let done = false;
    const warm = () => {
      if (done) return;
      done = true;
      for (const type of events) window.removeEventListener(type, warm, true);
      void load();
    };
    for (const type of events) window.addEventListener(type, warm, { capture: true, passive: true });
    const timer = setTimeout(warm, 1000);
    return () => {
      clearTimeout(timer);
      for (const type of events) window.removeEventListener(type, warm, true);
    };
  }, []);
}
