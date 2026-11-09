import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";
import { duration } from "@/lib/motion";
import { CheckIcon, WarningIcon } from "./icons";

export type SaveState = "idle" | "saving" | "saved" | "error";

const labels: Record<Exclude<SaveState, "idle">, string> = {
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved yet, retrying",
};

/**
 * The quiet indicator beside an autosaving field. There is no save button:
 * this tells people their words are safe.
 */
export function SaveStatus({ state, className }: { state: SaveState; className?: string }) {
  return (
    <span className={cn("text-caption inline-flex h-5 items-center font-medium", className)} aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {state !== "idle" && (
          <motion.span
            key={state}
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: duration.fast }}
            className={cn(
              "inline-flex items-center gap-1",
              state === "saved" && "text-basil-ink",
              state === "saving" && "text-ink-faint",
              state === "error" && "text-tomato-ink",
            )}
          >
            {state === "saved" && <CheckIcon size={12} weight="bold" aria-hidden />}
            {state === "error" && <WarningIcon size={12} weight="bold" aria-hidden />}
            {labels[state]}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
