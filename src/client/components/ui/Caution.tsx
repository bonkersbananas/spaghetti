import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { SlicerFileIcon, WarningIcon } from "./icons";

/**
 * A gentle note beside a field: "The bed tops out at 120 °C." One line in
 * semolina, never a dialog, never blocking. Errors are tomato; this is advice.
 */
export function Caution({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-small text-semolina-ink flex items-start gap-1.5 px-0.5", className)}>
      <WarningIcon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Marks a value that came from a slicer file (and still matches it). Editing the value takes the mark away. */
export function FromFileMark({ className }: { className?: string }) {
  return (
    <span className={cn("text-semolina-ink inline-flex shrink-0 items-center", className)} title="From the slicer file">
      <SlicerFileIcon size={14} weight="fill" aria-hidden />
      <span className="sr-only">(from the file)</span>
    </span>
  );
}
