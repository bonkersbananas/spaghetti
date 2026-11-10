import { describe, expect, it } from "vitest";
import { clampView, cropRect, MAX_ZOOM, panView, startView, zoomView } from "../../src/shared/crop.ts";

describe("crop", () => {
  it("starts on the biggest centred square", () => {
    expect(cropRect(400, 300, startView(400, 300))).toEqual({ sx: 50, sy: 0, side: 300 });
  });

  it("zooms to a smaller window and never past the limits", () => {
    expect(cropRect(300, 300, { zoom: 2, cx: 150, cy: 150 }).side).toBe(150);
    expect(clampView(300, 300, { zoom: 99, cx: 150, cy: 150 }).zoom).toBe(MAX_ZOOM);
    expect(clampView(300, 300, { zoom: 0.2, cx: 150, cy: 150 }).zoom).toBe(1);
  });

  it("keeps the window inside the image when dragging", () => {
    const view = { zoom: 2, cx: 150, cy: 150 };
    const far = panView(300, 300, view, 10_000, 10_000, 300);
    expect(far.cx).toBe(75);
    expect(far.cy).toBe(75);
    const other = panView(300, 300, view, -10_000, -10_000, 300);
    expect(other.cx).toBe(225);
  });

  it("drags the picture with the finger: dragging right shows what is left", () => {
    const view = { zoom: 2, cx: 150, cy: 150 };
    // The window is 150 source px across 300 view px: 0.5 px per screen pixel.
    expect(panView(300, 300, view, 20, 0, 300).cx).toBe(140);
  });

  it("can't pan a square image at zoom 1", () => {
    expect(panView(300, 300, startView(300, 300), 50, 50, 300)).toEqual(startView(300, 300));
  });

  it("keeps the point under the cursor while zooming", () => {
    const view = { zoom: 1, cx: 500, cy: 500 };
    // Top-left of the view is source (0, 0); zooming there by 2 keeps (0, 0) at the top left.
    const zoomed = zoomView(1000, 1000, view, 2, 300, { x: 0, y: 0 });
    expect(cropRect(1000, 1000, zoomed)).toEqual({ sx: 0, sy: 0, side: 500 });
  });
});
