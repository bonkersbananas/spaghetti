/**
 * A note-only idea's picture at thumbnail size, where its words would be too small to read: an index card with its
 * rule and a pencil. Fills its parent. On wishlist rows (RankRow) and Up next's slim cards on a phone (MiniCard).
 * The pencil is Phosphor's NotePencil (regular) drawn inline: the icon component would join the Ideas first load.
 */
export function NoteCardThumb({ size }: { size: number }) {
  return (
    <span className="paper-grain bg-note text-ink-faint relative flex size-full items-center justify-center">
      <span className="bg-tomato/25 absolute inset-x-2 top-2.5 h-px md:inset-x-3 md:top-3.5" />
      <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" aria-hidden>
        <path d="M229.66,58.34l-32-32a8,8,0,0,0-11.32,0l-96,96A8,8,0,0,0,88,128v32a8,8,0,0,0,8,8h32a8,8,0,0,0,5.66-2.34l96-96A8,8,0,0,0,229.66,58.34ZM124.69,152H104V131.31l64-64L188.69,88ZM200,76.69,179.31,56,192,43.31,212.69,64ZM224,128v80a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32h80a8,8,0,0,1,0,16H48V208H208V128a8,8,0,0,1,16,0Z" />
      </svg>
    </span>
  );
}
