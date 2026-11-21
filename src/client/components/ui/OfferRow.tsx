import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Icon } from "./icons";
import { Photo } from "./Photo";

interface OfferRowProps {
  /** The thing offered, picture first: a photo's thumbnail, or a slicer's plate (`contain`, whole on its ground). */
  photo?: { src: string; color?: string; fit?: "cover" | "contain" } | null;
  /** With no picture: a glyph tile in a quiet ink wash. */
  glyph?: Icon;
  title: string;
  /** Why it is offered, in a line or two of `text-small` ("Same file as ring.3mf"). */
  why?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * A thing a tap takes, offered as a row: the picture, its name and why it is offered, inside the dashed ring every
 * offer wears (`OfferChip`, a suggested outcome), with no fill, so it never reads as something already chosen. The
 * printer's "Which build is this?" offers its best guesses this way. 56 px tall at least, a faint wash on hover.
 */
export function OfferRow({ photo, glyph: GlyphIcon, title, why, onSelect, disabled, className }: OfferRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "pressable focus-ring border-ink/55 hover:bg-ink/4 duration-fast flex min-h-14 w-full items-center gap-3 rounded-lg border border-dashed py-2 pr-3 pl-2 text-left transition-colors disabled:pointer-events-none disabled:opacity-60",
        className,
      )}
    >
      {photo ? (
        <Photo
          src={photo.src}
          alt=""
          color={photo.color}
          fit={photo.fit}
          frame={photo.fit === "contain" ? "render-tile" : undefined}
          className={cn("size-10 shrink-0 rounded-md md:size-11", photo.fit === "contain" && "p-0.5")}
        />
      ) : (
        <span
          aria-hidden
          className="bg-ink/5 text-ink-faint flex size-10 shrink-0 items-center justify-center rounded-md md:size-11"
        >
          {GlyphIcon && <GlyphIcon size={22} />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="text-body text-ink block truncate font-semibold">{title}</span>
        {why && <span className="text-small text-ink-faint line-clamp-2 block break-words">{why}</span>}
      </span>
    </button>
  );
}
