import { cn } from "@/lib/cn";
import { Photo } from "./Photo";

interface ThumbProps {
  /** The picture's address. A thing without a picture has no thumb at all: draw none rather than an empty tile. */
  src: string;
  alt: string;
  /** "row" is a list row's picture (48 px); "sheet" is the larger one at the top of a thing's sheet. */
  size?: "row" | "sheet";
  /** Steps back (a thing that's been bought). */
  faded?: boolean;
  className?: string;
}

const sizes = { row: "size-12 rounded-sm", sheet: "size-24 rounded-lg md:size-28" } as const;

/**
 * A product's picture, small: a rounded square that shows the whole picture (product shots sit on white, so
 * nothing is cropped). Eager: there are only a
 * few, and they sit at the top of the page.
 */
export function Thumb({ src, alt, size = "row", faded, className }: ThumbProps) {
  return (
    <Photo
      src={src}
      alt={alt}
      fit="contain"
      eager
      className={cn("ring-ink/8 shrink-0 ring-1 ring-inset", sizes[size], faded && "opacity-60", className)}
    />
  );
}
