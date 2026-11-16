import { type NoteSize, noteSize } from "@shared/notes";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Cover } from "@/lib/previews";
import { coverPhoto, SlicerPreviewBadge } from "./Card";
import { NoteFace } from "./NoteFace";
import { Photo } from "./Photo";

interface CoverPictureProps {
  /** From `coverOf` (lib/previews.ts), the one rule for what a thing shows. */
  cover: Cover;
  /** "" where the words beside it already name it. */
  alt?: string;
  /**
   * A small tile (a row's or the sidebar's): too small for a note to be read, so this glyph stands in for the note
   * card on a plain well.
   */
  glyph?: ReactNode;
  /** Says "From the model" on a render's corner, where the picture is big enough to carry it ("md": from md only). */
  label?: boolean | "md";
  /** Room around a render, so the model doesn't touch the frame (`p-3` by default). */
  inset?: string;
  /**
   * A frame wider than a card's (4:3 is "wide", 5:2 a "strip"): a note is set one or three sizes down, so it is sized
   * by the frame's short side and a short note isn't cut off.
   */
  shape?: "wide" | "strip";
  /** A tile of 48 px or less (a row's, the sidebar's): a render gets the deeper tile ground and a firmer edge. */
  small?: boolean;
  /** Sizes the frame: the picture fills it. */
  className?: string;
}

const NOTE_SIZES: NoteSize[] = ["xl", "lg", "md", "sm"];

/**
 * A thing's cover where its picture goes: the best photo; else its newest plate render, whole, on the render ground
 * (the model casts a faint shadow there, so white plastic keeps its edge), labeled "From the model" when `label`;
 * else its note on an index card (`NoteFace`), or `glyph` in a tile too small for words. Never an empty image icon.
 */
export function CoverPicture({
  cover,
  alt = "",
  glyph,
  label,
  inset = "p-3",
  shape,
  small,
  className,
}: CoverPictureProps) {
  const picture = coverPhoto(cover, alt);
  const plate = picture?.fit === "contain";
  const text = cover.kind === "note" ? cover.text : "";
  // A 4:3 frame is about three fifths as tall as a card's for its width, a 5:2 strip a third.
  const steps = shape === "strip" ? 3 : shape === "wide" ? 1 : 0;
  const size = NOTE_SIZES[Math.min(3, NOTE_SIZES.indexOf(noteSize(text)) + steps)];
  return (
    <div
      aria-hidden={(!picture && !!glyph) || undefined}
      className={cn(
        "relative overflow-hidden",
        !picture && !!glyph && "bg-ink/5 text-ink-faint flex items-center justify-center",
        className,
      )}
    >
      {picture ? (
        <Photo
          {...picture}
          frame={plate ? (small ? "render-tile" : "render") : undefined}
          className={cn("size-full", plate && inset)}
        />
      ) : (
        (glyph ?? <NoteFace note={text} size={size} />)
      )}
      {plate && label && (
        <span className={cn("absolute top-2 left-2", label === "md" && "max-md:hidden")}>
          <SlicerPreviewBadge />
        </span>
      )}
    </div>
  );
}
