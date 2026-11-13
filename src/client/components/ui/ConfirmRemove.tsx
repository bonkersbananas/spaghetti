import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { CloseIcon, TrashIcon } from "./icons";

/** How long the pill waits for the second tap before it turns back into the X. */
export const CONFIRM_REMOVE_MS = 3000;

interface ConfirmRemoveProps {
  /** What goes, for screen readers: "photo 2", "this photo". */
  what: string;
  onRemove: () => void;
  /** "md" on a big photo, "sm" on a thumbnail. */
  size?: "md" | "sm";
  /** Positions it on the photo (absolute, a corner) and adds what only its place needs. */
  className?: string;
}

/**
 * Removes a saved photo in two taps, in place: the round X turns into a "Remove" pill where it sits, and the second
 * tap removes (the Undo toast still follows). It turns back into the X after three seconds, on a tap anywhere else
 * and on Escape. No dialog. It is for photos that are saved; a draft's X (not yet saved) removes at once.
 * Give it a `key` that changes with the photo it is on, so swiping to another photo starts it afresh.
 */
export function ConfirmRemove({ what, onRemove, size = "md", className }: ConfirmRemoveProps) {
  const [asking, setAsking] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => setAsking(false), CONFIRM_REMOVE_MS);
    const away = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setAsking(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Only cancels the question: the screen's own Escape (back) must not also fire.
      event.stopPropagation();
      setAsking(false);
    };
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", onEscape, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", onEscape, true);
    };
  }, [asking]);

  const small = size === "sm";
  return (
    <span ref={root} className={cn("flex justify-end", className)}>
      <button
        type="button"
        data-confirming={asking || undefined}
        onClick={() => {
          if (!asking) return setAsking(true);
          setAsking(false);
          onRemove();
        }}
        onBlur={(event) => {
          if (!root.current?.contains(event.relatedTarget as Node)) setAsking(false);
        }}
        aria-label={asking ? `Remove ${what}? Press again to remove` : `Remove ${what}`}
        title={asking ? "Press again to remove" : "Remove"}
        className={cn(
          "pressable focus-ring touch-target bg-veil text-on-veil shadow-raised flex items-center justify-center overflow-hidden rounded-full backdrop-blur-md",
          small ? "h-7" : "h-8",
          asking
            ? small
              ? "text-small gap-1 px-2 font-medium"
              : "text-small gap-1.5 px-3 font-medium"
            : small
              ? "w-7"
              : "w-8",
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {asking ? (
            <motion.span
              key="ask"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className={cn("flex items-center", small ? "gap-1" : "gap-1.5")}
            >
              <TrashIcon size={14} weight="bold" aria-hidden />
              Remove
            </motion.span>
          ) : (
            <motion.span
              key="x"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="flex"
            >
              <CloseIcon size={small ? 14 : 16} weight="bold" aria-hidden />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <span role="status" className="sr-only">
        {asking ? `Tap again to remove ${what}. Escape cancels.` : ""}
      </span>
    </span>
  );
}
