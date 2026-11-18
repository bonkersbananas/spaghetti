import type { RateRow } from "@shared/insights";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface RateRowsProps {
  rows: RateRow[];
  /** Makes a row's label a link (into the journal filtered to it). */
  label?: (row: RateRow) => ReactNode;
  className?: string;
}

/**
 * Success rate per group as a quiet row: the name, a basil bar as long as the
 * share that worked, and the figure in words ("83% · 12 prints") at its end, or under the name when they
 * don't fit side by side. A name stays on one line.
 * Direct labels, no axis. A group with only a few prints says how few.
 */
export function RateRows({ rows, label, className }: RateRowsProps) {
  return (
    <ul className={cn("m-0 flex list-none flex-col gap-3.5 p-0", className)}>
      {rows.map((row) => (
        <li key={row.label} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-body text-ink max-w-full grow truncate font-semibold">
            {label ? label(row) : row.label}
          </span>
          <span aria-hidden className="bg-ink/10 order-3 mt-0.5 h-2 basis-full overflow-hidden rounded-full">
            {row.percent > 0 && (
              <span className="bg-basil block h-full rounded-full" style={{ width: `${Math.max(row.percent, 6)}%` }} />
            )}
          </span>
          <span className="text-small text-ink-soft tabular whitespace-nowrap">
            {row.percent}% worked{" "}
            <span className="text-ink-faint">
              · {row.total} {row.total === 1 ? "print" : "prints"}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
