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

  it("frames pictures by what they are given to fit, so plates share one scale and one ground line", () => {
    const size = 64;
    const tall = box([0, 0, 0], [40, 40, 120]);
    const short = box([0, 0, 0], [40, 40, 30]);
    const rows = (pixels: Uint8ClampedArray) => {
      const drawn: number[] = [];
      for (let y = 0; y < size; y++) {
        if (pixels.slice(y * size * 4, (y + 1) * size * 4).some((_, at) => at % 4 === 3 && pixels[y * size * 4 + at]))
          drawn.push(y);
      }
      return { top: drawn[0] ?? -1, bottom: drawn[drawn.length - 1] ?? -1 };
    };
    // Alone, each fills its frame: the short box is as tall in the picture as the tall one.
    const alone = rows(renderPlate([short], { size, colour: "#F2754E" }));
    const aloneTall = rows(renderPlate([tall], { size, colour: "#F2754E" }));
    expect(alone.bottom - alone.top).toBeGreaterThan((aloneTall.bottom - aloneTall.top) * 0.8);
    // Framed together, the short one is shorter, and both stand on the same line.
    const together = rows(renderPlate([short], { size, colour: "#F2754E", fit: [tall, short] }));
    const togetherTall = rows(renderPlate([tall], { size, colour: "#F2754E", fit: [tall, short] }));
    expect(together.bottom - together.top).toBeLessThan((togetherTall.bottom - togetherTall.top) * 0.6);
    expect(Math.abs(together.bottom - togetherTall.bottom)).toBeLessThanOrEqual(1);
  });
});
