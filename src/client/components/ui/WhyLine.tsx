import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Icon } from "./icons";

interface WhyLineProps {
  /** The small glyph that says who did it: the printer for a print it placed, the move arrow for a move. */
  icon: Icon;
  children: ReactNode;
  /** At most one quiet way to change it, at the line's end ("Not this build?"). */
  action?: { label: string; onClick: () => void; disabled?: boolean };
  className?: string;
}

/**
 * Why something is where it is, in one quiet line: a 14 px glyph, `text-small` words in `ink-faint`, and at most one
 * quiet action after them. A print the printer bridge put in a build says its reason this way ("Same file as
 * ring.3mf · Not this build?"), and an attempt moved from another build says where from, as `ClaudeLine` does for
 * what Claude says unasked. It wraps under its glyph; the action never breaks inside.
 */
export function WhyLine({ icon: Glyph, children, action, className }: WhyLineProps) {
  return (
    <p className={cn("text-small text-ink-faint flex items-start gap-1.5", className)}>
      <Glyph size={14} aria-hidden className="mt-0.5 shrink-0 md:mt-px" />
      <span className="min-w-0">
        {children}
        {action && (
          <>
            {" "}
            <span aria-hidden>·</span>{" "}
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className="focus-ring touch-target text-ink-soft hover:text-ink disabled:text-ink-ghost relative inline rounded-xs font-semibold whitespace-nowrap disabled:pointer-events-none"
            >
              {action.label}
            </button>
          </>
        )}
      </span>
    </p>
  );
}
