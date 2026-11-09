import { Children, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface MetaListProps {
  /** The pieces, in order: "Black PLA", "0.20 mm", "bed 60 °C". Empty ones are skipped. */
  children: ReactNode;
  className?: string;
  /** Classes for the dots between pieces. */
  separatorClassName?: string;
}

/**
 * A line of short pieces with a dot between them ("Black PLA · 0.20 mm ·
 * Textured PEI") that wraps cleanly: a dot never begins or ends a line.
 *
 * Each piece carries its dot on its left, in a gutter the row hangs into;
 * the frame clips that gutter, so the dot of a piece that starts a line is
 * cut away, and nothing trails at the end of the line before.
 */
export function MetaList({ children, className, separatorClassName }: MetaListProps) {
  const items = Children.toArray(children).filter((child) => child !== "" && child !== null);
  if (!items.length) return null;
  return (
    <span className={cn("block min-w-0 overflow-hidden", className)}>
      <span className="-ml-4 flex flex-wrap items-center gap-y-1">
        {items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the pieces are a fixed list for this render.
          <span key={index} className="relative flex max-w-full min-w-0 items-center pl-4">
            <span aria-hidden className={cn("text-ink-ghost absolute left-0 w-4 text-center", separatorClassName)}>
              ·
            </span>
            {item}
          </span>
        ))}
      </span>
    </span>
  );
}
