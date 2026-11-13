import type { Person } from "@shared/api";
import { Link, type LinkProps } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { heroClick } from "@/lib/hero";
import { scrollBehavior } from "@/lib/motion";
import { Avatar } from "./Avatar";
import { CommentIcon, ImageIcon, SlicerFileIcon } from "./icons";
import { NoteFace } from "./NoteFace";
import { Photo } from "./Photo";

// The arrows (and their icons) arrive after the first screen: they only matter once a mouse hovers a card.
const CardArrows = lazy(() => import("./CardArrows").then((m) => ({ default: m.CardArrows })));

export interface CardPhoto {
  src: string;
  alt: string;
  color?: string /** The photo's id, so it can travel to the page this opens. */;
  id?: string;
  /** "contain" for a slicer's plate picture standing in for a photo: the whole model on the well, not cropped. */
  fit?: "cover" | "contain";
}

export interface CardProps {
  /** The photo leads. Without one, the note fills its place as a note card. */
  photo?: CardPhoto;
  /**
   * All of its photos, the first being `photo`: with more than one the picture swipes between them (a finger or a
   * trackpad, arrows on hover with a mouse) and dots say how many there are and which one shows.
   */
  photos?: CardPhoto[];
  /** The photo now showing changed (swiped to, or picked with an arrow). */
  onPhotoChange?: (index: number) => void;
  /** Optional: ideas don't need a title. Falls back to the note. */
  title?: string | null;
  note?: string;
  /** Chips over the photo's bottom edge: status, material. */
  chips?: ReactNode;
  /** Top right of the photo, such as how many photos there are. */
  badge?: ReactNode;
  /** Where a model for the idea lives: the bottom right corner of the photo (ModelMark). */
  mark?: ReactNode;
  /** Comments from the other person you haven't read: a small mark at the top left of the photo. */
  unread?: number;
  /** Small line under the title: "2 attempts · 3 days ago". */
  meta?: ReactNode;
  /** Reactions to it, a quiet line of emoji above the meta row (ReactionGlance). */
  reactions?: ReactNode;
  /** One short line between the title and the meta row, the card's full width ("for the kitchen"): too much for the row, which shares its width with the avatar and the menu. */
  sub?: ReactNode;
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
  photo: cover,
  photos,
  onPhotoChange,
  title,
  note,
  chips,
  badge,
  mark,
  unread,
  meta,
  sub,
  reactions,
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
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const slides = photos && photos.length > 1 ? photos : undefined;
  // The one showing: it travels to the page the card opens.
  const photo = slides?.[index] ?? cover;
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
        {slides ? (
          <div
            ref={scroller}
            // The card doesn't shrink under a press that starts here (pressable): on iOS that would end the swipe.
            data-swipe
            onScroll={(event) => {
              const el = event.currentTarget;
              if (!el.clientWidth) return;
              const next = Math.min(slides.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth)));
              if (next === index) return;
              setIndex(next);
              onPhotoChange?.(next);
            }}
            // A sideways swipe stays in the card: it never pulls the page, or goes back in the browser's history.
            className="flex size-full snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden"
          >
            {slides.map((slide, i) => (
              <Photo
                key={slide.id ?? slide.src}
                src={slide.src}
                // The card's link is named by its first photo; the others would only repeat it.
                alt={i === 0 ? slide.alt : ""}
                color={slide.color}
                // The next one is ready before the finger gets there.
                eager={i <= index + 1}
                className="size-full shrink-0 snap-center snap-always"
                imgClassName="group-hover:scale-[1.02] transition-[opacity,transform] duration-slow"
              />
            ))}
          </div>
        ) : photo ? (
          <Photo
            src={photo.src}
            alt={photo.alt}
            color={photo.color}
            fit={photo.fit}
            className={cn("size-full", photo.fit === "contain" && "p-3")}
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
        {slides && (
          // Over the chips while a photo uploads, so the two never meet.
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 flex justify-center",
              chips ? "bottom-11" : "bottom-2.5",
            )}
          >
            <PhotoDots count={slides.length} index={index} />
          </div>
        )}
        {!!unread && (
          <div className="absolute top-2 left-2">
            <UnreadBadge count={unread} />
          </div>
        )}
        {mark && <div className="absolute right-0 bottom-0 max-w-[70%]">{mark}</div>}
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
        {sub && <p className={cn("text-small text-ink-soft truncate", heading ? "pt-0.5" : "pt-1")}>{sub}</p>}
        {reactions}
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

  const Root = onClick ? "button" : "article";
  const card = link ? (
    <Link
      {...link}
      viewTransition
      onClick={(event) => heroClick(event, photo?.id, slides ? scroller.current?.children[index] : undefined)}
      className={rootClass}
    >
      {content}
    </Link>
  ) : (
    <Root type={onClick ? "button" : undefined} onClick={onClick} className={rootClass}>
      {content}
    </Root>
  );
  if (!slides) return card;

  const go = (to: number) => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: to * el.clientWidth, behavior: scrollBehavior() });
  };
  return (
    <div className={cn("group/photos relative flex", className)}>
      {card}
      {/* Mouse only (a finger swipes, a trackpad scrolls): laid over the photo beside the card's link, not inside it,
        so the link stays one control. Keyboards see every photo on the page the card opens. */}
      <Suspense fallback={null}>
        <CardArrows index={index} count={slides.length} onGo={go} className={aspects[aspect]} />
      </Suspense>
    </div>
  );
}

/** Up to this many dots; more photos slide the row along under a window this wide. */
const MAX_DOTS = 5;
/** A dot and the gap after it (px): `size-1.5` and `gap-1`. */
const DOT_STEP = 10;
/** The one showing is a short bar (`w-3.5`): this much wider than a dot. */
const ACTIVE_EXTRA = 8;

/**
 * Which of several photos shows: a dot for each on a pill of dark glass, the one showing drawn long. With more than
 * five the row slides along under a window of five, and the dots at its edges shrink where more wait beyond them.
 * A picture only: the photos' own labels say "2 of 4".
 */
export function PhotoDots({ count, index, className }: { count: number; index: number; className?: string }) {
  const shown = Math.min(count, MAX_DOTS);
  const start = Math.max(0, Math.min(index - Math.floor(MAX_DOTS / 2), count - MAX_DOTS));
  const end = start + shown - 1;
  return (
    <span
      aria-hidden
      className={cn("rounded-pill bg-veil shadow-soft inline-flex h-4 items-center px-1.5 backdrop-blur-md", className)}
    >
      <span
        className="relative flex h-1.5 overflow-hidden"
        // The window's width follows from the dots it shows: data, not design.
        style={{ width: shown * DOT_STEP - 4 + ACTIVE_EXTRA }} // design-lint-ignore
      >
        <span
          className="duration-base absolute inset-y-0 left-0 flex gap-1 transition-transform ease-out"
          style={{ transform: `translateX(${-start * DOT_STEP}px)` }} // design-lint-ignore
        >
          {Array.from({ length: count }, (_, i) => {
            const edge = (i === start && start > 0) || (i === end && end < count - 1);
            return (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: dots are places, not things.
                key={i}
                className={cn(
                  "rounded-pill duration-base h-1.5 shrink-0 transition-[width,opacity,scale] ease-out",
                  i === index ? "bg-on-veil w-3.5" : "bg-on-veil/50 w-1.5",
                  edge ? "scale-60" : i < start || i > end ? "scale-0" : "scale-100",
                )}
              />
            );
          })}
        </span>
      </span>
    </span>
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

/** "Not a photo" with the file glyph: a plate's picture where a photo would be, so nobody takes it for the result. */
export function SlicerPreviewBadge() {
  return (
    <span className="rounded-pill bg-veil text-caption text-on-veil inline-flex h-6 items-center gap-1 px-2 font-semibold backdrop-blur-md">
      <SlicerFileIcon size={13} weight="fill" aria-hidden />
      Not a photo
    </span>
  );
}

/** "1 new" with a speech bubble: the other person said something here that you haven't read. Tomato, so it is seen across a grid. */
export function UnreadBadge({ count }: { count: number }) {
  return (
    <span className="rounded-pill bg-tomato text-caption text-on-accent shadow-soft inline-flex h-6 items-center gap-1 px-2 font-semibold">
      <CommentIcon size={13} weight="fill" aria-hidden />
      {count > 9 ? "9+" : count} <span className="sr-only">new {count === 1 ? "comment" : "comments"}</span>
    </span>
  );
}
