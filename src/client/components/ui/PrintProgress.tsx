import { printProgress } from "@shared/print-progress";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/use-now";
import { ProgressRing } from "./ProgressRing";

interface PrintProgressProps {
  /** When the attempt went on the bed (epoch ms): its `printedAt`. */
  startedAt: number;
  /** The slicer's estimate, `settings.estimatedMinutes`. Without one there is nothing to draw. */
  estimatedMinutes?: number;
  /** A bar by default; a ring where there is no room for one. */
  variant?: "bar" | "ring";
  /** The sentence under the bar. Bars only: a ring has no room for words. */
  showLabel?: boolean;
  className?: string;
}

/**
 * How far a printing attempt is: a semolina bar (or ring) filled to elapsed
 * over estimated time, and a sentence that says the same in words ("About 45
 * min left", "Should be done by now"). Never draws progress the app can't
 * know: with no estimate there is no bar, only "On the bed now". Redrawn on
 * the shared 30-second clock, easing between ticks.
 */
export function PrintProgress({
  startedAt,
  estimatedMinutes,
  variant = "bar",
  showLabel = true,
  className,
}: PrintProgressProps) {
  const now = useNow();
  const { fraction, state, label } = printProgress(startedAt, estimatedMinutes, now);
  const meter =
    fraction === null
      ? undefined
      : ({
          role: "progressbar",
          "aria-label": "Print progress",
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": Math.round(fraction * 100),
          "aria-valuetext": label,
        } as const);

  if (variant === "ring") {
    if (fraction === null) return null;
    return (
      <span {...meter} className={cn("text-semolina inline-flex shrink-0", className)}>
        <ProgressRing value={fraction} className="size-5" />
      </span>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      {fraction !== null && (
        <div {...meter} className="bg-ink/8 rounded-pill h-1.5 w-full overflow-hidden">
          <div
            className="bg-semolina rounded-pill duration-slow h-full min-w-1.5 transition-[width] ease-out"
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
      )}
      {showLabel && (
        <p
          className={cn(
            "text-small tabular",
            fraction !== null && "mt-1.5",
            state === "due" ? "text-semolina-ink font-semibold" : "text-ink-soft",
          )}
        >
          {label}
        </p>
      )}
    </div>
  );
}
