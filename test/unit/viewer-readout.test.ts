import { describe, expect, it } from "vitest";
import { layerReadout, liveReadout } from "../../src/client/components/viewer/readout.ts";

describe("the 3D view's readout", () => {
  it("says a print in progress in one line, with the printer's own time left", () => {
    expect(liveReadout(140, 317, 105, 9000)).toBe("Layer 140 of 317 · 1 h 45 min left");
  });

  it("falls back to what the slicer's layer times leave when the printer gives no time", () => {
    expect(liveReadout(140, 317, null, 92 * 60)).toBe("Layer 140 of 317 · 1 h 32 min left");
    expect(liveReadout(316, 317, 0, 20)).toBe("Layer 316 of 317 · nearly done");
    expect(liveReadout(3, 317, null, null)).toBe("Layer 3 of 317");
  });

  it("says a layer the slider shows with its height and how far into the print it comes", () => {
    expect(layerReadout(59, 317, 7.2, 37 * 60)).toBe("Layer 60 of 317 · 7.2 mm · 37 min in");
    expect(layerReadout(0, 317, 0.2, 10)).toBe("Layer 1 of 317 · 0.2 mm · at the start");
  });
});
