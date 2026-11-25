import { Link, type LinkComponentProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { NoteFace } from "./NoteFace";
import { Photo } from "./Photo";

/**
 * The grid for `PrintTile`s: two columns on a phone, three across from md (six columns, so two lead tiles share a
 * row), six from xl. The `lead` tiles are the newest: one on a phone, two from md, three from xl, so a row is never
 * half empty and the large pictures stay about the size of the cards above them.
 */
export const printTileGrid =
  "m-0 grid list-none grid-cols-2 gap-x-3 gap-y-5 p-0 md:grid-cols-6 md:gap-x-5 md:gap-y-7 xl:grid-cols-6";

/** The picture's shape: 4:3 once the tile is wide (the same breakpoints as `printTileSpan`), a square before. */
const leadShape = ["aspect-4/3", "aspect-square md:aspect-4/3", "aspect-square xl:aspect-4/3"] as const;

/** How wide the nth tile is: the first two columns always, the second from md, the third from xl, the rest one. */
export const printTileSpan = [
  "col-span-2 md:col-span-3 xl:col-span-2",
  "md:col-span-3 xl:col-span-2",
  "md:col-span-2 xl:col-span-2",
] as const;

interface PrintTileProps {
  /** Where the tile leads: a router `Link`'s own props. */
  link: LinkComponentProps<"a">;
  /** The cover; `fit: "contain"` for a slicer's plate picture, drawn whole on the render ground. */
  photo?: { src: string; alt: string; color?: string; fit?: "cover" | "contain" };
  /** Stands in for a missing photo: a note card's face, so a print with nothing to show still has one. */
  note?: string;
  /** The name under the picture, two lines at most. None when the note card already says it. */
  title?: string;
  /** One quiet line under the name: when it was done. */
  meta?: ReactNode;
  /** Which of the grid's leading tiles this is (0, 1, 2), else undefined: it decides how wide the tile is and how it is drawn. */
  lead?: 0 | 1 | 2;
  className?: string;
}

/**
 * A finished print as its picture with its name and date under it, no card around it: the photo-first sibling of
 * `PhotoRow` for a grid of things worth looking at (Done on Builds). The words sit under the picture, never over it,
 * so the photo stays whole; a long name takes two lines and ends in …
 */
export function PrintTile({ link, photo, note, title, meta, lead, className }: PrintTileProps) {
  return (
    <li
      className={cn(
        "min-w-0 list-none md:col-span-2 xl:col-span-1",
        lead !== undefined && printTileSpan[lead],
        className,
      )}
    >
      <Link {...link} className="pressable focus-ring flex flex-col gap-2 rounded-lg">
        <div
          className={cn(
            "bg-well shadow-well relative w-full overflow-hidden rounded-lg",
            lead === undefined ? "aspect-square" : leadShape[lead],
          )}
        >
          {photo ? (
            <Photo
              src={photo.src}
              alt={photo.alt}
              color={photo.color}
              fit={photo.fit}
              frame={photo.fit === "contain" ? "render" : undefined}
              className={cn("size-full", photo.fit === "contain" && "p-3")}
            />
          ) : (
            <NoteFace note={note ?? ""} maxSize="lg" doodle />
          )}
        </div>
        <span className="min-w-0 px-1">
          {title && <span className="text-ink text-body line-clamp-2 block font-semibold break-words">{title}</span>}
          {meta && <span className="text-small text-ink-faint block truncate">{meta}</span>}
        </span>
      </Link>
    </li>
  );
}
