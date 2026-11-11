import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { SparkleIcon } from "./icons";

interface ClaudeLineProps {
  children: ReactNode;
  /** While Claude is working: the sparkle pulses (a pulse, never a spinner) and the line is a status. */
  working?: boolean;
  className?: string;
}

/**
 * A quiet line that says Claude made it: a small sparkle, then plain `text-small` words in `ink-faint`. Every place
 * Claude speaks without being asked (reading a model page, looking at a photo, thinking about the next try, "Drafted
 * by Claude") starts like this, so the marks read as one family.
 */
export function ClaudeLine({ children, working = false, className }: ClaudeLineProps) {
  return (
    <p
      className={cn("text-small text-ink-faint flex items-center gap-1.5", className)}
      role={working ? "status" : undefined}
    >
      <SparkleIcon size={14} weight="fill" aria-hidden className={cn("shrink-0", working && "sg-pulse")} />
      {children}
    </p>
  );
}
