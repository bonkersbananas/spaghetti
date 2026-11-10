import { type NoteSize, noteSize } from "@shared/notes";
import { cn } from "@/lib/cn";

const sizes: Record<NoteSize, string> = {
  xl: "text-note-xl",
  lg: "text-note-lg",
  md: "text-note-md",
  sm: "text-note-sm",
};

interface NoteFaceProps {
  note: string;
  /** Pick a size by hand (the styleguide); otherwise it follows the note's length. */
  size?: NoteSize;
  className?: string;
}

/**
 * A note in place of a photo: set in Fraunces under one faint rule, like an
 * index card in a kitchen notebook. The type scales with the card's width
 * (container units), so a note wraps the same in a phone's two columns as
 * in the desktop's four; a note too long for its card fades out at the
 * bottom rather than being cut mid-line. Fills its parent.
 */
export function NoteFace({ note, size, className }: NoteFaceProps) {
  const face = size ?? noteSize(note);
  return (
    <div className={cn("paper-grain bg-note @container relative flex size-full flex-col", className)}>
      <div className="p-note-inset flex min-h-0 flex-1 flex-col">
        <span aria-hidden className="bg-tomato/25 mb-note-rule h-px w-full shrink-0" />
        <p
          className={cn(
            "fade-bottom font-display text-ink min-h-0 flex-1 overflow-hidden font-normal break-words whitespace-pre-line",
            sizes[face],
          )}
        >
          {note}
        </p>
      </div>
    </div>
  );
}
