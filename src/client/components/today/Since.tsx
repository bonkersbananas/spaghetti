import { lazy, Suspense } from "react";
import { useSinceFrom } from "@/lib/since";

const SinceBlock = lazy(() => import("./SinceBlock"));

/**
 * "Since Thursday" at the top of Today and the phone's Journal. Only this small gate is in the screen's first load:
 * the block's code (photo cards, the sentence) is fetched when there is a catch-up to show, which is rare.
 */
export function Since() {
  if (useSinceFrom() === null) return null;
  return (
    <Suspense fallback={null}>
      <SinceBlock />
    </Suspense>
  );
}
