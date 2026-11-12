import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Icon } from "./icons";
import { Photo } from "./Photo";

interface PickRowProps {
  /** The leading picture: a photo's thumbnail, or a slicer's plate (`contain`, whole on the well). */
  photo?: { src: string; color?: string; fit?: "cover" | "contain" } | null;
  /** With no picture: a glyph tile. `tone` is the tile's soft colors (an outcome's); the default is a quiet ink wash. */
  glyph?: { icon: Icon; tone?: string };
  title: string;
  /** A quiet second line: pieces in `MetaList` or plain words. */
  meta?: ReactNode;
  /** A small label beside the title (a neutral `Chip`). */
  mark?: ReactNode;
  /** A step quieter: a smaller tile and softer title, for what is rarely the answer (done and shelved builds). */
  quiet?: boolean;
  onSelect: () => void;
  /** Starts with focus (the suggested choice), so Enter takes it. */
  autoFocus?: boolean;
  className?: string;
}

/**
 * One choice in a list of things to pick from, picture first: a tap takes it. Builds in "Add to a build", attempts in
 * the second step. 56 px tall (a thumb's row), a faint wash on hover. Always a picture or a glyph, never an empty tile.
 */
export function PickRow({ photo, glyph, title, meta, mark, quiet, onSelect, autoFocus, className }: PickRowProps) {
  const tile = cn("shrink-0 rounded-md", quiet ? "size-9 md:size-10" : "size-10 md:size-11");
  const GlyphIcon = glyph?.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      // biome-ignore lint/a11y/noAutofocus: the suggested row takes Enter in a sheet that was just opened to choose.
      autoFocus={autoFocus}
      className={cn(
        "pressable focus-ring duration-fast hover:bg-ink/4 -mx-2 flex min-h-14 w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
        className,
      )}
    >
      {photo ? (
        <Photo
          src={photo.src}
          alt=""
          color={photo.color}
          fit={photo.fit}
          className={cn(tile, photo.fit === "contain" && "p-0.5")}
        />
      ) : (
        <span
          aria-hidden
          className={cn(tile, "flex items-center justify-center", glyph?.tone ?? "bg-ink/5 text-ink-faint")}
        >
          {GlyphIcon && <GlyphIcon size={quiet ? 18 : 22} />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("text-body truncate", quiet ? "text-ink-soft font-medium" : "text-ink font-semibold")}>
            {title}
          </span>
          {mark}
        </span>
        {meta && <span className="text-small text-ink-faint block min-w-0">{meta}</span>}
      </span>
    </button>
  );
}
