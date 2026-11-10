import type { Outcome } from "@shared/attempts";
import { useEffect } from "react";
import type { ItemView } from "@/lib/items";
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
export function AttemptSheet({ item, attemptId, open, onOpenChange, initialOutcome, incomingFile }: AttemptSheetProps) {
  const attempt = attemptId ? item.attempts.find((a) => a.id === attemptId) : undefined;
  // The attempt was deleted (here or elsewhere) while open.
  useEffect(() => {
    if (open && attemptId && !attempt) onOpenChange(false);
  }, [open, attemptId, attempt, onOpenChange]);
  if (attemptId) {
    return attempt ? (
      // A finish queued on this device remounts it, so it starts again from the finished attempt rather than autosaving its draft.
      <EditAttempt
        key={`${attempt.id}${attempt.finishQueued ? ":queued" : ""}`}
        item={item}
        attempt={attempt}
        open={open}
        onOpenChange={onOpenChange}
        incomingFile={incomingFile}
        initialOutcome={initialOutcome}
      />
    ) : null;
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
