import { cn } from "@/lib/cn";
import { ArrowRightIcon } from "./icons";
import { MetaList } from "./MetaList";

export interface Change {
  /** What it was: "1 h 12 min". */
  before: string;
  /** What it is now: "48 min". */
  after: string;
  /** What it is, for screen readers: "time", "filament". */
  label: string;
}

/**
 * What a change did, figure by figure: "1 h 12 min → 48 min · 14 g → 11 g", the old figure quiet and the new one in
 * ink. A figure that stayed the same says only itself. Slicing again with other settings (decision 0047) shows it,
 * beside its undo.
 */
export function BeforeAfter({
  changes,
  size = "sm",
  className,
}: {
  changes: readonly Change[];
  /** "md" where it leads a card, in the place of its figures. */
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <MetaList className={cn("tabular", size === "md" ? "text-body" : "text-small", className)}>
      {changes.map(({ before, after, label }) =>
        before === after ? (
          <span key={label} className="text-ink-soft whitespace-nowrap">
            {after}
          </span>
        ) : (
          <span key={label} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className="sr-only">{`${label} was `}</span>
            <span className="text-ink-faint">{before}</span>
            <ArrowRightIcon size={12} weight="bold" className="text-ink-ghost" aria-hidden />
            <span className="sr-only"> now </span>
            <span className="text-ink font-semibold">{after}</span>
          </span>
        ),
      )}
    </MetaList>
  );
}
