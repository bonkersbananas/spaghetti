import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A quiet filter in words, for a section heading's side (Ideas' "Has a model", "Needs designing"): the label and its
 * count, nothing around them, so the words line up with the edge of what is under them. Picked, the label turns ink
 * on a semolina stroke, like a word underlined in the notebook. One tap filters, a second shows everything again.
 * Put a few in a `TextToggles`.
 */
export function TextToggle({
  selected,
  count,
  children,
  className,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "children"> & { selected: boolean; count?: number; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "pressable focus-ring touch-target text-small duration-fast relative inline-flex h-7 shrink-0 items-center gap-1 rounded-xs font-semibold whitespace-nowrap transition-colors md:h-6",
        selected ? "text-ink" : "text-ink-soft hover:text-ink",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "decoration-2 underline-offset-4",
          selected ? "decoration-semolina underline" : "decoration-transparent",
        )}
      >
        {children}
      </span>
      {count !== undefined && <span className="tabular text-ink-faint font-medium">{count}</span>}
    </button>
  );
}

/** A few `TextToggle`s side by side. */
export function TextToggles({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a form fieldset.
    <div role="group" aria-label={label} className={cn("flex flex-wrap items-center gap-x-4", className)}>
      {children}
    </div>
  );
}
