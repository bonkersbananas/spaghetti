import { Link, type LinkComponentProps } from "@tanstack/react-router";
import { m } from "motion/react";
import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";
import { ImageIcon } from "./icons";
import { NoteFace } from "./NoteFace";
import { Photo } from "./Photo";
import { useReflow } from "./Reflow";

interface MiniCardProps {
  /** Where the card leads: a router `Link`'s own props. */
  link: LinkComponentProps<"a">;
  /** The cover only: a mini card never swipes through photos, so a sideways drag on it always belongs to its strip. */
  photo?: { src: string; alt: string; color?: string; fit?: "cover" | "contain" };
  /** Stands in for a missing photo, as a small note face. */
  note?: string;
  title?: string;
  /** Laid over the photo's top-right corner (the card's menu button). A link can't hold a button, so it is a sibling. */
  corner?: ReactNode;
  landing?: boolean;
  ref?: Ref<HTMLLIElement>;
  className?: string;
}

/**
 * A small card for a strip: the cover photo, square, with its title (two lines at most) under it, about 7 rem wide.
 * It is the compact sibling of Card, for rows that scroll sideways (Up next on phones) and give way to what is below.
 */
export function MiniCard({ link, photo, note, title, corner, landing, ref, className }: MiniCardProps) {
  const heading = title || (photo ? note : undefined);
  return (
    <m.li
      {...useReflow(landing)}
      ref={ref}
      className={cn("relative w-[6.125rem] shrink-0 snap-start list-none", className)}
    >
      <Link
        {...link}
        className="group pressable focus-ring bg-cream shadow-soft hover:bg-lifted flex h-full w-full flex-col rounded-lg p-1"
      >
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-md",
            photo || !note ? "aspect-square" : "min-h-[5.625rem] flex-1",
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
            <NoteFace note={note} compact className="pt-7" />
          ) : (
            <div className="bg-well text-ink-ghost flex size-full items-center justify-center">
              <ImageIcon size={24} weight="light" aria-hidden />
            </div>
          )}
        </div>
        {(heading || !note) && (
          // The padding is on the wrapper: a clamped heading shows its next line in its own padding.
          <div className="px-1.5 pt-1.5 pb-1">
            <h3
              className={cn(
                "text-small line-clamp-2 min-h-[2lh] leading-snug break-words",
                // A note standing in for a title is set as on Card: plain Figtree, not a title.
                title ? "text-ink font-semibold" : "text-ink font-sans font-medium",
              )}
            >
              {heading || "Untitled"}
            </h3>
          </div>
        )}
      </Link>
      {corner}
    </m.li>
  );
}
