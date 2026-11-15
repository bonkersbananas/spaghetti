import { lazy, Suspense, useEffect, useState } from "react";
import { hasCatchUp, markActive } from "@/lib/since-clock";

const SinceBlock = lazy(() => import("./SinceBlock"));

/**
 * "Since Thursday" at the top of Today and the phone's Journal. Only this small gate is in the screen's first load:
 * the block's code (photo cards, the sentence) is fetched when there is a catch-up to show, which is rare.
 */
export function Since() {
  const [on, setOn] = useState(() => {
    // A cold start on this screen: the clock may not be running yet (it starts when the app is idle).
    markActive();
    return hasCatchUp();
  });
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
