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
 * share that worked, and the figure in words ("83% · 12 prints") at its end.
 * Direct labels, no axis. A group with only a few prints says how few.
 */
export function RateRows({ rows, label, className }: RateRowsProps) {
  return (
    <ul className={cn("m-0 flex list-none flex-col gap-3.5 p-0", className)}>
      {rows.map((row) => (
        <li
          key={row.label}
          className="grid grid-cols-[minmax(4.5rem,8rem)_1fr] items-center gap-x-4 gap-y-1.5 md:grid-cols-[10rem_1fr_9rem]"
        >
          <span className="text-body text-ink min-w-0 truncate font-semibold">{label ? label(row) : row.label}</span>
          <span
            aria-hidden
            className="bg-ink/6 order-3 col-span-2 h-2 overflow-hidden rounded-full md:order-none md:col-span-1"
          >
            <span className="bg-basil block h-full rounded-full" style={{ width: `${Math.max(row.percent, 3)}%` }} />
          </span>
          <span className="text-small text-ink-soft tabular justify-self-end text-right md:justify-self-start">
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
