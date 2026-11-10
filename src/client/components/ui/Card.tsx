import type { Person } from "@shared/api";
import { Link, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { heroClick } from "@/lib/hero";
import { Avatar } from "./Avatar";
import { ImageIcon, SlicerFileIcon } from "./icons";
import { NoteFace } from "./NoteFace";
import { Photo } from "./Photo";

export interface CardProps {
  /** The photo leads. Without one, the note fills its place as a note card. */
  photo?: {
    src: string;
    alt: string;
    color?: string /** The photo's id, so it can travel to the page this opens. */;
    id?: string;
  };
  /** Optional: ideas don't need a title. Falls back to the note. */
  title?: string | null;
  note?: string;
  /** Chips over the photo's bottom edge: status, material. */
  chips?: ReactNode;
  /** Top right of the photo, such as how many photos there are. */
  badge?: ReactNode;
  /** Small line under the title: "2 attempts · 3 days ago". */
  meta?: ReactNode;
  person?: Pick<Person, "name" | "color">;
  /** The agent it was made through: the avatar gets its mark and says "via …". */
  via?: string;
  /** "portrait" (4:5) suits grids of prints; "tall" is 3:4. */
  aspect?: "landscape" | "square" | "portrait" | "tall";
  /** Where the card leads (a TanStack Router link). */
  link?: LinkProps;
  onClick?: () => void;
  /** The card title's heading level: 2 in a grid right under the page title (the inbox), 3 under a section heading. */
  headingLevel?: 2 | 3;
  /** Leaves room at the end of the meta row for a button laid over the card (the idea card's menu). */
  reserveEnd?: boolean;
  className?: string;
}

const aspects = {
  landscape: "aspect-4/3",
  square: "aspect-square",
  portrait: "aspect-4/5",
  tall: "aspect-3/4",
};

/**
 * The photo-first card: prints are physical, so the picture is the content
 * and the text supports it. Without a photo it becomes a quiet note card: the
 * note sits where the photo would, on paper, in the same grid.
 */
export function Card({
  photo,
  title,
  note,
  chips,
  badge,
  meta,
  person,
  via,
  aspect = "landscape",
  link,
  onClick,
  headingLevel = 3,
  reserveEnd,
  className,
}: CardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const noteCard = !photo && !!note;
  // A note card already shows its note; below a photo the note stands in for a title.
  const heading = title || (noteCard ? null : note);
  const rootClass = cn(
    "group bg-cream shadow-soft flex w-full flex-col rounded-lg p-1.5 text-left",
    (onClick || link) && "pressable focus-ring hover:shadow-raised hover:bg-lifted cursor-pointer",
    className,
  );

  const content = (
    <>
      <div className={cn("relative w-full overflow-hidden rounded-md", aspects[aspect])}>
        {photo ? (
          <Photo
            src={photo.src}
            alt={photo.alt}
            color={photo.color}
            className="size-full"
            imgClassName="group-hover:scale-[1.02] transition-[opacity,transform] duration-slow"
          />
        ) : noteCard ? (
          <NoteFace note={note} />
        ) : (
          <div className="bg-well text-ink-ghost flex size-full items-center justify-center">
            <ImageIcon size={32} weight="light" aria-hidden />
          </div>
        )}
        {badge && <div className="absolute top-2 right-2">{badge}</div>}
        {chips && <div className="absolute bottom-2 left-2 flex flex-wrap gap-1.5">{chips}</div>}
      </div>
      <div className="flex flex-1 flex-col px-2 pt-2.5 pb-1.5">
        {heading ? (
          <Heading
            className={cn(
              "text-body text-ink font-semibold break-words",
              // Notes standing in for a title read as text, not as a heading, and get a third line
              // so they aren't cut off mid-thought. Real titles stay at two.
              title ? "line-clamp-2" : "line-clamp-3 font-sans font-medium",
            )}
          >
            {heading}
          </Heading>
        ) : (
          !noteCard &&
          !photo && <Heading className="text-body text-ink-faint font-sans font-medium italic">Untitled</Heading>
        )}
        {/* The title has the whole width; the time, the avatar and (laid over the card) the menu share one row below it. */}
        {(meta || person || reserveEnd) && (
          <div
            className={cn("mt-auto flex min-h-8 items-center gap-1.5", heading && "pt-0.5", reserveEnd && "h-10 pr-9")}
          >
            {meta && <p className="text-small text-ink-faint line-clamp-2 min-w-0 flex-1">{meta}</p>}
            {!meta && <span className="flex-1" />}
            {person && <Avatar person={person} size="xs" via={via} />}
          </div>
        )}
      </div>
    </>
  );

  if (link) {
    return (
      <Link {...link} viewTransition onClick={(event) => heroClick(event, photo?.id)} className={rootClass}>
        {content}
      </Link>
    );
  }
  const Root = onClick ? "button" : "article";
  return (
    <Root type={onClick ? "button" : undefined} onClick={onClick} className={rootClass}>
      {content}
    </Root>
  );
}

/** "3" with a stack icon: an item has more photos than its cover. */
export function PhotoCountBadge({ count }: { count: number }) {
  return (
    <span className="rounded-pill bg-veil text-caption text-on-veil inline-flex h-6 items-center gap-1 px-2 font-semibold backdrop-blur-md">
      <ImageIcon size={13} weight="bold" aria-hidden />
      {count}
      <span className="sr-only">photos</span>
    </span>
  );
}

/** "Slicer preview" with the file glyph: a plate's picture where a photo would be, so nobody takes it for the result. */
export function SlicerPreviewBadge() {
  return (
    <span className="rounded-pill bg-veil text-caption text-on-veil inline-flex h-6 items-center gap-1 px-2 font-semibold backdrop-blur-md">
      <SlicerFileIcon size={13} weight="fill" aria-hidden />
      Slicer preview
    </span>
  );
}
