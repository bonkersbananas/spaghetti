import { REMAINING_LABELS, type Remaining } from "@shared/spools";
import { cn } from "@/lib/cn";

const filled: Record<Remaining, number> = { full: 3, half: 2, low: 1, empty: 0 };
const tones: Record<Remaining, string> = {
  full: "bg-basil",
  half: "bg-basil",
  low: "bg-semolina",
  empty: "bg-ink-ghost",
};

/** Roughly how much is left on a spool: three short bars, never grams. */
export function RemainingMeter({
  remaining,
  showLabel,
  className,
}: {
  remaining: Remaining;
  /** The word beside the bars. "lg" shows it from the lg breakpoint (screen readers always hear it). */
  showLabel?: boolean | "lg";
  className?: string;
}) {
  return (
    <span
      className={cn("text-small text-ink-faint inline-flex items-center gap-1.5", className)}
      title={`${REMAINING_LABELS[remaining]}`}
    >
      <span className="inline-flex items-end gap-0.5" aria-hidden>
        {[0, 1, 2].map((bar) => (
          <span
            key={bar}
            className={cn(
              "w-1 rounded-full",
              ["h-2", "h-2.5", "h-3"][bar],
              bar < filled[remaining] ? tones[remaining] : "bg-ink/12",
            )}
          />
        ))}
      </span>
      {showLabel === true ? (
        REMAINING_LABELS[remaining]
      ) : (
        <span className={cn("sr-only", showLabel === "lg" && "lg:not-sr-only")}>{REMAINING_LABELS[remaining]}</span>
      )}
    </span>
  );
}
