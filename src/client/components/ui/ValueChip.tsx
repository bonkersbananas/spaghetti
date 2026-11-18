import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { EditIcon } from "./icons";

// Its own file (with Chip's base look repeated): Chip is in every screen's first load, and this is only in the attempt sheet.
const base = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-small font-semibold md:h-6";

interface ValueChipProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** What it is and its value, as the chip says it: "Nozzle 240 °C", "0.20 mm layers". */
  children: ReactNode;
  /** Its field is open under the row: a ring, not the picked chip's ink fill (it isn't a choice made). */
  open?: boolean;
  /** The value differs from where it started: said on semolina, as everything that changed is. */
  changed?: boolean;
}

/**
 * A setting shown as an editable value (the attempt sheet's carried-over settings): its words and a small pencil, so it
 * reads as something to change rather than a tag to tick. Tapping it opens the field for it; `open` rings it while it is.
 */
export function ValueChip({ open, changed, children, className, ...props }: ValueChipProps) {
  return (
    <button
      type="button"
      aria-expanded={open}
      className={cn(
        base,
        "pressable focus-ring touch-target relative h-9 gap-1.5 pr-2.5 pl-3.5 md:h-8",
        changed ? "bg-semolina-soft text-semolina-ink" : "bg-cream text-ink-soft shadow-soft hover:text-ink",
        open && "ring-ink/40 ring-2",
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      <EditIcon size={13} weight="bold" className="shrink-0 opacity-60" aria-hidden />
    </button>
  );
}
