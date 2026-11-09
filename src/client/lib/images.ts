import { readTakenAt } from "@shared/exif";

/** Long edge of the variant shown in the photo viewer. */
export const LARGE_EDGE = 2048;
/** Long edge of the variant in grids: sharp in a phone's two columns at 3x. */
export const THUMB_EDGE = 600;

export interface ProcessedPhoto {
  large: Blob;
  thumb: Blob;
  width: number;
  height: number;
  /** Average color, #rrggbb. */
  color: string;
  takenAt: number | null;
}

/** A file this browser can't decode, such as HEIC on desktop Chrome. */
export class UnreadablePhotoError extends Error {
  readonly heic: boolean;
  constructor(file: Blob) {
    const heic = /hei[cf]/i.test(file.type) || (file instanceof File && /\.hei[cf]$/i.test(file.name));
    super(
      heic
        ? "This browser can't open HEIC photos. Export it as JPEG, or add it from your phone."
        : "This browser couldn't open that file as a photo.",
    );
    this.name = "UnreadablePhotoError";
    this.heic = heic;
  }
}

/**
 * Turns a camera or library file into the two variants we upload: resized
 * in the browser (the Worker has no image library), upright (EXIF
 * orientation applied) and re-encoded, which drops EXIF data and with it any
 * location. The capture time is read first and kept.
 */
export async function processPhoto(file: Blob): Promise<ProcessedPhoto> {
  const takenAt = await readCaptureTime(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new UnreadablePhotoError(file);
  }
  try {
    const large = drawScaled(bitmap, LARGE_EDGE);
    const thumb = drawScaled(large, THUMB_EDGE);
    const type = await pickType(large);
    const [largeBlob, thumbBlob] = await Promise.all([encode(large, type, 0.84), encode(thumb, type, 0.8)]);
    return {
      large: largeBlob,
      thumb: thumbBlob,
      width: large.width,
      height: large.height,
      color: averageColor(thumb),
      takenAt,
    };
  } finally {
    bitmap.close();
  }
}

async function readCaptureTime(file: Blob): Promise<number | null> {
  if (file.type && file.type !== "image/jpeg") return null;
  try {
    // EXIF sits in the first segments; 256 KB covers big embedded previews.
    return readTakenAt(await file.slice(0, 256 * 1024).arrayBuffer());
  } catch {
    return null;
  }
}

function drawScaled(source: ImageBitmap | HTMLCanvasElement, longEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, longEdge / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

let webpSupport: Promise<boolean> | null = null;

/** WebP where the browser can encode it (Safari can't, and hands back PNG), else JPEG. */
function pickType(canvas: HTMLCanvasElement): Promise<string> {
  webpSupport ??= toBlob(canvas, "image/webp", 0.5).then((blob) => blob?.type === "image/webp");
  return webpSupport.then((ok) => (ok ? "image/webp" : "image/jpeg"));
}

async function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  const blob = await toBlob(canvas, type, quality);
  if (!blob) throw new Error("Encoding the photo failed");
  return blob;
}

function averageColor(canvas: HTMLCanvasElement): string {
  const tiny = drawScaled(canvas, 4);
  const data = tiny.getContext("2d")?.getImageData(0, 0, tiny.width, tiny.height).data;
  // Data, not design: the fallback placeholder matches the well token.
  if (!data) return "#ebe3d5"; // design-lint-ignore
  let [r, g, b] = [0, 0, 0];
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i] ?? 0;
    g += data[i + 1] ?? 0;
    b += data[i + 2] ?? 0;
  }
  const hex = (value: number) =>
    Math.round(value / pixels)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
