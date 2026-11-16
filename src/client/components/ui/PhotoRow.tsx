import { Link, type LinkComponentProps } from "@tanstack/react-router";
import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Photo } from "./Photo";

/** How a row (or the card around one) shows it is picked, and the wash under a mouse. */
export const rowSelected = "bg-cream shadow-ring";
export const rowHover = "hover:bg-ink/4";

/** The picture's side: `sm` for a small event, `md` for a list of things, `lg` for search results (bigger from md). */
const sizes = { sm: "size-12", md: "size-16", lg: "size-20 md:size-24" } as const;

export type PhotoRowSize = keyof typeof sizes;

/**
 * Where a row's words start: its padding (p-2), the picture and the gap (gap-3.5) below md. Kept beside `sizes` so a
 * button under the words (`ActionCard` on a phone) lines up with them; change them together.
 */
export const wordsIndent: Record<PhotoRowSize, string> = {
  sm: "pl-[4.375rem]",
  md: "pl-[5.375rem]",
  lg: "pl-[6.375rem]",
};

interface PhotoRowProps {
  /** Where the row leads: a router `Link`'s own props (`to`, `params`, `search`) plus its handlers. */
  link: LinkComponentProps<"a">;
  photo: { src: string; color?: string } | null;
  /**
   * What the tile holds when there is no photo: an icon, a spool. Its own tone goes in `tileClassName`
   * (`bg-well text-ink-ghost` is the default).
   */
  tile: ReactNode;
  tileClassName?: string;
  size?: PhotoRowSize;
  /** The photo steps back (a shelved build). */
  faded?: boolean;
  /** The keyboard's or the pointer's place in a list of results. */
  selected?: boolean;
  /**
   * The row draws no wash or ring of its own: a card around it does (`ActionCard`), for a row with a button of its own
   * beside the link. It still says it is the selected one (`aria-current`).
   */
  bare?: boolean;
  /** Text lines start at the picture's top (results, with several lines) or sit in its middle (a quiet row). */
  align?: "start" | "center";
  className?: string;
  /** The words beside the picture. */
  children: ReactNode;
}

/**
 * One compact row for a print or a thing: its picture first, then the words, the whole row one link that
 * lifts a faint wash on hover. Search results, the Done and Shelved builds and the Journal's quiet events
 * all use it, so a row looks the same wherever a list of prints shows up.
 */
export const PhotoRow = forwardRef<HTMLAnchorElement, PhotoRowProps>(function PhotoRow(
  { link, photo, tile, tileClassName, size = "md", faded, selected, bare, align = "center", className, children },
  ref,
) {
  return (
    <Link
      ref={ref}
      {...link}
      aria-current={selected || undefined}
      className={cn(
        "pressable focus-ring flex gap-3.5 rounded-lg p-2 md:gap-4",
        align === "start" ? "items-start" : "items-center",
        bare ? null : selected ? rowSelected : rowHover,
        className,
      )}
    >
      {photo ? (
        <Photo
          src={photo.src}
          alt=""
          color={photo.color}
          className={cn("shrink-0 rounded-md", sizes[size], faded && "opacity-75 saturate-50")}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md",
            sizes[size],
            tileClassName ?? "bg-well text-ink-ghost",
          )}
        >
          {tile}
        </span>
      )}
      {children}
    </Link>
  );
});
