import type { Outcome } from "@shared/attempts";
import type { PhotoRead } from "@shared/photo-read";
import { offTheBedLabel } from "@shared/print-progress";
import { FinishIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { OutcomePicker } from "./Outcome";
import { PhotoReadNote } from "./PhotoReadNote";

interface OffTheBedProps {
  /** When the printer says the print stopped, epoch ms. */
  endedAt: number;
  /** Picking one finishes the attempt (the sheet opens with it chosen). Without it, only the sentence shows. */
  onPick?: (outcome: Outcome) => void;
  /** What Claude made of the print's photo: a gentle hint on the matching button, never picked for anyone. */
  photoRead?: PhotoRead | null;
  className?: string;
}

/**
 * A print that finished printing but has no verdict yet: not "printing" and not an alarm, just a calm question.
 * "Off the bed at 10:42 · how did it go?" with the three outcomes right there. The printer can't know whether
 * it worked, so the bridge never answers for us.
 */
export function OffTheBed({ endedAt, onPick, photoRead, className }: OffTheBedProps) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <p className="text-small text-ink-soft flex items-center gap-2">
        <FinishIcon size={16} className="text-ink-faint shrink-0" aria-hidden />
        <span>
          <span className="text-ink font-semibold">{offTheBedLabel(endedAt)}</span> · how did it go?
        </span>
      </p>
      {onPick && <OutcomePicker value={null} onChange={onPick} size="md" suggested={photoRead?.outcome ?? null} />}
      {photoRead?.status === "read" && <PhotoReadNote read={photoRead} />}
    </div>
  );
}
