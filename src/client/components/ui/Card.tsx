import type { Person } from "@shared/api";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Avatar } from "./Avatar";
import { ImageIcon } from "./icons";

export interface CardProps {
  /** The photo leads. Without one, the card shows a soft placeholder. */
  photo?: { src: string; alt: string };
  /** Optional: ideas don't need a title. Falls back to the note. */
  title?: string;
  note?: string;
  /** Chips over the photo's bottom edge: status, material. */
  chips?: ReactNode;
  /** Small line under the title: "2 attempts · 3 days ago". */
  meta?: ReactNode;
  person?: Pick<Person, "name" | "color">;
  /** "tall" for portrait photos in masonry-like grids. */
  aspect?: "landscape" | "square" | "tall";
  onClick?: () => void;
  className?: string;
}

const aspects = {
  landscape: "aspect-4/3",
  square: "aspect-square",
  tall: "aspect-3/4",
};

/**
 * The photo-first card: prints are physical, so the picture is the content
 * and the text supports it.
 */
export function Card({ photo, title, note, chips, meta, person, aspect = "landscape", onClick, className }: CardProps) {
  const heading = title || note;
  const Root = onClick ? "button" : "article";
  return (
    <Root
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "group bg-cream shadow-soft flex w-full flex-col rounded-lg p-1.5 text-left",
        onClick && "pressable focus-ring hover:shadow-raised cursor-pointer",
        className,
      )}
    >
      <div className={cn("bg-well relative w-full overflow-hidden rounded-md", aspects[aspect])}>
        {photo ? (
          <img
            src={photo.src}
            alt={photo.alt}
            loading="lazy"
            decoding="async"
            className="duration-slow size-full object-cover transition-transform ease-out group-hover:scale-[1.02]"
          />
        ) : (
          <div className="text-ink-ghost flex size-full items-center justify-center">
            <ImageIcon size={32} weight="light" aria-hidden />
          </div>
        )}
        {chips && <div className="absolute bottom-2 left-2 flex flex-wrap gap-1.5">{chips}</div>}
      </div>
      <div className="flex items-start gap-2.5 px-2 pt-2.5 pb-2">
        <div className="min-w-0 flex-1">
          {heading ? (
            <h3
              className={cn(
                "text-body text-ink line-clamp-2 font-semibold",
                // Notes standing in for a title read as text, not as a heading.
                !title && "font-sans font-medium",
              )}
            >
              {heading}
            </h3>
          ) : (
            <h3 className="text-body text-ink-faint font-sans font-medium italic">Untitled</h3>
          )}
          {meta && <p className="text-small text-ink-faint mt-0.5 line-clamp-2">{meta}</p>}
        </div>
        {person && <Avatar person={person} size="xs" className="mt-0.5" />}
      </div>
    </Root>
  );
}
