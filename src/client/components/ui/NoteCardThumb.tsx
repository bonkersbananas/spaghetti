import { type ModelMark, modelLetter } from "@shared/model-mark";
import { cn } from "@/lib/cn";

/**
 * The letter that stands for a note that is only a link, as LinkCard's tile has it: the model's place (M for
 * MakerWorld, STL for a file) or the site's initial. Undefined for a note with words of its own.
 */
export function linkLetter(note: string, model?: ModelMark | null): string | undefined {
  const trimmed = note.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return undefined;
  if (model) return modelLetter(model);
  const host = trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[/?#:]/)[0];
  return host?.charAt(0).toUpperCase() || undefined;
}

/**
 * A note-only idea's picture at thumbnail size, where its words would be too small to read: the note card itself, in
 * miniature (the paper, its faint tomato rule and NoteFace's spaghetti strand), or, for a note that is only a link,
 * LinkCard's letter tile (`letter`, from linkLetter). Fills its parent. On wishlist rows (RankRow) and Up next's slim
 * cards on a phone (MiniCard `slim`).
 */
export function NoteCardThumb({ letter }: { letter?: string }) {
  if (letter) {
    return (
      <span
        className={cn(
          "bg-ink/5 text-ink-soft font-display flex size-full items-center justify-center",
          letter.length > 1 ? "text-small font-semibold" : "text-title",
        )}
      >
        {letter}
      </span>
    );
  }
  return (
    <span className="paper-grain bg-note relative block size-full">
      <span className="bg-tomato/25 absolute inset-x-2 top-2.5 h-px md:inset-x-3 md:top-3.5" />
      {/* NoteFace's strand (the note-strand mask's path), drawn with a stroke that stays fine at any tile size. */}
      <svg
        aria-hidden
        viewBox="0 0 100 44"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-tomato/40 absolute bottom-2 left-2 w-3/5 md:bottom-3 md:left-3"
      >
        <path
          vectorEffect="non-scaling-stroke"
          d="M3 34C14 36 20 24 28 14 34 6 44 8 42 18 40 28 28 32 28 22 28 10 46 4 58 10 70 16 66 32 56 30 48 28 54 14 68 18 80 22 84 34 98 30"
        />
      </svg>
    </span>
  );
}
