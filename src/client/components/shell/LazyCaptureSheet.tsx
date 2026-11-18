import { useState } from "react";
import { useCapture } from "@/lib/capture";
import { preloaded } from "@/lib/preloaded";
import { useWarmSoon } from "@/lib/warm-soon";

// The capture sheet (and the sheet library behind it) is not part of any screen's first load: it is fetched just after
// the first screen, or at the first key press or touch, and mounts the first time it opens (straight from the loaded
// module, not through React.lazy: see lib/preloaded.ts).
const sheet = preloaded(() => import("./CaptureSheet"));
const warmSheet = () => sheet.start();

export function LazyCaptureSheet() {
  const { open } = useCapture();
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  useWarmSoon(warmSheet);
  const loaded = sheet.use();
  if (wanted && !loaded) void warmSheet();
  return wanted && loaded ? <loaded.CaptureSheet /> : null;
}
