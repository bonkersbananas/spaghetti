import { Link, type LinkProps } from "@tanstack/react-router";
import type { KeyboardEvent, PointerEvent, ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";
import { DragIcon, IdeasIcon } from "./icons";
import { NoteFace } from "./NoteFace";
import { Photo } from "./Photo";

interface RankRowProps {
  /** 1 is the top. */
  rank: number;
  /** The picture: a photo, else the note on a small index card, else the idea glyph. */
  photo?: { src: string; color?: string };
  note?: string;
  title: string;
  /** A real title (semibold) or the note standing in for one (regular, softer). */
  titled?: boolean;
  meta?: ReactNode;
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
 * One place in a ranked list (a wishlist): the place as a Fraunces numeral, the picture, the name and a
 * meta line as one link, then the row's actions and its drag handle. The top place wears a small semolina
 * medal. A lifted row floats on `shadow-float` while it moves.
 */
export function RankRow({
  rank,
  photo,
  note,
  title,
  titled = true,
  meta,
  link,
  actions,
  handle,
  lifted,
  className,
}: RankRowProps) {
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
          className="bg-well relative size-14 shrink-0 overflow-hidden rounded-md select-none md:size-20"
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
            <NoteFace note={note} size="xl" />
          ) : (
            <span className="text-ink-faint flex size-full items-center justify-center">
              <IdeasIcon size={22} />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
          <span
            className={cn(
              "text-body group-hover/rank:decoration-ink/20 line-clamp-2 break-words group-hover/rank:underline group-hover/rank:underline-offset-4",
              titled ? "text-ink font-semibold" : "text-ink-soft",
            )}
          >
            {title}
          </span>
          {meta && <span className="text-small text-ink-faint truncate">{meta}</span>}
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

interface DragHandleProps {
  /** "Move Tugboat": what it moves. */
  label: string;
  /** Starts a drag (pointer, mouse or touch); the list follows the finger. */
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  /** Arrow keys move it a place up (-1) or down (+1). */
  onMove: (step: -1 | 1) => void;
  /** Delete or Backspace takes it off (with an undo). */
  onRemove?: () => void;
  disabled?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * The grip a row is dragged by: six dots, a 44 px target that doesn't scroll the page under a finger
 * (`touch-none`). With the keyboard, the arrow keys move the row and focus stays on it.
 */
export function DragHandle({ label, onPointerDown, onMove, onRemove, disabled, ref }: DragHandleProps) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      onMove(event.key === "ArrowUp" ? -1 : 1);
    } else if (onRemove && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      event.stopPropagation();
      onRemove();
    }
  }
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-keyshortcuts={onRemove ? "ArrowUp ArrowDown Delete" : "ArrowUp ArrowDown"}
      aria-roledescription="drag handle"
      disabled={disabled}
      onPointerDown={disabled ? undefined : onPointerDown}
      onKeyDown={disabled ? undefined : onKeyDown}
      className="focus-ring text-ink-faint hover:text-ink-soft hover:bg-ink/5 active:bg-ink/8 disabled:text-ink-ghost flex h-14 w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md transition-colors select-none active:cursor-grabbing disabled:cursor-not-allowed md:h-16 md:w-9"
    >
      <DragIcon size={20} weight="bold" aria-hidden />
    </button>
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
          <NoteFace note={note} />
        ) : (
          <span className="text-ink-faint flex size-full items-center justify-center">
            <IdeasIcon size={28} />
          </span>
        )}
        {picked && <RankMark rank={rank} tone="badge" className="absolute top-1.5 left-1.5" />}
      </span>
      <span className={cn("text-small line-clamp-2 break-words", picked ? "text-ink font-semibold" : "text-ink-soft")}>
        {title}
      </span>
    </button>
  );
}
