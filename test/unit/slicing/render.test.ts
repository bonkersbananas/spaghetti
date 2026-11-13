import { describe, expect, it } from "vitest";
import { renderPlate } from "../../../src/shared/slicing/render.ts";
import { box } from "./meshes.ts";

/** How many pixels are drawn, and their colour's channels summed. */
function coverage(pixels: Uint8ClampedArray) {
  let drawn = 0;
  let red = 0;
  let blue = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    drawn++;
    red += pixels[i] as number;
    blue += pixels[i + 2] as number;
  }
  return { drawn, red, blue };
}

describe("renderPlate", () => {
  it("draws the objects in the filament's colour on a clear ground, filling the frame", () => {
    const size = 64;
    const pixels = renderPlate([box([100, 100, 0], [120, 120, 20])], { size, colour: "#F2754E" });
    expect(pixels.length).toBe(size * size * 4);
    const { drawn, red, blue } = coverage(pixels);
    expect(drawn).toBeGreaterThan(size * size * 0.2);
    expect(red).toBeGreaterThan(blue);
    // The corners stay clear.
    expect(pixels[3]).toBe(0);
    expect(pixels[(size * size - 1) * 4 + 3]).toBe(0);
  });

  it("gives each object its own colour, and draws nothing for nothing", () => {
    const pixels = renderPlate([box([0, 0, 0], [10, 10, 10]), box([20, 0, 0], [30, 10, 10])], {
      size: 32,
      colour: "#F2754E",
      colours: [undefined, "#4F7FC7"],
    });
    const { red, blue } = coverage(pixels);
    expect(blue).toBeGreaterThan(0);
    expect(red).toBeGreaterThan(0);
    expect(coverage(renderPlate([], { size: 16, colour: "#F2754E" })).drawn).toBe(0);
  });
});
