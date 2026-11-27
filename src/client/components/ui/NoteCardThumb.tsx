import { NoteIcon } from "./icons";

/**
 * A note-only idea's picture at thumbnail size, where its words would be too small to read: an index card with its
 * rule and a pencil. Fills its parent. On wishlist rows (RankRow) and Up next's slim cards on a phone (MiniCard).
 */
export function NoteCardThumb({ size }: { size: number }) {
  return (
    <span className="paper-grain bg-note text-ink-faint relative flex size-full items-center justify-center">
      <span className="bg-tomato/25 absolute inset-x-2 top-2.5 h-px md:inset-x-3 md:top-3.5" />
      <NoteIcon size={size} />
    </span>
  );
}
