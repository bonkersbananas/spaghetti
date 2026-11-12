import { lazy, Suspense, useState } from "react";
import { useCapture } from "@/lib/capture";
import { useWarmSoon } from "@/lib/warm-soon";

// The capture sheet (and the sheet library behind it) is not part of any screen's first load: it is fetched just after
// the first screen, or at the first key press or touch, and mounts the first time it opens.
const loadCaptureSheet = () => import("./CaptureSheet");
const CaptureSheet = lazy(() => loadCaptureSheet().then((m) => ({ default: m.CaptureSheet })));

export function LazyCaptureSheet() {
  const { open } = useCapture();
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  useWarmSoon(loadCaptureSheet);
  return wanted ? (
    <Suspense fallback={null}>
      <CaptureSheet />
    </Suspense>
  ) : null;
}
