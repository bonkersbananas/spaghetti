import type { AttemptFile, PhotoVariant } from "@shared/api";
import { fileThumbUrl, photoUrl } from "@shared/api";
import { type Coverable, newestPictured, pickCover, type Cover as SharedCover } from "@shared/cover";
import type { PhotoView } from "./items";

/**
 * Object URLs of photos made on this device. A photo shows from here while
 * it uploads and keeps doing so afterwards, so it never flickers while the
 * same pixels are fetched again from the server.
 */
const previews = new Map<string, Record<PhotoVariant, string>>();

export function setPreview(photoId: string, thumb: Blob, large: Blob) {
  const old = previews.get(photoId);
  const thumbUrl = URL.createObjectURL(thumb);
  previews.set(photoId, { thumb: thumbUrl, large: large === thumb ? thumbUrl : URL.createObjectURL(large) });
  if (old) {
    // Let images using the old URL swap first.
    setTimeout(() => {
      URL.revokeObjectURL(old.thumb);
      if (old.large !== old.thumb) URL.revokeObjectURL(old.large);
    }, 10_000);
  }
}

/** The URL to show a photo at: the local copy if this device made it, else the server's. */
export function photoSrc(photoId: string, variant: PhotoVariant): string {
  return previews.get(photoId)?.[variant] ?? photoUrl(photoId, variant);
}

export function hasPreview(photoId: string): boolean {
  return previews.has(photoId);
}

/** A slicer file's plate picture: the local copy while it uploads or slices here, else the server's (`fileThumbUrl`). */
export function fileThumbSrc(file: { id: string; slice?: { at: number } | null }): string {
  return previews.get(file.id)?.thumb ?? fileThumbUrl(file);
}

/** Forgets a file's local picture (a re-slice was undone: the server's is the one to show). */
export function dropPreview(fileId: string) {
  const old = previews.get(fileId);
  if (!old) return;
  previews.delete(fileId);
  setTimeout(() => URL.revokeObjectURL(old.thumb), 10_000);
}

/**
 * What a thing shows where its picture goes (`pickCover` in shared/cover.ts, the one cover rule): the best photo, else
 * its newest plate picture, else its note card. Used by the idea and build pages, every card, Today, the Journal's
 * Now, the sidebar and the Since group, so a build never loses its picture on the way. A plate picture counts once
 * this device has drawn it (a model being sliced here), before the server has it. `file` puts one file first (the
 * print on the bed shows the plate it is printing).
 */
export type Cover = SharedCover<PhotoView, AttemptFile>;

export function coverOf(item: Coverable<PhotoView, AttemptFile>, options: { file?: AttemptFile | null } = {}): Cover {
  return pickCover(item, { file: options.file, hasPicture: pictured });
}

/** The newest of a thing's files with a plate picture: its own (an idea's) and its attempts'. */
export function newestPlate(
  item: Pick<Coverable<PhotoView, AttemptFile>, "files" | "attempts">,
): AttemptFile | undefined {
  return newestPictured(item, pictured);
}

/** A file with a plate picture: on the server, or drawn on this device. */
const pictured = (file: Pick<AttemptFile, "id" | "hasThumb">) => file.hasThumb || hasPreview(file.id);
