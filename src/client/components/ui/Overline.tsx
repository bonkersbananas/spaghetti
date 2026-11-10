import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface OverlineProps {
  /** The heading level it stands for, or a plain span (a label inside a control). */
  as?: "h2" | "h3" | "span";
  /** A count after the label, in tabular figures: "Attempts 3". */
  count?: number;
  /** "basil" for a quiet success caption ("What worked"). */
  tone?: "faint" | "basil";
  id?: string;
  className?: string;
  children: ReactNode;
}

/**
 * The small uppercase caption over a group: "November so far", "Attempts 3",
 * "Workshop". Always in Figtree (never the display face), aligned with the
 * content under it: no padding of its own.
 */
export function Overline({ as: Tag = "span", count, tone = "faint", id, className, children }: OverlineProps) {
  return (
    <Tag
      id={id}
      className={cn(
        "text-caption font-sans font-semibold tracking-wider uppercase",
        tone === "basil" ? "text-basil-ink" : "text-ink-faint",
        className,
      )}
    >
      {children}
      {count !== undefined && <span className="tabular ml-1.5">{count}</span>}
    </Tag>
  );
}
