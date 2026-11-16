import { linkWords } from "@shared/links";
import { type NoteSize, noteSize } from "@shared/notes";
import { keepUnits } from "@shared/typography";
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const sizes: Record<NoteSize, string> = {
  xl: "text-note-xl",
  lg: "text-note-lg",
  md: "text-note-md",
  sm: "text-note-sm",
};

/** The same steps on a mini card's face. */
const miniSizes: Record<NoteSize, string> = {
  xl: "text-note-mini-xl",
  lg: "text-note-mini-lg",
  md: "text-note-mini-md",
  sm: "text-note-mini-sm",
};

/** A note that is one address with a path, with or without its https://www. */
const BARE_LINK = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+\/\S+$/i;

interface NoteFaceProps {
  note: string;
  /** Pick a size by hand (the styleguide); otherwise it follows the note's length. */
  size?: NoteSize;
  className?: string;
  /**
   * For a small tile (a picker's, about 110 px): 12 px type, three lines at most, so no word has to break. `"fill"`:
   * a mini card's whole face (Up next): the note's own size step on the mini scale (12 px on a phone, larger on a
   * desktop's wider card) and as many lines as fit, fading out a whole line before the edge.
   */
  compact?: boolean | "fill";
  /** Keeps the bottom corner free for a badge laid over the card (the rank on a picked tile). */
  clearBottom?: boolean;
}

/**
 * A note in place of a photo: set in Fraunces under one faint rule, like an
 * index card in a kitchen notebook. The type scales with the card's width
 * (container units), so a note wraps the same in a phone's two columns as
 * in the desktop's four; a note too long for its card fades out at the
 * bottom rather than being cut mid-line. A note that is only a link shows
 * what it links to in words ("Skadis pegboard white") over its site, not the
 * address. Fills its parent.
 */
export function NoteFace({ note, size, className, compact, clearBottom }: NoteFaceProps) {
  const link = BARE_LINK.test(note.trim()) ? linkWords(note) : undefined;
  const text = link?.words ?? note;
  const face = size ?? noteSize(text);
  return (
    <div className={cn("paper-grain bg-note @container relative flex size-full flex-col", className)}>
      <div className={cn("p-note-inset flex min-h-0 flex-1 flex-col", clearBottom && "pb-9")}>
        <span aria-hidden className="bg-tomato/25 mb-note-rule h-px w-full shrink-0" />
        <p
          className={cn(
            "font-display text-ink font-normal break-words whitespace-pre-line",
            compact === true
              ? "text-caption line-clamp-3 leading-snug"
              : cn(
                  compact === "fill" ? miniSizes[face] : sizes[face],
                  // A link's few words are clamped whole; a note fills the face and fades out.
                  link
                    ? "line-clamp-3"
                    : cn("min-h-0 flex-1 overflow-hidden", compact === "fill" ? "fade-lines" : "fade-bottom"),
                ),
          )}
        >
          {/* A number keeps its unit on the line ("42 mm"); an address may break after its slashes. */}
          {link ? keepUnits(text) : breakAfterSlashes(keepUnits(note))}
        </p>
        {link && <p className="text-caption text-ink-faint mt-1.5 truncate">{link.site}</p>}
      </div>
    </div>
  );
}

/**
 * An address in a note ("ikea.com/se/en/p/skadis-pegboard") may break after each slash, so it wraps between its
 * parts rather than mid-word: browsers don't break after a slash on their own. The text itself is unchanged.
 */
function breakAfterSlashes(note: string): ReactNode {
  if (!note.includes("/")) return note;
  return note.split("/").map((part, index, parts) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts are a fixed split of this note.
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 && (
        <>
          /<wbr />
        </>
      )}
    </Fragment>
  ));
}
