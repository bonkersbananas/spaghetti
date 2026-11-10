import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Overline } from "./Overline";

/**
 * A row of chips: on phones it scrolls sideways under the thumb, edge to
 * edge; on desktop it wraps. For filters and suggestions.
 */
export function ChipRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a form fieldset.
    <div
      role="group"
      aria-label={label}
      className={cn(
        "no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 py-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A thin pause between kinds of chips in a ChipRow. */
export function ChipDivider() {
  return <span aria-hidden className="bg-ink/10 mx-1 my-1.5 w-px shrink-0 self-stretch md:hidden" />;
}

/** One kind of filter in a desktop filter column: a quiet caption over its chips. */
export function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a form fieldset.
    <div role="group" aria-label={label} className="flex flex-col gap-2.5">
      <Overline>{label}</Overline>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
