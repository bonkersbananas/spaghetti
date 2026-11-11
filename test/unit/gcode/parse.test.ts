import { describe, expect, it } from "vitest";
import { tugboatFile, tugboatGcode } from "../../../e2e/fixtures/gcode-tugboat.ts";
import { FEATURES, GcodeReader, parseDuration, parseGcode, readToolpaths } from "../../../src/shared/gcode/index.ts";

const feat = (name: string) => FEATURES.indexOf(name as (typeof FEATURES)[number]);

describe("parseDuration", () => {
  it("reads Bambu's durations", () => {
    expect(parseDuration(" 1h 12m 3s")).toBe(4323);
    expect(parseDuration("2d 1h")).toBe(176400);
    expect(parseDuration("45m")).toBe(2700);
    expect(parseDuration("soon")).toBeNull();
  });
});

describe("the tugboat", () => {
  const gcode = tugboatGcode();
  const paths = parseGcode(gcode);

  it("has every layer, with heights", () => {
    expect(paths.layers).toHaveLength(317);
    expect(paths.announcedLayers).toBe(317);
    expect(paths.layers[0]?.z).toBeCloseTo(0.12);
    expect(paths.layers[0]?.height).toBeCloseTo(0.12);
    expect(paths.layers[316]?.z).toBeCloseTo(38.04, 1);
  });

  it("keeps extrusion moves only: no start or end G-code, no travel", () => {
    // The start G-code draws a purge line (Custom) at x=10, the end G-code a move to y=250.
    for (const l of paths.layers) {
      for (let i = 0; i < l.count; i++) {
        const s = Array.from(l.pos.subarray(i * 6, i * 6 + 6));
        const [x0 = 0, y0 = 0, , x1 = 0, y1 = 0] = s;
        expect(x0).toBeGreaterThan(50);
        expect(y0).toBeLessThan(200);
        expect(Math.hypot(x1 - x0, y1 - y0)).toBeGreaterThan(0);
      }
    }
    expect(paths.bounds?.[2]).toBeCloseTo(0.12);
    expect(paths.bounds?.[5]).toBeCloseTo(38.04, 1);
  });

  it("tells the features apart", () => {
    const seen = new Set<number>();
    for (const l of paths.layers) for (const f of l.feature) seen.add(f);
    for (const name of [
      "Outer wall",
      "Inner wall",
      "Sparse infill",
      "Top surface",
      "Bottom surface",
      "Bridge",
      "Prime tower",
      "Skirt and brim",
    ]) {
      expect(seen.has(feat(name)), name).toBe(true);
    }
    // The first layer's walls come first in the file, the skirt even earlier.
    expect(paths.layers[0]?.feature[0]).toBe(feat("Skirt and brim"));
  });

  it("follows the filament change", () => {
    expect(paths.filaments).toHaveLength(2);
    const low = paths.layers[100];
    const high = paths.layers[300];
    expect(new Set(low?.filament)).toEqual(new Set([0]));
    // The prime tower flush and the red funnel print with filament 1.
    expect(new Set(high?.filament)).toEqual(new Set([1]));
    expect(paths.filaments.every((f) => f.segments > 0)).toBe(true);
  });

  it("reads the arcs of the funnel", () => {
    const funnel = paths.layers[310];
    const wall = [...(funnel?.feature ?? [])].filter((f) => f === feat("Outer wall")).length;
    expect(wall).toBeGreaterThan(10);
    // Everything lies on a circle of 4.5 mm round (118, 128).
    for (let i = 0; i < (funnel?.count ?? 0); i++) {
      const [x0 = 0, y0 = 0] = funnel?.pos.subarray(i * 6, i * 6 + 6) ?? [];
      if (funnel?.feature[i] !== feat("Outer wall")) continue;
      expect(Math.hypot(x0 - 118, y0 - 128)).toBeCloseTo(4.5, 1);
    }
  });

  it("knows when each layer starts", () => {
    expect(paths.totalSeconds).toBe(12000);
    expect(paths.layers[0]?.seconds).toBe(0);
    const mid = paths.layers[158]?.seconds ?? 0;
    expect(mid).toBeGreaterThan(5000);
    expect(mid).toBeLessThan(7000);
    expect(paths.layers[316]?.seconds).toBeGreaterThan(11000);
  });

  it("reads the same whatever the chunking", () => {
    const r = new GcodeReader({ sourceBytes: gcode.length });
    for (let i = 0; i < gcode.length; i += 997) r.write(gcode.slice(i, i + 997));
    const chunked = r.end();
    expect(chunked.stats.segments).toBe(paths.stats.segments);
    expect(chunked.layers[200]?.pos).toEqual(paths.layers[200]?.pos);
  });

  it("hands each layer over as it finishes", () => {
    const got: number[] = [];
    parseGcode(gcode, { onLayer: (l) => got.push(l.index) });
    expect(got).toHaveLength(317);
    expect(got[5]).toBe(5);
  });
});

describe("small files", () => {
  it("ignores absolute extrusion's retracts and pure E moves", () => {
    const paths = parseGcode(
      [
        "M82",
        "G92 E0",
        ";LAYER_CHANGE",
        ";Z:0.2",
        ";HEIGHT:0.2",
        ";TYPE:External perimeter",
        "G1 X10 Y10 F3000",
        "G1 X20 Y10 E1",
        "G1 E0.2", // retract in place
        "G1 X30 Y10 E0.2", // travel with the retract still in effect
        "G1 X40 Y10 E1.2", // extrudes again
        "G92 E0",
        "G1 X50 Y10 E1",
      ].join("\n"),
    );
    expect(paths.layers).toHaveLength(1);
    const l = paths.layers[0];
    // 10→20 and 30→40 and 40→50 (the first and last are collinear but split by travel/feature rules).
    expect(l?.feature[0]).toBe(feat("Outer wall"));
    expect(l?.z).toBe(0.2);
    expect(l && Math.max(...l.pos.filter((_, i) => i % 6 === 3))).toBe(50);
    expect(l && Math.min(...l.pos.filter((_, i) => i % 6 === 0))).toBe(10);
  });

  it("merges collinear segments, and keeps corners", () => {
    const paths = parseGcode(
      [
        ";LAYER_CHANGE",
        ";Z:0.2",
        ";HEIGHT:0.2",
        "G1 X0 Y0",
        "G1 X1 Y0 E.1",
        "G1 X2 Y0 E.1",
        "G1 X3 Y0 E.1",
        "G1 X3 Y3 E.1",
      ].join("\n"),
    );
    expect(paths.layers[0]?.count).toBe(2);
  });

  it("says so when there are no layers", () => {
    expect(parseGcode("G28\nG1 X1 Y1 E1\n").warnings[0]).toMatch(/no layer markers/);
  });

  it("takes the total time from Orca's header too", () => {
    const paths = parseGcode(
      "; estimated printing time (normal mode) = 1h 5m 0s\n;LAYER_CHANGE\n;Z:0.2\n;HEIGHT:0.2\nG1 X1 Y1\nG1 X2 Y2 E1\n",
    );
    expect(paths.totalSeconds).toBe(3900);
  });

  it("reads a tool change with M620/M621 alone", () => {
    const paths = parseGcode(
      [
        "; CHANGE_LAYER",
        "; Z_HEIGHT: 0.2",
        "; LAYER_HEIGHT: 0.2",
        "G1 X0 Y0",
        "G1 X10 Y0 E1",
        "M620 S2A",
        "M621 S2A",
        "G1 X10 Y10 E1",
        "T255",
      ].join("\n"),
    );
    expect([...(paths.layers[0]?.filament ?? [])]).toEqual([0, 2]);
    expect(paths.filaments).toHaveLength(3);
  });
});

describe("big files", () => {
  /** About `mb` megabytes of infill-heavy G-code. */
  function big(mb: number): string {
    const lines: string[] = [];
    let size = 0;
    for (let layer = 0; size < mb * 1e6; layer++) {
      lines.push(
        "; CHANGE_LAYER",
        `; Z_HEIGHT: ${(layer + 1) * 0.1}`,
        "; LAYER_HEIGHT: 0.1",
        "; FEATURE: Sparse infill",
      );
      size += 80;
      for (let i = 0; i < 4000; i++) {
        const x = 20 + (i % 200);
        const y = 20 + Math.floor(i / 200) * 2 + (layer % 2);
        lines.push(`G1 X${x}.123 Y${y}.456 E.0123 F9000`);
        // A short zigzag every few lines, like curved infill.
        lines.push(`G1 X${x}.223 Y${y}.496 E.0023`);
        size += 70;
      }
    }
    return lines.join("\n");
  }

  it("decimates a large file so it stays small", () => {
    const text = big(30);
    const t = Date.now();
    const paths = parseGcode(text, { maxSegments: 50_000 });
    expect(paths.stats.decimated).toBe(true);
    expect(paths.stats.segments).toBeLessThanOrEqual(50_000);
    expect(paths.stats.moves).toBeGreaterThan(paths.stats.segments);
    expect(paths.layers.length).toBeGreaterThan(5);
    expect(Date.now() - t).toBeLessThan(20_000);
  });
});

describe("readToolpaths", () => {
  it("streams a .gcode.3mf and colours the filaments from the file", async () => {
    const blob = new Blob([tugboatFile() as BlobPart]);
    const progress: number[] = [];
    const paths = await readToolpaths(blob, { onProgress: (p) => progress.push(p) });
    expect(paths.plate).toBe(1);
    expect(paths.layers).toHaveLength(317);
    expect(paths.filaments.map((f) => f.color)).toEqual(["#24476b", "#c8432f"]);
    expect(paths.filaments[0]?.type).toBe("PLA");
    expect(paths.totalSeconds).toBe(12000);
    expect(paths.stats.sourceBytes).toBe(blob.size);
    expect(progress.at(-1)).toBe(1);
  });

  it("falls back to the slice's colours, then to the spools'", async () => {
    const noProject = tugboatFile({ colors: false });
    const sliceOnly = await readToolpaths(new Blob([noProject as BlobPart]));
    expect(sliceOnly.filaments.map((f) => f.color)).toEqual(["#24476b", "#c8432f"]);
  });

  it("uses the spools' colours when the file has none", async () => {
    // Remove the colours from both lists by a file whose settings carry none.
    const { zipSync, strToU8, unzipSync } = await import("fflate");
    const parts = unzipSync(tugboatFile() as Uint8Array);
    parts["Metadata/slice_info.config"] = strToU8(
      new TextDecoder().decode(parts["Metadata/slice_info.config"]).replace(/ color="[^"]*"/g, ""),
    );
    parts["Metadata/project_settings.config"] = strToU8("{}");
    const paths = await readToolpaths(new Blob([zipSync(parts) as BlobPart]), {
      fallbackColors: ["#112233", "#445566FF"],
    });
    expect(paths.filaments.map((f) => f.color)).toEqual(["#112233", "#445566"]);
    const bare = await readToolpaths(new Blob([zipSync(parts) as BlobPart]));
    expect(bare.filaments.map((f) => f.color)).toEqual([null, null]);
  });

  it("says so for a file with no G-code", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    const project = zipSync({ "3D/3dmodel.model": strToU8("<model/>") });
    await expect(readToolpaths(new Blob([project as BlobPart]))).rejects.toThrow(/no G-code/);
    await expect(readToolpaths(new Blob(["not a zip"]))).rejects.toThrow();
  });
});
