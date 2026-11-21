import { strToU8, unzipSync, Zip, ZipDeflate, ZipPassThrough, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { tugboatFile } from "../../e2e/fixtures/gcode-tugboat.ts";
import { partsSlicerFile } from "../../e2e/fixtures/slicer-file.ts";
import { readToolpaths } from "../../src/shared/gcode/read-file.ts";
import { plateToolpaths, type RangedSource, streamToolpaths } from "../../src/worker/guest/toolpaths.ts";

/**
 * The shared page's 3D view gets a plate's toolpaths, not the file (decision 0077): a zip of its own with that plate's
 * G-code and what the viewer reads beside it, copied by range from the stored file. It must read exactly as the whole
 * file does in the viewer's own reader, and must not carry the model.
 */

/** Bytes in memory, read by range as R2 is, counting what is read. */
function source(bytes: Uint8Array) {
  const reads: number[] = [];
  const ranged: RangedSource = {
    size: bytes.length,
    read: async (offset, length) => {
      reads.push(length);
      return bytes.slice(offset, offset + length);
    },
    stream: async (offset, length) => {
      reads.push(length);
      const part = bytes.slice(offset, offset + length);
      // In two pieces, as a network stream comes.
      const half = Math.floor(part.length / 2);
      return new ReadableStream({
        start(controller) {
          controller.enqueue(part.subarray(0, half));
          controller.enqueue(part.subarray(half));
          controller.close();
        },
      });
    },
  };
  return { ranged, reads };
}

async function repack(bytes: Uint8Array, plate: number) {
  const { ranged, reads } = source(bytes);
  const toolpaths = await plateToolpaths(ranged, plate);
  if (!toolpaths) return { out: null, reads };
  const out = new Uint8Array(await new Response(streamToolpaths(ranged, toolpaths)).arrayBuffer());
  expect(out.length).toBe(toolpaths.size);
  return { out, reads };
}

const read = (bytes: Uint8Array, plate: number) =>
  readToolpaths(new Blob([new Uint8Array(bytes)]), { plate, keepLayers: true, maxSegments: 2_000_000 });

describe("a plate's toolpaths for a guest", () => {
  it("reads exactly as the whole file does, without the model's mesh or any other part", async () => {
    const file = tugboatFile();
    const { out } = await repack(file, 1);
    expect(out).not.toBeNull();
    const names = Object.keys(unzipSync(out as Uint8Array)).sort();
    expect(names).toEqual(["Metadata/plate_1.gcode", "Metadata/project_settings.config", "Metadata/slice_info.config"]);
    const whole = await read(file, 1);
    const part = await read(out as Uint8Array, 1);
    expect(part.layers.length).toBe(whole.layers.length);
    expect(part.stats.layers).toBe(whole.stats.layers);
    expect(part.totalSeconds).toBe(whole.totalSeconds);
    expect(part.filaments).toEqual(whole.filaments);
    expect(part.layers.at(-1)?.count).toBe(whole.layers.at(-1)?.count);
    // Smaller than the file: the picture and the mesh stayed behind.
    expect((out as Uint8Array).length).toBeLessThan(file.length);
  });

  it("keeps only the plate asked for, and has nothing for a plate the file doesn't have", async () => {
    const plate = (n: number) =>
      strToU8(`; HEADER_BLOCK_START\n; total estimated time: ${n}m\n; HEADER_BLOCK_END\nG28\n`);
    const file = zipSync({
      "3D/3dmodel.model": strToU8("<model/>"),
      "Metadata/plate_1.png": partsSlicerFile().subarray(0, 64),
      "Metadata/plate_1.gcode": plate(1),
      "Metadata/plate_2.gcode": plate(2),
      "Metadata/slice_info.config": strToU8("<config/>"),
    });
    const { out } = await repack(file, 2);
    expect(Object.keys(unzipSync(out as Uint8Array)).sort()).toEqual([
      "Metadata/plate_2.gcode",
      "Metadata/slice_info.config",
    ]);
    expect((await repack(file, 7)).out).toBeNull();
    // A slicer's own file of two plates with G-code for the first: the first, without the pictures or the mesh.
    const steamer = Object.keys(unzipSync((await repack(partsSlicerFile(), 1)).out as Uint8Array));
    expect(steamer.some((name) => name.startsWith("3D/") || name.endsWith(".png"))).toBe(false);
    expect((await repack(partsSlicerFile(), 2)).out).toBeNull();
  });

  it("copies the stored file's data by range, never the whole of it", async () => {
    const file = tugboatFile();
    const { reads } = await repack(file, 1);
    expect(Math.max(...reads)).toBeLessThan(file.length);
  });

  it("reads a zip whose entries are followed by data descriptors (a streamed export) and stored entries", async () => {
    const gcode = strToU8(
      `; HEADER_BLOCK_START\n; total estimated time: 2m\n; HEADER_BLOCK_END\n${"G1 X1 Y1\n".repeat(50)}`,
    );
    const parts: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => {
      if (error) throw error;
      parts.push(chunk);
    });
    const deflated = new ZipDeflate("Metadata/plate_1.gcode", { level: 6 });
    zip.add(deflated);
    deflated.push(gcode, true);
    const stored = new ZipPassThrough("Metadata/slice_info.config");
    zip.add(stored);
    stored.push(strToU8("<config/>"), true);
    const mesh = new ZipPassThrough("3D/3dmodel.model");
    zip.add(mesh);
    mesh.push(strToU8("<model>secret mesh</model>"), true);
    zip.end();
    const bytes = new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer());
    const { out } = await repack(bytes, 1);
    const files = unzipSync(out as Uint8Array);
    expect(new TextDecoder().decode(files["Metadata/plate_1.gcode"])).toBe(new TextDecoder().decode(gcode));
    expect(new TextDecoder().decode(files["Metadata/slice_info.config"])).toBe("<config/>");
    expect(files["3D/3dmodel.model"]).toBeUndefined();
    expect(new TextDecoder().decode(out as Uint8Array)).not.toContain("secret mesh");
  });

  it("has nothing for bytes that aren't a zip, or a zip with no G-code", async () => {
    expect((await repack(strToU8("solid cube\nendsolid cube\n"), 1)).out).toBeNull();
    expect((await repack(new Uint8Array(10), 1)).out).toBeNull();
    expect((await repack(zipSync({ "3D/3dmodel.model": strToU8("<model/>") }), 1)).out).toBeNull();
  });
});
