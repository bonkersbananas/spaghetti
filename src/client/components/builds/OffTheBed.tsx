import type { Outcome } from "@shared/attempts";
import type { PhotoRead } from "@shared/photo-read";
import { offTheBedLabel } from "@shared/print-progress";
import { type ReactNode, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { CameraIcon, FinishIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/cn";
import { takePicked } from "@/lib/picked";
import { OutcomePicker } from "./Outcome";
import { PhotoReadNote } from "./PhotoReadNote";

interface OffTheBedProps {
  /** When the printer says the print stopped, epoch ms. */
  endedAt: number;
  /** Picking one finishes the attempt (the sheet opens with it chosen). Without it, only the sentence shows. */
  onPick?: (outcome: Outcome) => void;
  /** What Claude made of the print's photo: a gentle hint on the matching button, never picked for anyone. */
  photoRead?: PhotoRead | null;
  /** The outcome just tapped, shown picked while its sheet opens (a card that leads to the build page). */
  picked?: Outcome | null;
  /** Show the tags Claude would add under its reason. Today leaves them for the sheet. */
  withTags?: boolean;
  /**
   * Standing at the printer: a photo of the print, right here (the camera on phones), so Claude can suggest an answer
   * on these same buttons. Shown while the attempt has no photo yet.
   */
  onPhotos?: (files: File[]) => void;
  /** A camera button of the caller's own (the card's "Snap this print"), beside the sentence; it replaces "Take photo". */
  snap?: ReactNode;
  /**
   * Phones: the sentence is only when it came off the bed, on one line, and Claude's reason is one line too: a card in
   * Now's sideways row, as tall as the cards beside it. The three answers still ask how it went (their group's name).
   */
  brief?: boolean;
  /** The keys that open the attempt's sheet from the page ("A" on a build), shown after the question on desktop. */
  shortcut?: string[];
  className?: string;
}

/**
 * A print that finished printing but has no verdict yet: not "printing" and not an alarm, just a calm question.
 * "Off the bed at 10:42 · how did it go?" with the three outcomes right there. The printer can't know whether
 * it worked, so the bridge never answers for us.
 */
export function OffTheBed({
  endedAt,
  onPick,
  picked = null,
  photoRead,
  withTags = true,
  onPhotos,
  snap,
  brief = false,
  shortcut,
  className,
}: OffTheBedProps) {
  // Its own small input rather than PhotoTiles' picker: the question shows on screens (search, journal) that
  // otherwise carry none of the photo tiles' code.
  const cameraRef = useRef<HTMLInputElement>(null);
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {/* The sentence keeps its line; on a narrow card the Photo button goes under it instead of squeezing it. */}
      <div className={cn("flex justify-between gap-x-3 gap-y-1", snap ? "items-start" : "flex-wrap items-center")}>
        <p className={cn("text-small text-ink-soft flex gap-2", snap ? "min-w-0 flex-1 items-start" : "items-center")}>
          <FinishIcon size={16} className={cn("text-ink-faint shrink-0", !!snap && "mt-0.5")} aria-hidden />
          <span className={cn(brief && "max-md:truncate")}>
            <span className="text-ink font-semibold">{offTheBedLabel(endedAt)}</span>
            <span className={cn(brief && "max-md:hidden")}> · how did it go?</span>
          </span>
          {shortcut && <Kbd keys={shortcut} />}
        </p>
        {snap && <div className="shrink-0">{snap}</div>}
        {onPhotos && !snap && !photoRead && (
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
                void takePicked(event.target).then((files) => {
                  if (files.length) onPhotos(files);
                });
              }}
            />
          </>
        )}
      </div>
      {onPick && (
        <OutcomePicker
          value={picked}
          onChange={(outcome) => {
            onPick(outcome);
          }}
          size="md"
          suggested={photoRead?.outcome ?? null}
        />
      )}
      {photoRead && <PhotoReadNote read={photoRead} withTags={withTags} oneLine={brief} />}
    </div>
  );
}
