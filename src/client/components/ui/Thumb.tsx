import { cn } from "@/lib/cn";
import { Photo } from "./Photo";

interface ThumbProps {
  src: string;
  alt: string;
  /** "row" is a list row's picture; "sheet" is the larger one at the top of a thing's sheet. */
  size?: "row" | "sheet";
  /** Steps back (a thing that's been bought). */
  faded?: boolean;
  className?: string;
}

/**
 * A product's picture, small: a rounded square that shows the whole picture (product shots sit on white, so
 * nothing is cropped). The shopping list's rows and sheet use it.
 */
export function Thumb({ src, alt, size = "row", faded, className }: ThumbProps) {
  return (
    <Photo
      src={src}
      alt={alt}
      fit="contain"
      className={cn(
        "ring-ink/8 shrink-0 rounded-md ring-1 ring-inset",
        size === "row" ? "size-12" : "size-24 rounded-lg md:size-28",
        faded && "opacity-60",
        className,
      )}
    />
  );
}
