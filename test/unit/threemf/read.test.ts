import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import type { Plate, ThreeMfResult } from "../../../src/shared/threemf/index.ts";
import { readThreeMf, readThreeMfFile } from "../../../src/shared/threemf/index.ts";
import { modelHead, PNG, PNG_2, plateJson, slicedFiles, zip } from "./fixtures.ts";

const plateAt = (r: ThreeMfResult, i: number): Plate => {
  const p = r.plates[i];
  if (!p) throw new Error(`no plate ${i}`);
  return p;
};

describe("sliced multi-plate, multi-filament file (Bambu Studio)", () => {
  const r = readThreeMf(zip(slicedFiles()));

  it("is recognised as sliced, with the slicer", () => {
    expect(r.kind).toBe("sliced");
    expect(r.slicer).toEqual({ name: "BambuStudio", version: "02.01.00.00" });
    expect(r.warnings).toEqual([]);
  });

  it("reads plate stats, names, thumbnails and objects", () => {
    expect(r.plates.map((p) => p.index)).toEqual([1, 2]);
    const p1 = plateAt(r, 0);
    const p2 = plateAt(r, 1);
    expect(p1).toMatchObject({ name: "Hull", predictedSeconds: 5400, weightGrams: 23.45, supportUsed: false });
    expect(p1.thumbnail).toEqual({ bytes: PNG, mediaType: "image/png" });
    expect(p1.objects).toEqual([{ name: "Benchy & friends" }, { name: "Lid", skipped: true }]);
    expect(p1.bedType).toBe("Textured PEI Plate");
    expect(p1.nozzleDiameter).toBe(0.4);
    expect(p2.name).toBeUndefined();
    expect(p2.predictedSeconds).toBe(720.5);
    expect(p2.supportUsed).toBe(true);
    expect(p2.thumbnail?.bytes).toEqual(PNG_2);
  });

  it("reads the filaments each plate really used, sorted by slot, with colors", () => {
    expect(plateAt(r, 0).filaments).toEqual([
      {
        slot: 1,
        type: "PLA",
        colorHex: "#00ae42",
        usedGrams: 18.95,
        usedMeters: 6.3,
        profile: "Bambu PLA Basic @BBL X2D",
      },
      { slot: 2, type: "PLA", colorHex: "#ffffff", usedGrams: 4.5, usedMeters: 1.5, profile: "Generic PLA" },
    ]);
    expect(plateAt(r, 1).filaments).toEqual([
      { slot: 3, type: "PETG", colorHex: "#c12e1f", usedGrams: 3.1, usedMeters: 1, profile: "Bambu PETG HF" },
    ]);
  });

  it("reads the settings", () => {
    expect(r.settings).toEqual({
      printerModel: "Bambu Lab X2D",
      printerPreset: "Bambu Lab X2D 0.4 nozzle",
      processPreset: "0.20mm Standard @BBL X2D",
      layerHeight: 0.2,
      initialLayerHeight: 0.2,
      infillDensity: 15,
      infillPattern: "grid",
      wallLoops: 3,
      supportEnabled: false,
      supportType: "normal(auto)",
      nozzleTemperature: [220, 220, 255],
      nozzleTemperatureInitialLayer: [220, 220, 255],
      bedTemperature: [55, 55, 70],
      bedType: "Textured PEI Plate",
      nozzleDiameter: 0.4,
    });
  });

  it("never unpacks the G-code", () => {
    const files = slicedFiles();
    files["Metadata/plate_1.gcode"] = new Uint8Array(30 * 1024 * 1024).fill(59);
    const t0 = performance.now();
    const big = readThreeMf(zip(files));
    expect(big.kind).toBe("sliced");
    expect(big.warnings).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe("project file without slice info", () => {
  const files = slicedFiles();
  delete files["Metadata/slice_info.config"];
  delete files["Metadata/plate_1.json"];
  const r = readThreeMf(zip(files));

  it("is a project, with plates from model_settings", () => {
    expect(r.kind).toBe("project");
    expect(r.plates.map((p) => [p.index, p.name, p.objects.map((o) => o.name)])).toEqual([
      [1, "Hull", ["Benchy & friends", "Lid"]],
      [2, undefined, ["Spool holder"]],
    ]);
    expect(plateAt(r, 0).predictedSeconds).toBeUndefined();
    expect(plateAt(r, 0).weightGrams).toBeUndefined();
  });

  it("guesses filaments from the objects' extruders and the project's filament lists", () => {
    expect(plateAt(r, 0).filaments).toEqual([
      { slot: 1, type: "PLA", colorHex: "#00ae42", profile: "Bambu PLA Basic @BBL X2D" },
      { slot: 2, type: "PLA", colorHex: "#ffffff", profile: "Generic PLA" },
    ]);
    // An object with no extruder metadata uses filament 1.
    expect(plateAt(r, 1).filaments.map((f) => f.slot)).toEqual([1]);
    expect(r.settings.layerHeight).toBe(0.2);
  });
});

describe("Orca Slicer file", () => {
  const files = {
    "3D/3dmodel.model": modelHead("OrcaSlicer-2.3.1"),
    "Metadata/slice_info.config": `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="02.03.01.00"/>
  </header>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="printer_model_id" value="BL-P001"/>
    <metadata key="nozzle_diameters" value="0.4"/>
    <metadata key="prediction" value="3030"/>
    <metadata key="weight" value="9.87"/>
    <object identify_id="12" name="Phone stand" skipped="false"/>
    <filament id="1" tray_info_idx="GFL99" type="PLA" color="#898989" used_m="3.2" used_g="9.87" />
  </plate>
</config>`,
    "Metadata/project_settings.config": JSON.stringify({
      printer_model: "Bambu Lab P1S",
      print_settings_id: "0.16mm Optimal @BBL X1C",
      layer_height: "0.16",
      sparse_infill_density: "20%",
      sparse_infill_pattern: "gyroid",
      wall_loops: "2",
      enable_support: "1",
      curr_bed_type: "Cool Plate",
      cool_plate_temp: ["35"],
      nozzle_temperature: ["210"],
      nozzle_diameter: ["0.4", "0.4"],
      filament_colour: ["#898989"],
      filament_type: ["PLA"],
    }),
    "Metadata/plate_1.png": PNG,
    "Metadata/plate_1.json": plateJson("Cool Plate"),
  };
  const r = readThreeMf(zip(files));

  it("reads it like a Bambu file", () => {
    expect(r.kind).toBe("sliced");
    expect(r.slicer).toEqual({ name: "OrcaSlicer", version: "2.3.1" });
    expect(r.plates).toHaveLength(1);
    expect(plateAt(r, 0)).toMatchObject({ index: 1, predictedSeconds: 3030, weightGrams: 9.87, bedType: "Cool Plate" });
    expect(plateAt(r, 0).filaments.at(0)).toMatchObject({ slot: 1, type: "PLA", colorHex: "#898989", usedGrams: 9.87 });
    expect(r.settings).toMatchObject({
      printerModel: "Bambu Lab P1S",
      infillPattern: "gyroid",
      supportEnabled: true,
      bedTemperature: [35],
      nozzleTemperature: [210],
    });
  });
});

describe("broken and foreign input", () => {
  it("returns a warning for bytes that are not a zip", () => {
    const r = readThreeMf(strToU8("definitely not a zip file"));
    expect(r.kind).toBe("unknown");
    expect(r.plates).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("handles empty input and ArrayBuffer input", () => {
    expect(readThreeMf(new Uint8Array(0)).kind).toBe("unknown");
    const buf = zip(slicedFiles());
    expect(readThreeMf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer).kind).toBe(
      "sliced",
    );
  });

  it("treats a plain 3MF from another tool as unknown", () => {
    const r = readThreeMf(zip({ "3D/3dmodel.model": modelHead("Fusion 360"), "[Content_Types].xml": "<Types/>" }));
    expect(r.kind).toBe("unknown");
    expect(r.slicer).toEqual({ name: "Fusion 360" });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("keeps what it can when files are damaged", () => {
    const files = slicedFiles();
    files["Metadata/project_settings.config"] = '{"layer_height": "0.2", ';
    files["Metadata/model_settings.config"] = '<config><plate><metadata key="plater_id" value="1"/><metadata key="plat';
    files["Metadata/plate_1.json"] = "nope";
    const r = readThreeMf(zip(files));
    expect(r.kind).toBe("sliced");
    expect(plateAt(r, 0).predictedSeconds).toBe(5400);
    expect(r.settings).toEqual({});
    expect(r.warnings.some((w) => w.includes("project_settings.config"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("model_settings.config"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("plate_1.json"))).toBe(true);
  });

  it("ignores unknown keys, bad numbers and bad colors", () => {
    const files = slicedFiles();
    files["Metadata/slice_info.config"] = `<config><plate>
      <metadata key="index" value="1"/><metadata key="prediction" value="soon"/><metadata key="weight" value="NaN"/>
      <metadata key="who_knows" value="x"/>
      <filament id="1" type="PLA" color="green" used_g="lots" fancy="yes"/>
      <filament id="zero" type="ABS"/>
      </plate><plate><metadata key="index" value="oops"/></plate></config>`;
    const r = readThreeMf(zip(files));
    expect(plateAt(r, 0).predictedSeconds).toBeUndefined();
    expect(plateAt(r, 0).weightGrams).toBeUndefined();
    expect(plateAt(r, 0).filaments).toHaveLength(1);
    expect(plateAt(r, 0).filaments.at(0)?.colorHex).toBe("#00ae42"); // falls back to the project color
    expect(plateAt(r, 0).filaments.at(0)?.usedGrams).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("no valid index"))).toBe(true);
  });

  it("does not take a non-image file for a thumbnail", () => {
    const files = slicedFiles();
    files["Metadata/plate_1.png"] = strToU8("<html>not an image</html>");
    expect(plateAt(readThreeMf(zip(files)), 0).thumbnail).toBeUndefined();
  });

  it("caps what it unpacks per entry (zip bomb)", () => {
    const files = slicedFiles();
    // ~64 MB of spaces compress to a few tens of KB.
    files["Metadata/project_settings.config"] = new Uint8Array(64 * 1024 * 1024).fill(32);
    const bytes = zip(files);
    expect(bytes.length).toBeLessThan(1024 * 1024);
    const t0 = performance.now();
    const r = readThreeMf(bytes);
    expect(r.warnings.some((w) => w.includes("project_settings.config") && w.includes("more than"))).toBe(true);
    expect(r.settings).toEqual({});
    expect(plateAt(r, 0).predictedSeconds).toBe(5400);
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it("survives a truncated archive", () => {
    const bytes = zip(slicedFiles());
    const r = readThreeMf(bytes.subarray(0, Math.floor(bytes.length / 2)));
    expect(r.plates.length).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(r.warnings)).toBe(true);
  });

  it("reads from a Blob", async () => {
    const r = await readThreeMfFile(new Blob([zip(slicedFiles()) as BlobPart]));
    expect(r.kind).toBe("sliced");
  });

  it("does not expand XML entities from a DOCTYPE", () => {
    const files = slicedFiles();
    files["Metadata/model_settings.config"] =
      '<!DOCTYPE c [<!ENTITY x "AAAA">]><config><plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value="&x;"/></plate></config>';
    expect(plateAt(readThreeMf(zip(files)), 0).name).toBe("&x;");
  });
});

describe("many plates", () => {
  it("keeps the first plates and warns, instead of failing", () => {
    const plates = Array.from(
      { length: 80 },
      (_, i) => `<plate><metadata key="index" value="${i + 1}"/><metadata key="prediction" value="60"/></plate>`,
    ).join("");
    const files = slicedFiles();
    files["Metadata/slice_info.config"] = `<config>${plates}</config>`;
    const r = readThreeMf(zip(files));
    expect(r.kind).toBe("sliced");
    expect(r.plates).toHaveLength(64);
    expect(r.warnings.some((w) => w.includes("plates"))).toBe(true);
  });
});
