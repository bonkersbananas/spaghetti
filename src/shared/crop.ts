/**
 * The maths of the square crop for a profile picture. The crop is a square window onto the image:
 * `zoom` 1 shows the largest square that fits (the short edge), 4 a quarter of that side. The window is
 * kept by its centre in the image's own pixels, so it survives the view being resized.
 */

export interface CropView {
  /** 1 to MAX_ZOOM. */
  zoom: number;
  /** Centre of the window, in source pixels. */
  cx: number;
  cy: number;
}

export const MAX_ZOOM = 4;

/** Side of the window, in source pixels. */
export function windowSide(width: number, height: number, zoom: number): number {
  return Math.min(width, height) / zoom;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Keeps the zoom in range and the window inside the image. */
export function clampView(width: number, height: number, view: CropView): CropView {
  const zoom = clamp(view.zoom, 1, MAX_ZOOM);
  const half = windowSide(width, height, zoom) / 2;
  return { zoom, cx: clamp(view.cx, half, width - half), cy: clamp(view.cy, half, height - half) };
}

/** The window centred on the image, nothing zoomed. */
export function startView(width: number, height: number): CropView {
  return { zoom: 1, cx: width / 2, cy: height / 2 };
}

/** Dragging the picture by (dx, dy) screen pixels in a view `size` px wide moves the window the other way. */
export function panView(width: number, height: number, view: CropView, dx: number, dy: number, size: number): CropView {
  const perPixel = windowSide(width, height, view.zoom) / size;
  return clampView(width, height, { ...view, cx: view.cx - dx * perPixel, cy: view.cy - dy * perPixel });
}

/** Zooms by a factor around a point in the view (px from its top left), so that point stays under the finger or cursor. */
export function zoomView(
  width: number,
  height: number,
  view: CropView,
  factor: number,
  size: number,
  at: { x: number; y: number } = { x: size / 2, y: size / 2 },
): CropView {
  const zoom = clamp(view.zoom * factor, 1, MAX_ZOOM);
  const before = windowSide(width, height, view.zoom);
  const after = windowSide(width, height, zoom);
  // The source point under `at` is before-window-left + at/size*before; keep it there.
  const px = view.cx - before / 2 + (at.x / size) * before;
  const py = view.cy - before / 2 + (at.y / size) * before;
  return clampView(width, height, { zoom, cx: px - (at.x / size - 0.5) * after, cy: py - (at.y / size - 0.5) * after });
}

/** The square to cut from the image: left, top and side in source pixels. */
export function cropRect(width: number, height: number, view: CropView) {
  const clamped = clampView(width, height, view);
  const side = windowSide(width, height, clamped.zoom);
  return { sx: clamped.cx - side / 2, sy: clamped.cy - side / 2, side };
}
