import { OUTCOME_LABELS, OUTCOMES } from "@shared/attempts";
import type { MonthBar } from "@shared/insights";
import { outcomeDots } from "@/components/builds/Outcome";
import { cn } from "@/lib/cn";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const total = (bar: MonthBar) => bar.success + bar.partial + bar.failed;

/** "March: 14 prints, 10 worked, 1 partly, 3 spaghetti". */
export function monthSentence(bar: MonthBar): string {
  const parts = OUTCOMES.filter((outcome) => bar[outcome] > 0).map(
    (outcome) => `${bar[outcome]} ${OUTCOME_LABELS[outcome].toLowerCase()}`,
  );
  return `${MONTHS[bar.month]}: ${total(bar)} ${total(bar) === 1 ? "print" : "prints"}${parts.length ? `, ${parts.join(", ")}` : ""}`;
}

interface MonthBarsProps {
  months: MonthBar[];
  /** The month the year has reached: later ones are drawn as faint ticks, not zero-height bars. */
  through?: number;
  className?: string;
}

/**
 * Prints by month as quiet stacked bars in the outcome colors (worked at the
 * bottom, spaghetti on top). No legend and no axis: the busiest month names
 * each month its count above its bar, and the figures under it say it all in words for
 * screen readers. Not interactive.
 */
export function MonthBars({ months, through = 11, className }: MonthBarsProps) {
  const peak = Math.max(1, ...months.map(total));
  const busiest = months.reduce(
    (best, bar) => (total(bar) > total(best) ? bar : best),
    months[0] ?? { month: 0, success: 0, partial: 0, failed: 0 },
  );
  return (
    <figure className={cn("m-0", className)}>
      <ul className="m-0 flex h-36 list-none items-end gap-1.5 p-0 md:h-44 md:gap-2.5" aria-label="Prints by month">
        {months.map((bar) => {
          const sum = total(bar);
          const future = bar.month > through;
          return (
            <li key={bar.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
              <span className="sr-only">{monthSentence(bar)}</span>
              {sum > 0 && (
                <span
                  className={cn(
                    "text-caption tabular",
                    bar === busiest ? "text-ink-soft font-semibold" : "text-ink-faint",
                  )}
                  aria-hidden
                >
                  {sum}
                </span>
              )}
              <span
                aria-hidden
                className={cn(
                  "flex w-full max-w-9 flex-col-reverse overflow-hidden rounded-t-md md:max-w-14",
                  sum === 0 && "bg-ink/6 h-1 rounded-md",
                  future && "opacity-50",
                )}
                style={sum > 0 ? { height: `${Math.max(6, (sum / peak) * 100)}%` } : undefined}
              >
                {OUTCOMES.map(
                  (outcome) =>
                    bar[outcome] > 0 && (
                      <span key={outcome} className={outcomeDots[outcome]} style={{ flexGrow: bar[outcome] }} />
                    ),
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="text-caption text-ink-faint mt-2 flex gap-1.5 md:gap-2.5" aria-hidden>
        {months.map((bar) => (
          <span key={bar.month} className="min-w-0 flex-1 text-center">
            {MONTHS[bar.month]}
          </span>
        ))}
      </div>
    </figure>
  );
}
