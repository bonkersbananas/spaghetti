import type { Outcome } from "@shared/attempts";
import { offTheBedLabel } from "@shared/print-progress";
import { fullTime, relativeTime } from "@shared/time";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui/Button";
import { NextIcon, PreviousIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import type { ItemView } from "@/lib/items";
import { duration, ease } from "@/lib/motion";
import { EditAttempt } from "./attempt-sheet/EditAttempt";
import { LogAttempt } from "./attempt-sheet/LogAttempt";

interface AttemptSheetProps {
  item: ItemView;
  /** Edit (or finish) this attempt; without one, log a new attempt. */
  attemptId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open with the failure tags or the settings already showing. */
  initialOutcome?: Outcome | null;
  /** A slicer file dropped on the build or the attempt: read it into the sheet. */
  incomingFile?: { file: File; key: number } | null;
  /** Steps the open attempt to the one before or after it (the header's arrows); without it there are none. */
  onStep?: (attemptId: string) => void;
}

/**
 * Logging an attempt, standing next to the printer: the outcome is one tap,
 * the time is now, and everything else (photos, a line, tags, settings) is
 * one more tap away. A bottom sheet on phones, a side panel on desktop.
 *
 * This file only chooses between the two modes; the parts live in `attempt-sheet/`:
 * `LogAttempt` (a new attempt, with a draft that survives closing), `EditAttempt`
 * (an existing one, autosaved, and finishing a print), `AttemptFields` (the fields
 * both share), `WhenField`, and `SheetSlicerFile` (reading a .3mf into the sheet).
 */
export function AttemptSheet({
  item,
  attemptId,
  open,
  onOpenChange,
  initialOutcome,
  incomingFile,
  onStep,
}: AttemptSheetProps) {
  const attempt = attemptId ? item.attempts.find((a) => a.id === attemptId) : undefined;
  // The attempt was deleted (here or elsewhere) while open.
  useEffect(() => {
    if (open && attemptId && !attempt) onOpenChange(false);
  }, [open, attemptId, attempt, onOpenChange]);
  const reduce = useReducedMotion();
  // The sheet's frame (title, arrows, footer) stays put when stepping; only what is inside it changes.
  const [footerHost, setFooterHost] = useState<HTMLElement | null>(null);
  if (attemptId) {
    if (!attempt) return null;
    const printing = attempt.outcome === null;
    const index = item.attempts.findIndex((a) => a.id === attempt.id);
    const before = item.attempts[index - 1];
    const after = item.attempts[index + 1];
    return (
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        desktop="panel"
        title={printing ? `Finish attempt ${attempt.number}` : `Attempt ${attempt.number}`}
        description={
          <time dateTime={new Date(attempt.printedAt).toISOString()} title={fullTime(attempt.printedAt)}>
            {printing ? "Started printing " : "Printed "}
            {relativeTime(attempt.printedAt).toLowerCase()}
            {printing && attempt.endedAt !== null && <> · {offTheBedLabel(attempt.endedAt).toLowerCase()}</>}
          </time>
        }
        headerActions={
          onStep &&
          item.attempts.length > 1 && (
            <>
              <IconButton
                icon={PreviousIcon}
                label="Previous attempt"
                size="sm"
                disabled={!before}
                onClick={() => before && onStep(before.id)}
              />
              <IconButton
                icon={NextIcon}
                label="Next attempt"
                size="sm"
                disabled={!after}
                onClick={() => after && onStep(after.id)}
              />
            </>
          )
        }
        footer={<div ref={setFooterHost} className="contents" />}
      >
        {/* Crossfades between attempts over duration.fast (half out, half in; none with reduced motion). The
            one leaving saves what was typed as it goes: autosave makes stepping away mid-edit safe. */}
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={attempt.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : duration.fast / 2, ease: ease.out }}
          >
            {/* A finish queued on this device remounts it, so it starts again from the finished attempt rather than autosaving its draft. */}
            <EditAttempt
              key={`${attempt.id}${attempt.finishQueued ? ":queued" : ""}`}
              item={item}
              attempt={attempt}
              open={open}
              onOpenChange={onOpenChange}
              initialOutcome={initialOutcome}
              incomingFile={incomingFile}
              footerHost={footerHost}
            />
          </m.div>
        </AnimatePresence>
      </Sheet>
    );
  }
  return (
    <LogAttempt
      item={item}
      open={open}
      onOpenChange={onOpenChange}
      initialOutcome={initialOutcome}
      incomingFile={incomingFile}
    />
  );
}
