import type { InterleavedBufferAttribute } from "three";
import { describe, expect, it } from "vitest";
import { boxGeometry, chunkGeometry } from "../../../src/client/components/viewer/chunks.ts";
import { readToolpaths } from "../../../src/shared/gcode/index.ts";

const segs = (n: number, z: number) => {
  const pos = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) pos.set([i, 0, z, i + 1, 0, z], i * 6);
  return { pos, info: new Float32Array(n * 2) };
};

describe("the viewer's chunks of layers", () => {
  it("each keep their own buffers when a print arrives in more than one batch", () => {
    const box = boxGeometry();
    const a = segs(5, 0.2);
    const b = segs(2, 24.2);
    const first = chunkGeometry(box, a.pos, a.info, 5);
    const second = chunkGeometry(box, b.pos, b.info, 2);
    // The later chunk must not have replaced the earlier one's data (a Benchy's hull vanished that way).
    expect(first.getAttribute("aInfo").array).toBe(a.info);
    expect(second.getAttribute("aInfo").array).toBe(b.info);
    expect((first.getAttribute("aStart") as InterleavedBufferAttribute).data.array).toBe(a.pos);
    expect((second.getAttribute("aStart") as InterleavedBufferAttribute).data.array).toBe(b.pos);
    expect(first.instanceCount).toBe(5);
    expect(first.getAttribute("position")).toBe(box.getAttribute("position"));
    expect(box.getAttribute("aStart")).toBeUndefined();
  });
});

describe("a long print with Orca's markers", () => {
  it("is read from the first layer, in order, in batches the viewer can take", async () => {
    // Orca's "; CHANGE_LAYER" / "; Z_HEIGHT:" markers, 200 layers of 220 short lines: well over one 40 000-segment batch.
    const lines = ["; EXECUTABLE_BLOCK_START", "M83", "G90"];
    for (let layer = 0; layer < 200; layer++) {
      const z = ((layer + 1) * 0.2).toFixed(1);
      lines.push("; CHANGE_LAYER", `; Z_HEIGHT: ${z}`, "; LAYER_HEIGHT: 0.2", `G1 Z${z}`, "; FEATURE: Outer wall");
      lines.push("G1 X100 Y100 F3000");
      for (let i = 1; i <= 220; i++) lines.push(`G1 X${100 + (i % 2 ? i : -i) * 0.5} Y${100 + i} E.05`);
    }
    const gcode = lines.join("\n");
    expect(gcode.length).toBeGreaterThan(0);
    const { zipSync, strToU8 } = await import("fflate");
    const file = zipSync({ "Metadata/plate_1.gcode": strToU8(gcode) });
    const batches: number[][] = [];
    let batch: number[] = [];
    let n = 0;
    await readToolpaths(new Blob([file as BlobPart]), {
      plate: 1,
      keepLayers: false,
      onLayer: (l) => {
        batch.push(l.index);
        n += l.count;
        if (n >= 40_000) {
          batches.push(batch);
          batch = [];
          n = 0;
        }
      },
    });
    batches.push(batch);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });
});
