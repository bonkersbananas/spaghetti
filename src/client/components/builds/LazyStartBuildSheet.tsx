import { useState } from "react";
import { preloaded } from "@/lib/preloaded";
import { useWarmSoon } from "@/lib/warm-soon";

// The picker (its rows, search and file picking) is not part of the Builds page's first load: it is fetched just after
// the page, or at the first key press or touch, and mounts the first time it opens (see lib/preloaded.ts).
const sheet = preloaded(() => import("./StartBuildSheet"));
export const warmStartBuildSheet = () => sheet.start();

export function LazyStartBuildSheet({
  open,
  onOpenChange,
  onFromScratch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFromScratch: () => void;
}) {
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  useWarmSoon(warmStartBuildSheet);
  const loaded = sheet.use();
  if (wanted && !loaded) void warmStartBuildSheet();
  return wanted && loaded ? (
    <loaded.StartBuildSheet open={open} onOpenChange={onOpenChange} onFromScratch={onFromScratch} />
  ) : null;
}
