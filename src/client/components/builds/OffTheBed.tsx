import type { Outcome } from "@shared/attempts";
import type { PhotoRead } from "@shared/photo-read";
import { offTheBedLabel } from "@shared/print-progress";
import { useRef } from "react";
import { Button } from "@/components/ui/Button";
import { CameraIcon, FinishIcon } from "@/components/ui/icons";
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
  /** Show the tags Claude would add under its reason. Today leaves them for the sheet. */
  withTags?: boolean;
  /**
   * Standing at the printer: a photo of the print, right here (the camera on phones), so Claude can suggest an answer
   * on these same buttons. Shown while the attempt has no photo yet.
   */
  onPhotos?: (files: File[]) => void;
  className?: string;
}

/**
 * A print that finished printing but has no verdict yet: not "printing" and not an alarm, just a calm question.
 * "Off the bed at 10:42 · how did it go?" with the three outcomes right there. The printer can't know whether
 * it worked, so the bridge never answers for us.
 */
export function OffTheBed({ endedAt, onPick, photoRead, withTags = true, onPhotos, className }: OffTheBedProps) {
  // Its own small input rather than PhotoTiles' picker: the question shows on screens (search, journal) that
  // otherwise carry none of the photo tiles' code.
  const cameraRef = useRef<HTMLInputElement>(null);
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {/* The sentence keeps its line; on a narrow card the Photo button goes under it instead of squeezing it. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-small text-ink-soft flex items-center gap-2">
          <FinishIcon size={16} className="text-ink-faint shrink-0" aria-hidden />
          <span>
            <span className="text-ink font-semibold">{offTheBedLabel(endedAt)}</span> · how did it go?
          </span>
        </p>
        {onPhotos && !photoRead && (
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={CameraIcon}
              onClick={() => cameraRef.current?.click()}
              className="shrink-0"
            >
              Take photo
            </Button>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              data-testid="camera-input"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (files.length) onPhotos(files);
              }}
            />
          </>
        )}
      </div>
      {onPick && <OutcomePicker value={null} onChange={onPick} size="md" suggested={photoRead?.outcome ?? null} />}
      {photoRead && <PhotoReadNote read={photoRead} withTags={withTags} />}
    </div>
  );
}
