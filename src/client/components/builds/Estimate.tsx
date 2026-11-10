import { EstimateIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { formatMinutes } from "./settings";

/** How long it really took next to the slicer's estimate, in plain words. */
export function estimateText(estimated: number, actual: number): string {
  const diff = Math.round(actual - estimated);
  const close = Math.abs(diff) <= Math.max(2, estimated * 0.03);
  if (close) return `Took ${formatMinutes(actual)}, right on the slicer's estimate`;
  return diff > 0
    ? `Took ${formatMinutes(actual)}, ${formatMinutes(diff)} longer than the slicer's ${formatMinutes(estimated)}`
    : `Took ${formatMinutes(actual)}, ${formatMinutes(-diff)} quicker than the slicer's ${formatMinutes(estimated)}`;
}

/** "Took 1 h 42 min, 12 min longer than the slicer's 1 h 30 min." */
export function EstimateLine({
  estimated,
  actual,
  className,
}: {
  estimated: number;
  actual: number;
  className?: string;
}) {
  return (
    <p className={cn("text-small text-ink-soft tabular flex items-start gap-1.5", className)}>
      <EstimateIcon size={16} className="text-ink-faint mt-0.5 shrink-0" aria-hidden />
      <span>{estimateText(estimated, actual)}</span>
    </p>
  );
}

/**
 * Finishing an attempt that was started as "still printing": how long it
 * has been, when that is a believable print time next to the estimate (not a
 * print that sat on the bed overnight).
 */
export function elapsedIfPlausible(printedAt: number, estimated: number | undefined, now = Date.now()) {
  if (estimated === undefined) return undefined;
  const minutes = Math.round((now - printedAt) / 60_000);
  return minutes >= estimated * 0.5 && minutes <= estimated * 2 + 30 ? minutes : undefined;
}
