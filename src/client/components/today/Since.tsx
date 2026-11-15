import { lazy, Suspense, useEffect, useState } from "react";

const SinceBlock = lazy(() => import("./SinceBlock"));

/** Is there a catch-up to show? The key and shape are lib/since.ts's, read here by hand so its code stays out of the first load. */
function hasCatchUp(): boolean {
  try {
    const since = JSON.parse(localStorage.getItem("sg-since") ?? "null") as { until?: number } | null;
    return typeof since?.until === "number" && Date.now() < since.until;
  } catch {
    return false;
  }
}

/**
 * "Since Thursday" at the top of Today and the phone's Journal. Only this small gate is in the screen's first load:
 * the block's code (photo cards, the sentence, the clock) is fetched when there is a catch-up to show, which is rare.
 */
export function Since() {
  const [on, setOn] = useState(hasCatchUp);
  // Coming back to the app may have started one (lib/since.ts decides on the same event, a moment earlier or later).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setOn(hasCatchUp()), 300);
    };
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  if (!on) return null;
  return (
    <Suspense fallback={null}>
      <SinceBlock />
    </Suspense>
  );
}
