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

/** A slicer file's plate picture: the local copy while it uploads, else the server's. */
export function fileThumbSrc(fileId: string): string {
  return previews.get(fileId)?.thumb ?? fileUrl(fileId, "thumb");
}
