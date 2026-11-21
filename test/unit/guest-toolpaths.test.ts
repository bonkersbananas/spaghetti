import { crc32 } from "node:zlib";
import { strToU8, unzipSync, Zip, ZipDeflate, ZipPassThrough, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { tugboatFile, tugboatGcode } from "../../e2e/fixtures/gcode-tugboat.ts";
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

/**
 * A crafted zip: its central directory lists `name`'s record `times` times over (the copies named `as`, if given),
 * every copy pointing at the same data, as a hostile upload could.
 */
function listedOften(zip: Uint8Array, name: string, times: number, as = name): Uint8Array {
  const data = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  const count = data.getUint16(end + 10, true);
  const start = data.getUint32(end + 16, true);
  const records: Uint8Array[] = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    const length = 46 + data.getUint16(at + 28, true) + data.getUint16(at + 30, true) + data.getUint16(at + 32, true);
    const record = zip.slice(at, at + length);
    records.push(record);
    if (new TextDecoder().decode(record.subarray(46, 46 + data.getUint16(at + 28, true))) === name) {
      const copy = strToU8(as);
      for (let n = 1; n < times; n++) {
        const renamed = new Uint8Array(46 + copy.length);
        renamed.set(record.subarray(0, 46));
        new DataView(renamed.buffer).setUint16(28, copy.length, true);
        new DataView(renamed.buffer).setUint16(30, 0, true);
        new DataView(renamed.buffer).setUint16(32, 0, true);
        renamed.set(copy, 46);
        records.push(renamed);
      }
    }
    at += length;
  }
  const directory = new Uint8Array(records.reduce((total, record) => total + record.length, 0));
  let offset = 0;
  for (const record of records) {
    directory.set(record, offset);
    offset += record.length;
  }
  const tail = zip.slice(end);
  const eocd = new DataView(tail.buffer);
  eocd.setUint16(8, records.length, true);
  eocd.setUint16(10, records.length, true);
  eocd.setUint32(12, directory.length, true);
  const out = new Uint8Array(start + directory.length + tail.length);
  out.set(zip.subarray(0, start));
  out.set(directory, start);
  out.set(tail, start + directory.length);
  return out;
}

/** A zip's entries as written, walking its local headers: name, method, CRC and data. */
function localEntries(zip: Uint8Array) {
  const data = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out: { name: string; method: number; crc: number; data: Uint8Array }[] = [];
  let at = 0;
  while (data.getUint32(at, true) === 0x04034b50) {
    const length = data.getUint32(at + 18, true);
    const start = at + 30 + data.getUint16(at + 26, true) + data.getUint16(at + 28, true);
    out.push({
      name: new TextDecoder().decode(zip.subarray(at + 30, at + 30 + data.getUint16(at + 26, true))),
      method: data.getUint16(at + 8, true),
      crc: data.getUint32(at + 14, true),
      data: zip.subarray(start, start + length),
    });
    at = start + length;
  }
  return out;
}

/** A desktop slicer's file as a hostile or careless upload has it: a print host's secrets, a home folder, two plates. */
function desktopFile() {
  // The tugboat's two filaments, at 1 mm layers so the test stays quick.
  const gcode = (_plate: number) => strToU8(tugboatGcode({ layerHeight: 1 }));
  const project = {
    filament_colour: ["#F4C430FF", "#2E5E4E"],
    filament_type: ["PLA", "PETG-CF"],
    filament_map: ["1", "2"],
    filament_settings_id: ["Marie's silk PLA", "Bambu PETG-CF @BBL X2D"],
    print_host: "192.168.1.20",
    printhost_user: "marie",
    printhost_password: "hunter2-password",
    printhost_apikey: "secret-api-key",
    post_process: ["C:\\Users\\marie.svensson\\scripts\\tidy.py"],
    printer_notes: "Kitchen printer, the one by the window",
  };
  const plateBlock = (n: number, object: string) =>
    `<plate>\n <metadata key="index" value="${n}"/>\n <metadata key="prediction" value="${n * 61.4}"/>\n <metadata key="filament_maps" value="1 2"/>\n <object identify_id="9${n}" name="${object}" skipped="false" />\n <filament id="1" tray_info_idx="GFA00" type="PLA" color="#F4C430" used_m="1.2" used_g="3.4" />\n <filament id="2" tray_info_idx="GFG98" type="PETG-CF" color="#2E5E4E" used_m="0.5" used_g="1.1" />\n <warning msg="bed_temperature_too_high_than_filament" level="1" error_code ="1000C001"  />\n</plate>`;
  return zipSync({
    "3D/3dmodel.model": strToU8("<model>licensed mesh</model>"),
    "Metadata/plate_1.gcode": gcode(1),
    "Metadata/plate_2.gcode": gcode(2),
    "Metadata/slice_info.config": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n <header><header_item key="X-BBL-Client-Version" value="02.03.00.70"/></header>\n${plateBlock(1, "Birthday gift for Alex")}\n${plateBlock(2, "Secret second plate")}\n</config>\n`,
    ),
    "Metadata/project_settings.config": strToU8(JSON.stringify(project)),
    "Metadata/model_settings.config": strToU8(
      '<config><plate><metadata key="plater_name" value="Alex"/></plate></config>',
    ),
  });
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
    expect(new TextDecoder().decode(files["Metadata/slice_info.config"])).toContain(
      '<metadata key="index" value="1"/>',
    );
    expect(files["3D/3dmodel.model"]).toBeUndefined();
    expect(new TextDecoder().decode(out as Uint8Array)).not.toContain("secret mesh");
  });

  it("writes the configs anew, stored, with only what the viewer reads of this plate", async () => {
    const file = desktopFile();
    const { out } = await repack(file, 1);
    const entries = localEntries(out as Uint8Array);
    expect(entries.map((entry) => entry.name)).toEqual([
      "Metadata/plate_1.gcode",
      "Metadata/slice_info.config",
      "Metadata/project_settings.config",
    ]);
    // The configs are stored, with their own CRC, so anything can unzip them.
    for (const entry of entries.slice(1)) {
      expect(entry.method, entry.name).toBe(0);
      expect(entry.crc, entry.name).toBe(crc32(entry.data));
    }
    const text = new TextDecoder().decode(out as Uint8Array);
    for (const secret of [
      "printhost",
      "print_host",
      "hunter2",
      "secret-api-key",
      "Users",
      "marie",
      "Marie",
      "window",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    // Only this plate's block, without its objects' names or the slicer's warnings.
    for (const other of ["Alex", "Secret second plate", "identify_id", "warning", "X-BBL-Client-Version"]) {
      expect(text, other).not.toContain(other);
    }
    const files = unzipSync(out as Uint8Array);
    expect(JSON.parse(new TextDecoder().decode(files["Metadata/project_settings.config"]))).toEqual({
      filament_colour: ["#f4c430", "#2e5e4e"],
      filament_type: ["PLA", "PETG-CF"],
      filament_map: ["1", "2"],
    });
    // And the view reads it exactly as it reads the whole file.
    const whole = await read(file, 1);
    const part = await read(out as Uint8Array, 1);
    expect(part.filaments).toEqual(whole.filaments);
    expect(part.filaments.map((f) => f.color)).toEqual(["#f4c430", "#2e5e4e"]);
    expect(part.totalSeconds).toBe(whole.totalSeconds);
    expect(part.layers.length).toBe(whole.layers.length);
  });

  it("leaves out a config that unpacks past a megabyte, or that can't be read, and still has the plate", async () => {
    const big = zipSync({
      "Metadata/plate_1.gcode": strToU8("; HEADER_BLOCK_START\n; HEADER_BLOCK_END\nG28\n"),
      // 8 MB of spaces packs into a few kilobytes: a crafted file's way to make the Worker inflate a lot.
      "Metadata/project_settings.config": strToU8(`{"filament_colour":["#ffffff"]${" ".repeat(8 * 1024 * 1024)}}`),
      "Metadata/slice_info.config": strToU8("<config/>"),
    });
    expect(big.length).toBeLessThan(100_000);
    const { out } = await repack(big, 1);
    expect(Object.keys(unzipSync(out as Uint8Array)).sort()).toEqual([
      "Metadata/plate_1.gcode",
      "Metadata/slice_info.config",
    ]);
    const broken = zipSync({
      "Metadata/plate_1.gcode": strToU8("; HEADER_BLOCK_START\n; HEADER_BLOCK_END\nG28\n"),
      "Metadata/project_settings.config": strToU8("not json, just a slicer's notes"),
    });
    expect(Object.keys(unzipSync((await repack(broken, 1)).out as Uint8Array))).toEqual(["Metadata/plate_1.gcode"]);
  });

  it("has nothing for a directory that lists an entry more than once, and reads only a few ranges to find out", async () => {
    const file = zipSync({
      "Metadata/plate_1.gcode": strToU8("; HEADER_BLOCK_START\n; HEADER_BLOCK_END\nG28\n"),
      "Metadata/slice_info.config": strToU8("<config/>"),
    });
    for (const name of ["Metadata/plate_1.gcode", "Metadata/slice_info.config"]) {
      const { out, reads } = await repack(listedOften(file, name, 5000), 1);
      expect(out).toBeNull();
      expect(reads.length).toBeLessThan(5);
    }
    // The same name written another way (a backslash, a leading slash) is the same entry.
    expect(
      (await repack(listedOften(file, "Metadata/plate_1.gcode", 2, "\\Metadata\\plate_1.gcode"), 1)).out,
    ).toBeNull();
  });

  it("has nothing for bytes that aren't a zip, or a zip with no G-code", async () => {
    expect((await repack(strToU8("solid cube\nendsolid cube\n"), 1)).out).toBeNull();
    expect((await repack(new Uint8Array(10), 1)).out).toBeNull();
    expect((await repack(zipSync({ "3D/3dmodel.model": strToU8("<model/>") }), 1)).out).toBeNull();
  });
});
