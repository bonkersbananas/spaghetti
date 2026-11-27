import { addressName } from "@shared/item-name";
import { type NoteSize, noteSize } from "@shared/notes";
import { keepUnits } from "@shared/typography";
import { Fragment, type ReactNode, useCallback, useLayoutEffect, useRef } from "react";
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
  compact?: boolean | "fill" | "tile";
  /** The largest size a short note may take (a card in a grid caps it at "lg": two words needn't shout). */
  maxSize?: NoteSize;
  /** Keeps the bottom corner free for a badge laid over the card (the rank on a picked tile). */
  clearBottom?: boolean;
  /** `compact="tile"`: told whether the note had to be cut short to fit, so a picker can add the whole name as a caption. */
  onCut?: (cut: boolean) => void;
  /** A tall face: a short note leaves its foot empty, so a loose strand of spaghetti is doodled there. */
  doodle?: boolean;
  /**
   * What a note that is only a link is called (its page's title, by shared/item-name.ts): said over its site in place
   * of the words in its address, so the face reads as the idea's name does everywhere else.
   */
  linkName?: string;
}

/**
 * The clamp that ends a note on a whole line with an ellipsis, never through the middle of one: the box's height in
 * lines, set in the resize observer's own callback (it runs before the frame is painted, so a resize never shows a
 * frame with the old count). The face's width is watched too: the type is in container units, so a wider face has
 * taller lines in the same box.
 */
function useWholeLines() {
  return useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const note = el.firstElementChild as HTMLElement;
      // A foot under the note in the same box (a link's site) keeps its room: the note ends a line above it.
      const foot = note.nextElementSibling as HTMLElement | null;
      const room = foot ? foot.offsetHeight + Number.parseFloat(getComputedStyle(foot).marginTop) : 0;
      const lines = Math.floor((el.clientHeight + 1 - room) / Number.parseFloat(getComputedStyle(note).lineHeight));
      if (lines > 0) note.style.webkitLineClamp = String(lines);
    });
    // The note too: a note edited into another size step changes its line height, not the box.
    observer.observe(el);
    observer.observe(el.firstElementChild ?? el);
    observer.observe(el.parentElement?.parentElement ?? el);
    return () => observer.disconnect();
  }, []);
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
export function NoteFace({
  note,
  size,
  className,
  compact,
  clearBottom,
  maxSize,
  doodle,
  onCut,
  linkName,
}: NoteFaceProps) {
  const measured = useWholeLines();
  const bare = BARE_LINK.test(note.trim());
  // Its site, as links.ts's shortUrl says it ("printables.com"), read here so the face needs nothing more.
  const site = bare
    ? note
        .trim()
        .replace(/^https?:\/\/(www\.)?/i, "")
        .split("/")[0]
    : undefined;
  // What the link is called by the one rule (shared/item-name.ts): its page's title when given, else its address's words.
  const named =
    linkName ?? (bare ? addressName(/^https?:\/\//i.test(note.trim()) ? note.trim() : `https://${note.trim()}`) : null);
  const link = site && named ? { site, words: named } : undefined;
  const text = link?.words ?? note;
  const order: NoteSize[] = ["xl", "lg", "md", "sm"];
  const sized = noteSize(text);
  const face = size ?? (maxSize && order.indexOf(sized) < order.indexOf(maxSize) ? maxSize : sized);
  return (
    <div className={cn("paper-grain bg-note @container relative flex size-full flex-col", className)}>
      <div
        className={cn(
          "p-note-inset flex min-h-0 flex-1 flex-col",
          clearBottom && (compact === "tile" ? "pb-9" : "pb-12"),
        )}
      >
        <span aria-hidden className="bg-tomato/25 mb-note-rule h-px w-full shrink-0" />
        {compact === "tile" ? (
          <TileText text={keepUnits(text)} onCut={onCut} />
        ) : compact === true ? (
          <p className="font-display text-ink text-caption line-clamp-3 leading-snug font-normal break-words whitespace-pre-line">
            {link ? keepUnits(text) : breakAfterSlashes(keepUnits(note))}
          </p>
        ) : (
          // The box is measured; the note inside it is exactly as many lines tall as fit, so no line shows partly.
          <div ref={measured} className="min-h-0 flex-1 overflow-hidden">
            <p
              className={cn(
                "font-display text-ink line-clamp-3 font-normal break-words whitespace-pre-line",
                compact === "fill" ? miniSizes[face] : sizes[face],
              )}
            >
              {/* A number keeps its unit on the line ("42 mm"); an address may break after its slashes. */}
              {link ? keepUnits(text) : breakAfterSlashes(keepUnits(note))}
            </p>
            {/* A link's site stays right under its name's last line: the measure leaves it room. */}
            {link && <p className="text-caption text-ink-faint mt-1.5 truncate">{link.site}</p>}
          </div>
        )}
        {/* Only a note short enough to leave the foot empty: a title-only idea or a few words: most of the card is empty. */}
        {doodle && !link && !compact && note.trim().length <= 32 && !/\n\s*\n/.test(note) && (
          <span
            aria-hidden
            className="note-strand bg-tomato/25 pointer-events-none absolute bottom-[8cqi] left-[8cqi] aspect-[100/44] w-[34cqi]"
          />
        )}
        {link && compact === "tile" && (
          <p className="text-caption text-ink-faint mt-1.5 shrink-0 truncate max-md:hidden">{link.site}</p>
        )}
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

/**
 * A picker tile's note: one type size whatever the note's length (12 px, 14 from md), and as many whole lines as the
 * face has room for. A note too long ends at a word with an ellipsis and no punctuation in front of it ("bearing…",
 * never "bearing:…"); `onCut` says whether that happened. Measured in a layout effect (and again when the face
 * resizes), so no frame shows the full text.
 */
function TileText({ text, onCut }: { text: string; onCut?: (cut: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLParagraphElement>(null);
  const report = useRef(onCut);
  report.current = onCut;
  useLayoutEffect(() => {
    const el = box.current;
    const p = line.current;
    if (!el || !p) return;
    const fit = () => {
      p.textContent = text;
      let cut = false;
      if (p.scrollHeight > el.clientHeight + 1) {
        cut = true;
        const words = text.split(/\s+/);
        let low = 0;
        let high = words.length - 1;
        const shows = (count: number) =>
          `${words
            .slice(0, count)
            .join(" ")
            .replace(/[\s.,:;!?\-–—(/]+$/, "")}…`;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          p.textContent = shows(mid);
          if (p.scrollHeight > el.clientHeight + 1) high = mid - 1;
          else low = mid;
        }
        p.textContent = shows(low);
      }
      report.current?.(cut);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  return (
    <div ref={box} className="min-h-0 flex-1 overflow-hidden">
      <p
        ref={line}
        className="font-display text-ink text-caption md:text-small leading-snug font-normal break-words whitespace-pre-line"
      />
    </div>
  );
}
