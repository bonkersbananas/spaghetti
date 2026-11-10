import { gramsText } from "@shared/ledger";
import { REMAINING_LABELS, type Remaining } from "@shared/spools";
import { cn } from "@/lib/cn";

const filled: Record<Remaining, number> = { full: 3, half: 2, low: 1, empty: 0 };
const tones: Record<Remaining, string> = {
  full: "bg-basil",
  half: "bg-basil",
  low: "bg-semolina",
  empty: "bg-ink-ghost",
};

/**
 * How much is left on a spool: three short bars. With grams known ("about 420 g") the figure
 * stands beside them in place of the level's word, which screen readers still hear.
 */
export function RemainingMeter({
  remaining,
  gramsLeft,
  showLabel,
  className,
}: {
  remaining: Remaining;
  /** Grams left, once the spool has gram data. */
  gramsLeft?: number | null;
  /** The word beside the bars. "lg" shows it from the lg breakpoint (screen readers always hear it). */
  showLabel?: boolean | "lg";
  className?: string;
}) {
  const word = REMAINING_LABELS[remaining];
  const grams = gramsLeft === null || gramsLeft === undefined ? null : `about ${gramsText(gramsLeft)}`;
  return (
    <span
      className={cn("text-small text-ink-faint tabular inline-flex items-center gap-1.5", className)}
      title={grams ? `${word}, ${grams}` : word}
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
        <>
          {grams ?? word}
          {grams && <span className="sr-only">, {word}</span>}
        </>
      ) : (
        <span className={cn("sr-only", showLabel === "lg" && "lg:not-sr-only")}>{grams ?? word}</span>
      )}
    </span>
  );
}
