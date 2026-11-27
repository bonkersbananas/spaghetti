import { hyphenateLongWords } from "@shared/notes";
import { Link, type LinkComponentProps } from "@tanstack/react-router";
import { m } from "motion/react";
import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";
import { ImageIcon } from "./icons";
import { NoteCardThumb } from "./NoteCardThumb";
import { NoteFace } from "./NoteFace";
import { Photo } from "./Photo";
import { useReflow } from "./Reflow";
import { UnreadDot } from "./UnreadDot";

/** Dragging a mini card to another place in its row (desktop, with a mouse). */
export interface MiniDrag {
  dragging: boolean;
  over: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}

interface MiniCardProps {
  /** Where the card leads: a router `Link`'s own props. */
  link: LinkComponentProps<"a">;
  /** The cover only: a mini card never swipes through photos, so a sideways drag on it always belongs to its strip. */
  photo?: { src: string; alt: string; color?: string; fit?: "cover" | "contain" };
  /** Stands in for a missing photo, as a small note face. */
  note?: string;
  title?: string;
  /** The title is a stand-in ("Untitled idea"): set quiet, as on Card. */
  standIn?: boolean;
  /** A note that is only a link: what it is called, on the note face (NoteFace `linkName`). */
  linkName?: string;
  /** Under the cover when there is no title to show (as on Card): the time. */
  meta?: string;
  /** One quiet line under the title: what happened to it ("worked"). */
  sub?: string;
  /**
   * Wider on phones (about 150 px, so a Fraunces title fits a line) with the title on one line and the `sub` straight
   * under it: a strip of builds, not a row of thumbnails (Search's Lately).
   */
  roomy?: boolean;
  /** Fill its cell on a phone (three across a grid) instead of the strip's fixed width. */
  fill?: boolean;
  /**
   * From md as wide as a column of the inbox's grid (three across, four from xl, `gap-5`), the picture 3:2 so the row
   * stays shorter than a full card, and its title in `text-body`: a strip that sits above that grid (Up next on Ideas).
   */
  gridScale?: boolean;
  /**
   * One line instead of a tile (Up next on a phone): a small square cover beside a two-line name, about 3.5 rem tall,
   * so the strip keeps to one slim row and the grid under it starts high. Pass it on phones only.
   */
  slim?: boolean;
  /** The other person wrote here and you haven't read it: one quiet dot on the picture's corner (no count; the page has the thread). */
  unread?: boolean;
  /** Laid over the photo's top-right corner (the card's menu button). A link can't hold a button, so it is a sibling. */
  corner?: ReactNode;
  landing?: boolean;
  /** The id the drag carries (a card dragged out of the page drops as text). */
  id?: string;
  drag?: MiniDrag;
  ref?: Ref<HTMLLIElement>;
  className?: string;
}

/**
 * A small card for a strip: the cover photo, square (from xl a 7:5 box, wider but no taller), with its title (two lines at most) under it, about 7 rem wide.
 * It is the compact sibling of Card, for rows that scroll sideways (Up next on phones) and give way to what is below.
 */
export function MiniCard({
  link,
  photo,
  note,
  title,
  standIn,
  linkName,
  sub,
  roomy,
  fill,
  gridScale,
  slim,
  unread,
  corner,
  landing,
  id,
  drag,
  meta,
  ref,
  className,
}: MiniCardProps) {
  const heading = title || (photo ? note : undefined);
  const reflow = useReflow(landing);
  if (slim) {
    return (
      <SlimCard
        link={link}
        photo={photo}
        name={title || linkName || note || meta || ""}
        look={standIn ? "stand-in" : title ? "title" : "words"}
        unread={unread}
        corner={corner}
        reflow={reflow}
        ref={ref}
        className={className}
      />
    );
  }
  return (
    <m.li
      {...reflow}
      ref={ref}
      className={cn(
        "group/mini relative shrink-0 snap-start list-none",
        gridScale
          ? "md:w-[calc((100%-2.5rem)/3)] xl:w-[calc((100%-3.75rem)/4)]"
          : roomy
            ? "md:w-44"
            : "md:w-32 xl:w-44",
        fill ? "w-full" : roomy ? "w-38" : "w-26",
        className,
      )}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dragging is a mouse extra; the card's menu has Move up and Move down for keyboards and phones. */}
      <div
        draggable={!!drag}
        onDragStart={
          drag
            ? (event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", id ?? "");
                drag.onDragStart();
              }
            : undefined
        }
        onDragEnd={drag?.onDragEnd}
        onDragOver={
          drag
            ? (event) => {
                event.preventDefault();
                drag.onDragOver();
              }
            : undefined
        }
        onDrop={
          drag
            ? (event) => {
                event.preventDefault();
                drag.onDrop();
              }
            : undefined
        }
        className={cn("h-full rounded-lg", drag?.dragging && "opacity-40", drag?.over && "ring-tomato ring-2")}
      >
        <Link
          {...link}
          className="group pressable focus-ring bg-cream shadow-soft hover:bg-lifted flex h-full w-full flex-col rounded-lg p-1"
        >
          <div
            className={cn(
              "relative w-full overflow-hidden rounded-md",
              photo || !note
                ? gridScale
                  ? "aspect-square md:aspect-3/2 md:flex-1"
                  : "aspect-square xl:aspect-[7/5]"
                : gridScale
                  ? "min-h-[5.625rem] flex-1 md:min-h-40"
                  : "min-h-[5.625rem] flex-1",
            )}
          >
            {photo ? (
              <Photo
                src={photo.src}
                alt={photo.alt}
                color={photo.color}
                fit={photo.fit}
                frame={photo.fit === "contain" ? "render" : undefined}
                className={cn("size-full", photo.fit === "contain" && "p-2")}
              />
            ) : note ? (
              // Laid over its box, so a long note fills the card's face instead of making the row taller.
              <div className="absolute inset-0">
                {/* Room for the corner menu where it always shows (touch screens); with a mouse it shows on hover only. */}
                <NoteFace
                  note={note}
                  linkName={linkName}
                  compact="fill"
                  className="pt-7 [@media(hover:hover)_and_(pointer:fine)]:pt-0"
                />
              </div>
            ) : (
              <div className="bg-well text-ink-ghost flex size-full items-center justify-center">
                <ImageIcon size={24} weight="light" aria-hidden />
              </div>
            )}
            {unread && <UnreadDot label="New comment" ring="ring-on-veil" className="absolute top-2 left-2 size-2.5" />}
          </div>
          {(heading || ((photo || !note) && meta)) && (
            // The padding is on the wrapper: a clamped heading shows its next line in its own padding.
            <div className="px-1 pt-1.5 pb-1">
              {heading ? (
                <h3
                  className={cn(
                    "text-small leading-snug break-words",
                    roomy ? "truncate" : "line-clamp-2 min-h-[2lh]",
                    gridScale && "md:text-body md:min-h-0",
                    // A note standing in for a title is set as on Card: plain Figtree, not a title.
                    title && !standIn ? "text-ink font-semibold" : "font-sans font-medium",
                    standIn ? "text-ink-faint" : "text-ink",
                  )}
                >
                  {/* A word too long for the card's line breaks with a hyphen, not mid-word with none. */}
                  {hyphenateLongWords(heading, 10)}
                </h3>
              ) : (
                <p className="text-small text-ink-faint min-h-[2lh] leading-snug">{meta}</p>
              )}
              {sub && heading && <p className="text-small text-ink-faint line-clamp-2 leading-snug">{sub}</p>}
            </div>
          )}
        </Link>
      </div>
      {corner}
    </m.li>
  );
}

/**
 * A mini card on one line: the cover as a 3 rem square (NoteCardThumb where there is no photo),
 * the name beside it on two lines, and room on the right for the card's menu.
 */
function SlimCard({
  link,
  photo,
  name,
  look,
  unread,
  corner,
  reflow,
  ref,
  className,
}: {
  link: LinkComponentProps<"a">;
  photo?: MiniCardProps["photo"];
  name: string;
  /** A title in semibold; a note's own words, or a stand-in ("Untitled idea", quiet), in plain Figtree, as on Card. */
  look: "title" | "words" | "stand-in";
  unread?: boolean;
  corner?: ReactNode;
  reflow: ReturnType<typeof useReflow>;
  ref?: Ref<HTMLLIElement>;
  className?: string;
}) {
  return (
    <m.li {...reflow} ref={ref} className={cn("group/mini relative w-48 shrink-0 snap-start list-none", className)}>
      <Link
        {...link}
        className={cn(
          "group pressable focus-ring bg-cream shadow-soft hover:bg-lifted flex h-14 w-full items-center gap-2.5 rounded-lg p-1",
          corner ? "pr-9" : "pr-3",
        )}
      >
        <span className="relative size-12 shrink-0 overflow-hidden rounded-md">
          {photo ? (
            <Photo
              src={photo.src}
              alt={photo.alt}
              color={photo.color}
              fit={photo.fit}
              frame={photo.fit === "contain" ? "render" : undefined}
              className={cn("size-full", photo.fit === "contain" && "p-1")}
            />
          ) : (
            <span aria-hidden className="block size-full">
              <NoteCardThumb size={18} />
            </span>
          )}
          {unread && <UnreadDot label="New comment" ring="ring-on-veil" className="absolute top-1 left-1 size-2" />}
        </span>
        <h3
          className={cn(
            "text-small line-clamp-2 min-w-0 leading-snug break-words",
            look === "title" ? "text-ink font-semibold" : "font-sans font-medium",
            look === "stand-in" ? "text-ink-faint" : "text-ink",
          )}
        >
          {hyphenateLongWords(name, 10)}
        </h3>
      </Link>
      {corner}
    </m.li>
  );
}
