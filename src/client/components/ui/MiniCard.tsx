import { hyphenateLongWords } from "@shared/notes";
import { Link, type LinkComponentProps } from "@tanstack/react-router";
import { m } from "motion/react";
import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";
import { ImageIcon } from "./icons";
import { NoteFace } from "./NoteFace";
import { Photo } from "./Photo";
import { useReflow } from "./Reflow";

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
  /** Under the cover when there is no title to show (as on Card): the time. */
  meta?: string;
  /** One quiet line under the title: what happened to it ("worked"). */
  sub?: string;
  /** Fill its cell on a phone (three across a grid) instead of the strip's fixed width. */
  fill?: boolean;
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
  sub,
  fill,
  corner,
  landing,
  id,
  drag,
  meta,
  ref,
  className,
}: MiniCardProps) {
  const heading = title || (photo ? note : undefined);
  return (
    <m.li
      {...useReflow(landing)}
      ref={ref}
      className={cn(
        "group/mini relative shrink-0 snap-start list-none md:w-32 xl:w-44",
        fill ? "w-full" : "w-26",
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
              photo || !note ? "aspect-square xl:aspect-[7/5]" : "min-h-[5.625rem] flex-1",
            )}
          >
            {photo ? (
              <Photo
                src={photo.src}
                alt={photo.alt}
                color={photo.color}
                fit={photo.fit}
                className={cn("size-full", photo.fit === "contain" && "p-2")}
              />
            ) : note ? (
              // Laid over its box, so a long note fills the card's face instead of making the row taller.
              <div className="absolute inset-0">
                <NoteFace note={note} compact="fill" className="pt-7 md:pt-0" />
              </div>
            ) : (
              <div className="bg-well text-ink-ghost flex size-full items-center justify-center">
                <ImageIcon size={24} weight="light" aria-hidden />
              </div>
            )}
          </div>
          {(heading || ((photo || !note) && meta)) && (
            // The padding is on the wrapper: a clamped heading shows its next line in its own padding.
            <div className="px-1 pt-1.5 pb-1">
              {heading ? (
                <h3
                  className={cn(
                    "text-small line-clamp-2 min-h-[2lh] leading-snug break-words",
                    // A note standing in for a title is set as on Card: plain Figtree, not a title.
                    title ? "text-ink font-semibold" : "text-ink font-sans font-medium",
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
