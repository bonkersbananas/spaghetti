import { linkWords } from "@shared/links";
import { type NoteSize, noteSize } from "@shared/notes";
import { keepUnits } from "@shared/typography";
import { Fragment, type ReactNode, useCallback, useState } from "react";
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
  /** The largest size a short note may take (a card in a grid caps it at "lg": two words needn't shout). */
  maxSize?: NoteSize;
  /** Keeps the bottom corner free for a badge laid over the card (the rank on a picked tile). */
  clearBottom?: boolean;
  /** A tall face: a short note leaves its foot empty, so a loose strand of spaghetti is doodled there. */
  doodle?: boolean;
}

/**
 * How many whole lines a box shows: the clamp that ends a note on a full line with an ellipsis, never through the
 * middle of one. Measured when the box's size is known (before paint) and again whenever it changes.
 */
function useWholeLines() {
  const [lines, setLines] = useState<number>();
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const measure = () => {
      const lh = Number.parseFloat(getComputedStyle(el.firstElementChild ?? el).lineHeight);
      if (lh > 0 && el.clientHeight > 0) setLines(Math.max(1, Math.floor((el.clientHeight + 1) / lh)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);
  return [lines, ref] as const;
}

/** A loose strand of spaghetti on the foot of a short note's index card. */
function Strand() {
  // Laid over the face's foot, so it never takes a line from the note (only a short note gets one: see `doodle`).
  return (
    <svg
      aria-hidden
      viewBox="0 0 72 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      className="stroke-tomato/35 pointer-events-none absolute bottom-[8cqi] left-[8cqi] h-auto w-[26cqi]"
    >
      <path d="M3 16c6-12 12-12 14-3s7 9 11 0 9-11 13-2 8 8 12 0 6-4 11-1" />
    </svg>
  );
}

/**
 * A note in place of a photo: set in Fraunces under one faint rule, like an
 * index card in a kitchen notebook. The type scales with the card's width
 * (container units), so a note wraps the same in a phone's two columns as
 * in the desktop's four; a note too long for its card ends on a whole
 * line with an ellipsis rather than being cut mid-line. A note that is only a link shows
 * what it links to in words ("Skadis pegboard white") over its site, not the
 * address. Fills its parent.
 */
export function NoteFace({ note, size, className, compact, clearBottom, maxSize, doodle }: NoteFaceProps) {
  const [lines, measured] = useWholeLines();
  const link = BARE_LINK.test(note.trim()) ? linkWords(note) : undefined;
  const text = link?.words ?? note;
  const order: NoteSize[] = ["xl", "lg", "md", "sm"];
  const sized = noteSize(text);
  const face = size ?? (maxSize && order.indexOf(sized) < order.indexOf(maxSize) ? maxSize : sized);
  return (
    <div className={cn("paper-grain bg-note @container relative flex size-full flex-col", className)}>
      <div className={cn("p-note-inset flex min-h-0 flex-1 flex-col", clearBottom && "pb-9")}>
        <span aria-hidden className="bg-tomato/25 mb-note-rule h-px w-full shrink-0" />
        {link || compact === true ? (
          <p
            className={cn(
              "font-display text-ink font-normal break-words whitespace-pre-line",
              compact === true ? "text-caption line-clamp-3 leading-snug" : cn(sizes[face], "line-clamp-3"),
            )}
          >
            {keepUnits(text)}
          </p>
        ) : (
          // The box is measured; the note inside it is exactly as many lines tall as fit, so no line shows partly.
          <div ref={measured} className="min-h-0 flex-1 overflow-hidden">
            <p
              style={{
                WebkitLineClamp: lines ?? 3,
                maxHeight: lines ? `${lines}lh` : undefined,
              }}
              className={cn(
                "font-display text-ink line-clamp-3 font-normal break-words whitespace-pre-line",
                compact === "fill" ? miniSizes[face] : sizes[face],
              )}
            >
              {/* A number keeps its unit on the line ("42 mm"); an address may break after its slashes. */}
              {breakAfterSlashes(keepUnits(note))}
            </p>
          </div>
        )}
        {/* Only a note short enough to leave the foot empty: about five lines of the large steps at most. */}
        {doodle && !link && !compact && note.trim().length <= 48 && !/\n\s*\n/.test(note) && <Strand />}
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
