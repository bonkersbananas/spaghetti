import { cn } from "@/lib/cn";

/**
 * How far through its interval a task is: a thin bar that fills toward the next time it is due. It stays
 * basil while there is time and turns semolina once due: a fact, not an alarm.
 */
export function UpkeepMeter({
  fraction,
  label,
  className,
}: {
  /** 0 at "just done", 1 when due; more than 1 is shown full. */
  fraction: number;
  /** What it says in words, for screen readers: "12 of 20 print hours". */
  label: string;
  className?: string;
}) {
  const filled = Math.min(1, Math.max(0, fraction));
  return (
    <span
      role="meter"
      aria-label="Time since it was done"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(filled * 100)}
      aria-valuetext={label}
      className={cn("bg-ink/8 block h-1.5 w-full overflow-hidden rounded-full", className)}
    >
      <span
        className={cn(
          "duration-base block h-full rounded-full transition-[width] ease-out",
          fraction >= 1 ? "bg-semolina" : "bg-basil",
        )}
        style={{ width: `${Math.max(filled * 100, filled > 0 ? 4 : 0)}%` }} // design-lint-ignore: a share of the bar is data
      />
    </span>
  );
}
