import { Link, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { IdeasIcon, NoteIcon } from "./icons";
import { MetaList } from "./MetaList";
import { Photo } from "./Photo";

interface RankRowProps {
  /** 1 is the top. */
  rank: number;
  /** The picture: a photo, else the note on a small index card, else the idea glyph. */
  photo?: { src: string; color?: string };
  note?: string;
  title: string;
  /** Short pieces for the line under the name ("for Mila", "2 days ago"), wrapped by MetaList. */
  meta?: string[];
  link: LinkProps;
  /** Buttons at the end of the row (Start building). */
  actions?: ReactNode;
  /** The DragHandle, last, under the thumb on phones. */
  handle?: ReactNode;
  /** Picked up and moving. */
  lifted?: boolean;
  className?: string;
}

/**
 * One place in a ranked list (a wishlist): the place as a Fraunces numeral, the picture (a note-only idea
 * shows a small index card with a pencil: its words would be too small), the name and a meta line as one link, then the row's actions and its drag handle. The top place wears a small semolina
 * medal. A lifted row floats on `shadow-float` while it moves.
 */
export function RankRow({ rank, photo, note, title, meta, link, actions, handle, lifted, className }: RankRowProps) {
  return (
    <div
      data-lifted={lifted || undefined}
      className={cn(
        "bg-cream duration-fast flex items-center gap-1 rounded-lg p-2 pr-1 transition-shadow md:gap-2 md:p-2.5 md:pr-1.5",
        lifted ? "shadow-float" : "shadow-soft",
        className,
      )}
    >
      <Link
        {...link}
        draggable={false}
        className="pressable focus-ring group/rank flex min-w-0 flex-1 items-center gap-3 rounded-md md:gap-4"
      >
        <RankMark rank={rank} />
        <span
          className="bg-well relative size-14 shrink-0 overflow-hidden rounded-md select-none md:size-20 lg:size-24"
          aria-hidden
        >
          {photo ? (
            <Photo
              src={photo.src}
              alt=""
              color={photo.color}
              className="size-full"
              imgClassName="pointer-events-none"
            />
          ) : note ? (
            // Too small for the note's words: an index card with its rule and a pencil says "a note" instead.
            <NoteCardThumb size={22} />
          ) : (
            <span className="text-ink-faint flex size-full items-center justify-center">
              <IdeasIcon size={22} />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
          <span className="text-body text-ink group-hover/rank:decoration-ink/20 line-clamp-2 font-semibold break-words group-hover/rank:underline group-hover/rank:underline-offset-4">
            {title}
          </span>
          {meta && meta.length > 0 && (
            <MetaList className="text-small text-ink-faint">
              {meta.map((piece) => (
                <span key={piece}>{piece}</span>
              ))}
            </MetaList>
          )}
        </span>
      </Link>
      {actions}
      {handle}
    </div>
  );
}

/**
 * The place: a numeral, the first one on a semolina medal (`row`), or a small dark disc over a photo
 * (`badge`, a picked tile).
 */
export function RankMark({
  rank,
  tone = "row",
  className,
}: {
  rank: number;
  tone?: "row" | "badge";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-display tabular flex shrink-0 items-center justify-center rounded-full font-medium",
        tone === "badge"
          ? "bg-select text-on-select text-body shadow-raised size-7"
          : cn("text-title size-8", rank === 1 ? "bg-semolina-soft text-semolina-ink" : "text-ink-faint"),
        className,
      )}
    >
      {rank}
    </span>
  );
}

/** A note-only idea's picture at thumbnail size: an index card with its rule and a pencil. Fills its parent. */
function NoteCardThumb({ size }: { size: number }) {
  return (
    <span className="paper-grain bg-note text-ink-faint relative flex size-full items-center justify-center">
      <span className="bg-tomato/25 absolute inset-x-2 top-2.5 h-px md:inset-x-3 md:top-3.5" />
      <NoteIcon size={size} />
    </span>
  );
}

interface PickTileProps {
  photo?: { src: string; color?: string };
  note?: string;
  title: string;
  /** Its place on the list when picked; null when it isn't on it. */
  rank: number | null;
  onToggle: () => void;
  disabled?: boolean;
}

/**
 * An idea to pick for a list, photo first: a square tile with the name under it. Picked, it wears its place
 * (the RankMark) over the photo's corner and a semolina ring. It is a toggle button (`aria-pressed`).
 */
export function PickTile({ photo, note, title, rank, onToggle, disabled }: PickTileProps) {
  const picked = rank !== null;
  return (
    <button
      type="button"
      aria-pressed={picked}
      disabled={disabled}
      onClick={onToggle}
      className="pressable focus-ring group/pick flex min-w-0 flex-col gap-1.5 rounded-lg text-left"
    >
      <span
        className={cn(
          "bg-well duration-fast relative aspect-square w-full overflow-hidden rounded-lg transition-shadow",
          picked ? "ring-semolina ring-offset-lifted ring-3 ring-offset-2" : "shadow-well",
        )}
      >
        {photo ? (
          <Photo src={photo.src} alt="" color={photo.color} className="size-full" />
        ) : note ? (
          // A tile is too small for the note's words (they broke mid-word under the badge): the index card
          // and pencil, as on a list row. The words are the name under the tile.
          <NoteCardThumb size={28} />
        ) : (
          <span className="text-ink-faint flex size-full items-center justify-center">
            <IdeasIcon size={28} />
          </span>
        )}
        {picked && <RankMark rank={rank} tone="badge" className="absolute right-1.5 bottom-1.5" />}
      </span>
      <span className={cn("text-small line-clamp-2 break-words", picked ? "text-ink font-semibold" : "text-ink-soft")}>
        {title}
      </span>
    </button>
  );
}

/** The handle lives in its own file (the shopping list uses it too); wishlists import it from here as before. */
export { DragHandle } from "./DragHandle";
