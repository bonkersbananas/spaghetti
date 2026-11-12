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
  /** For a small tile (a picker's, about 110 px): 12 px type, three lines at most, so no word has to break. */
  compact?: boolean;
  /** Keeps the bottom corner free for a badge laid over the card (the rank on a picked tile). */
  clearBottom?: boolean;
}

/**
 * A note in place of a photo: set in Fraunces under one faint rule, like an
 * index card in a kitchen notebook. The type scales with the card's width
 * (container units), so a note wraps the same in a phone's two columns as
 * in the desktop's four; a note too long for its card fades out at the
 * bottom rather than being cut mid-line. Fills its parent.
 */
export function NoteFace({ note, size, className, compact, clearBottom }: NoteFaceProps) {
  const face = size ?? noteSize(note);
  return (
    <div className={cn("paper-grain bg-note @container relative flex size-full flex-col", className)}>
      <div className={cn("p-note-inset flex min-h-0 flex-1 flex-col", clearBottom && "pb-9")}>
        <span aria-hidden className="bg-tomato/25 mb-note-rule h-px w-full shrink-0" />
        <p
          className={cn(
            "font-display text-ink font-normal break-words whitespace-pre-line",
            compact
              ? "text-caption line-clamp-3 leading-snug"
              : cn("fade-bottom min-h-0 flex-1 overflow-hidden", sizes[face]),
          )}
        >
          {note}
        </p>
      </div>
    </div>
  );
}
