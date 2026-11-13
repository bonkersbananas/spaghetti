import type { PhotoVariant } from "@shared/api";
import { fileUrl, photoUrl } from "@shared/api";

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

/**
 * A slicer file's plate picture: the local copy while it uploads, else the server's. `version` (a model's slice time)
 * gives a picture that changes when the model is sliced again an address of its own.
 */
export function fileThumbSrc(fileId: string, version?: number): string {
  return previews.get(fileId)?.thumb ?? `${fileUrl(fileId, "thumb")}${version ? `?v=${version}` : ""}`;
}

/** Forgets a file's local picture (a re-slice was undone: the server's is the one to show). */
export function dropPreview(fileId: string) {
  const old = previews.get(fileId);
  if (!old) return;
  previews.delete(fileId);
  setTimeout(() => URL.revokeObjectURL(old.thumb), 10_000);
}
