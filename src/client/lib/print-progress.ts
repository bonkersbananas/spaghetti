import { livePrintProgress, type PrintProgressResult, printProgress } from "@shared/print-progress";
import { useQuery } from "@tanstack/react-query";
import { printerQuery } from "./pantry-queries";
import { useNow } from "./use-now";

/**
 * How far an attempt is: the printer's own progress while the bridge has reported it lately ("Layer 112 of 240 ·
 * 38 min left"), else the slicer's estimate against the clock. The bridge going silent changes nothing but
 * the words, because `livePrintProgress` lets a report go stale by itself.
 */
export function usePrintProgress(
  attemptId: string | undefined,
  startedAt: number,
  estimatedMinutes: number | undefined,
): PrintProgressResult & { live: boolean } {
  const now = useNow();
  const progress = useQuery({ ...printerQuery, enabled: !!attemptId }).data?.bridge?.progress;
  const live = attemptId && progress?.attemptId === attemptId ? livePrintProgress(progress, now) : null;
  return live ? { ...live, live: true } : { ...printProgress(startedAt, estimatedMinutes, now), live: false };
}
