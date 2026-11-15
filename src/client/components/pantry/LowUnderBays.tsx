import { useQuery } from "@tanstack/react-query";
import { printerQuery } from "@/lib/pantry-queries";
import { useRunningLow } from "@/lib/running-low";
import { RunningLow } from "./RunningLow";

/**
 * "Running low" for the Printer page, which loads it after its first screen: only the spools that are in the bays or
 * on the external holder (the rest are the Pantry's list), with the shopping button and no copy button.
 */
export function LowUnderBays() {
  const { low } = useRunningLow();
  const slots = useQuery(printerQuery).data?.slots ?? {};
  const loaded = new Set(Object.values(slots));
  return <RunningLow low={low.filter(({ spool }) => loaded.has(spool.id))} copy={false} />;
}
