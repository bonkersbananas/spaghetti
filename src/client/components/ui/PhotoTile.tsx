import { Link, type LinkComponentProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { NoteFace } from "./NoteFace";
import { Photo } from "./Photo";

/**
 * The grid for `PhotoTile`s: two columns on a phone, four from md, six from xl. A `large` tile takes two columns
 * (three from xl), so the newest finished prints lead and the rest follow as a quiet field of pictures.
 */
export const photoTileGrid =
  "m-0 grid list-none grid-cols-2 gap-x-3 gap-y-5 p-0 md:grid-cols-4 md:gap-x-5 md:gap-y-7 xl:grid-cols-6";

interface PhotoTileProps {
  /** Where the tile leads: a router `Link`'s own props. */
  link: LinkComponentProps<"a">;
  /** The cover; `fit: "contain"` for a slicer's plate picture, drawn whole on the render ground. */
  photo?: { src: string; alt: string; color?: string; fit?: "cover" | "contain" };
  /** Stands in for a missing photo: a note card's face, so a build with nothing to show still has one. */
  note?: string;
  /** The name under the picture, ending in … when it is long. */
  title: string;
  /** One quiet line under the name: when it was done. */
  meta?: ReactNode;
  /** The picture is wider (4:3) and the tile takes two columns on a phone, three from xl. */
  large?: boolean;
  className?: string;
}

/**
 * A print as a picture with its name and date under it, no card around it: the photo-first sibling of `PhotoRow` for a
 * list of things worth looking at (Done on Builds). The words sit under the picture, never over it, so the photo stays
 * whole; a name too long for the line ends in …
 */
export function PhotoTile({ link, photo, note, title, meta, large, className }: PhotoTileProps) {
  return (
    <li className={cn("min-w-0 list-none", large && "col-span-2 xl:col-span-3", className)}>
      <Link {...link} className="group pressable focus-ring flex flex-col gap-2 rounded-lg">
        <div
          className={cn(
            "bg-well shadow-soft relative w-full overflow-hidden rounded-lg",
            large ? "aspect-4/3" : "aspect-square",
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
            <NoteFace note={note ?? ""} compact={large ? undefined : "fill"} maxSize="lg" />
          )}
        </div>
        <span className="min-w-0 px-1">
          <span className="text-ink text-body block truncate font-semibold">{title}</span>
          {meta && <span className="text-small text-ink-faint block truncate">{meta}</span>}
        </span>
      </Link>
    </li>
  );
}
