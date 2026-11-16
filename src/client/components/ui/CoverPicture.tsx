import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { type Cover, fileThumbSrc, photoSrc } from "@/lib/previews";
import { SlicerPreviewBadge } from "./Card";
import { NoteFace } from "./NoteFace";
import { Photo } from "./Photo";

/**
 * A cover as a `Card`, `MiniCard` or `PhotoRow` takes its picture: the photo, or the plate render shown whole
 * (`fit="contain"`, which they draw on the render ground). Undefined for a note card: they draw the note themselves.
 */
export function coverPhoto(
  cover: Cover,
  alt: string,
): { id?: string; src: string; alt: string; color?: string; fit?: "contain" } | undefined {
  if (cover.kind === "photo")
    return { id: cover.photo.id, src: photoSrc(cover.photo.id, "thumb"), alt, color: cover.photo.color || undefined };
  if (cover.kind === "plate") return { src: fileThumbSrc(cover.file), alt, fit: "contain" };
  return undefined;
}

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
  /** Says "From the model" on a render's corner, where the picture is big enough to carry it. */
  label?: boolean;
  /** Room around a render, so the model doesn't touch the frame (`p-3` by default). */
  inset?: string;
  /** Sizes the frame: the picture fills it. */
  className?: string;
  imgClassName?: string;
}

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
  className,
  imgClassName,
}: CoverPictureProps) {
  if (cover.kind === "photo") {
    return (
      <Photo
        src={photoSrc(cover.photo.id, "thumb")}
        alt={alt}
        color={cover.photo.color || undefined}
        className={className}
        imgClassName={imgClassName}
      />
    );
  }
  if (cover.kind === "plate") {
    return (
      <div className={cn("relative overflow-hidden", className)}>
        <Photo
          src={fileThumbSrc(cover.file)}
          alt={alt}
          fit="contain"
          frame="render"
          className={cn("size-full", inset)}
          imgClassName={imgClassName}
        />
        {label && (
          <span className="absolute top-2 left-2">
            <SlicerPreviewBadge />
          </span>
        )}
      </div>
    );
  }
  if (glyph) {
    return (
      <div aria-hidden className={cn("bg-ink/5 text-ink-faint flex items-center justify-center", className)}>
        {glyph}
      </div>
    );
  }
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <NoteFace note={cover.text} />
    </div>
  );
}
