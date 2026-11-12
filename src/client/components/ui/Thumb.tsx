import { cn } from "@/lib/cn";
import { ImageIcon } from "./icons";
import { Photo } from "./Photo";

interface ThumbProps {
  /** The picture's address; without one the slot shows a quiet tile, so every row's name starts at the same edge. */
  src: string | null;
  alt: string;
  /** "row" is a list row's picture; "sheet" is the larger one at the top of a thing's sheet. */
  size?: "row" | "sheet";
  /** Steps back (a thing that's been bought). */
  faded?: boolean;
  className?: string;
}

const sizes = { row: "size-10 md:size-12", sheet: "size-24 rounded-lg md:size-28" } as const;

/**
 * A product's picture, small: a rounded square that shows the whole picture (product shots sit on white, so
 * nothing is cropped). Always the same slot: with no picture it is a `well` tile with a faint image icon, as a
 * card without a photo does elsewhere. Eager: there are only a few, and they sit at the top of the page.
 */
export function Thumb({ src, alt, size = "row", faded, className }: ThumbProps) {
  const box = cn("ring-ink/8 shrink-0 rounded-md ring-1 ring-inset", sizes[size], faded && "opacity-60", className);
  if (!src) {
    return (
      <span aria-hidden className={cn(box, "bg-well text-ink-ghost flex items-center justify-center")}>
        <ImageIcon size={size === "row" ? 18 : 28} />
      </span>
    );
  }
  return <Photo src={src} alt={alt} fit="contain" eager className={box} />;
}
