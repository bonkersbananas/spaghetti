import { useRunningLow } from "@/lib/running-low";
import { RunningLow } from "./RunningLow";

/** "Running low" for the Printer page, which loads it after its first screen. */
export function LowUnderBays() {
  const { low } = useRunningLow();
  return <RunningLow low={low} />;
}
