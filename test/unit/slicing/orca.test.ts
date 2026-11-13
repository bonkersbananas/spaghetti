import { describe, expect, it } from "vitest";
import { DEFAULT_SLICING } from "../../../src/shared/slicing/defaults.ts";
import type { Config } from "../../../src/shared/slicing/gcode3mf.ts";
import {
  applySlicing,
  DEFAULT_PRESETS,
  filamentPreset,
  filamentStandIn,
  machinePreset,
  orcaBedType,
  presetRecord,
  processPreset,
  readSlicing,
} from "../../../src/shared/slicing/orca.ts";
import type { SlicingSettings } from "../../../src/shared/slicing/settings.ts";
import { presets } from "./presets.ts";

const MACHINE = "Bambu Lab X2D 0.4 nozzle";
const standard = () => ({
  machine: { ...presets.machine[MACHINE] } as Config,
  process: { ...presets.process["0.20mm Standard @BBL X2D"] } as Config,
});

describe("Orca's presets for the settings", () => {
  it("name the X2D's machine preset by its nozzle", () => {
    expect(machinePreset(0.4)).toBe("Bambu Lab X2D 0.4 nozzle");
    expect(machinePreset(0.6)).toBe("Bambu Lab X2D 0.6 nozzle");
    expect(DEFAULT_PRESETS).toEqual({
      machine: "Bambu Lab X2D 0.4 nozzle",
      process: "0.20mm Standard @BBL X2D",
      filament: "Bambu PLA Basic @BBL X2D 0.4 nozzle",
    });
  });

  it("start each quality from Orca's own process for its height, Standard before High Quality", () => {
    expect(processPreset(presets, MACHINE, 0.12)).toBe("0.12mm High Quality @BBL X2D");
    expect(processPreset(presets, MACHINE, 0.2)).toBe("0.20mm Standard @BBL X2D");
    expect(processPreset(presets, MACHINE, 0.16)).toBe("0.16mm Standard @BBL X2D");
    expect(processPreset(presets, MACHINE, 0.24)).toBe("0.24mm Standard @BBL X2D");
    // Extra draft has no preset of its own: the 0.24 mm one, at 0.28.
    expect(processPreset(presets, MACHINE, 0.28)).toBe("0.24mm Standard @BBL X2D");
    expect(processPreset(presets, "Bambu Lab X2D 0.6 nozzle", 0.2)).toBeUndefined();
  });

  it("pick a filament preset by material, brand and finish", () => {
    expect(filamentPreset({ material: "PLA" }, 0.4)).toBe("Bambu PLA Basic @BBL X2D 0.4 nozzle");
    expect(filamentPreset({ material: "pla", brand: "Bambu Lab" }, 0.4)).toBe("Bambu PLA Basic @BBL X2D 0.4 nozzle");
    expect(filamentPreset({ material: "PLA", brand: "Polymaker" }, 0.4)).toBe("Generic PLA @BBL X2D 0.4 nozzle");
    expect(filamentPreset({ material: "PLA", finish: "silk" }, 0.4)).toBe("Generic PLA Silk @BBL X2D 0.4 nozzle");
    expect(filamentPreset({ material: "PLA Silk" }, 0.4)).toBe("Generic PLA Silk @BBL X2D 0.4 nozzle");
    expect(filamentPreset({ material: "PETG-CF" }, 0.4)).toBe("Generic PETG-CF @BBL X2D 0.4 nozzle");
    expect(filamentPreset({ material: "PAHT-CF" }, 0.4)).toBe("Generic PA-CF @BBL X2D 0.4 nozzle");
    expect(filamentPreset({ material: "TPE" }, 0.4)).toBe("Generic TPU @BBL X2D 0.4 nozzle");
    expect(filamentPreset({ material: "Wood" }, 0.4)).toBe("Generic PLA @BBL X2D 0.4 nozzle");
  });

  it("name each nozzle's filament presets as Bambu does: one set for the 0.6 and 0.8 mm", () => {
    expect(filamentPreset({ material: "PLA" }, 0.2)).toBe("Bambu PLA Basic @BBL X2D 0.2 nozzle");
    expect(filamentPreset({ material: "PETG" }, 0.2)).toBe("Generic PETG @BBL X2D 0.2 nozzle");
    expect(filamentPreset({ material: "PETG" }, 0.6)).toBe("Generic PETG @BBL X2D");
    expect(filamentPreset({ material: "PLA" }, 0.8)).toBe("Bambu PLA Basic @BBL X2D");
    expect(filamentPreset({ material: "TPU" }, 0.8)).toBe("Generic TPU @BBL X2D");
  });

  it("slice what the 0.2 mm nozzle has no preset for as its nearest kin, and say so", () => {
    expect(filamentPreset({ material: "PETG-CF" }, 0.2)).toBe("Generic PETG @BBL X2D 0.2 nozzle");
    expect(filamentStandIn({ material: "PETG-CF" }, 0.2)).toEqual({ material: "PETG-CF", as: "PETG" });
    expect(filamentPreset({ material: "PLA-CF" }, 0.2)).toBe("Generic PLA @BBL X2D 0.2 nozzle");
    expect(filamentPreset({ material: "PCTG" }, 0.2)).toBe("Generic PETG @BBL X2D 0.2 nozzle");
    expect(filamentPreset({ material: "TPU" }, 0.2)).toBe("Generic PLA @BBL X2D 0.2 nozzle");
    expect(filamentStandIn({ material: "TPU 95A" }, 0.2)).toEqual({ material: "TPU 95A", as: "PLA" });
    expect(filamentPreset({ material: "PA6-CF" }, 0.2)).toBe("Generic PLA @BBL X2D 0.2 nozzle");
    // Silk is Bambu's own silk PLA there: the same thing, nothing to say.
    expect(filamentPreset({ material: "PLA", finish: "silk" }, 0.2)).toBe("Bambu PLA Silk @BBL X2D 0.2 nozzle");
    expect(filamentStandIn({ material: "PLA", finish: "silk" }, 0.2)).toBeNull();
    // Every other nozzle has them all.
    expect(filamentStandIn({ material: "PETG-CF" }, 0.4)).toBeNull();
    expect(filamentStandIn({ material: "TPU" }, 0.6)).toBeNull();
    expect(filamentStandIn({ material: "PLA" }, 0.2)).toBeNull();
  });

  it("call the smooth PEI plate what Orca calls it", () => {
    expect(orcaBedType("Smooth PEI Plate")).toBe("High Temp Plate");
    expect(orcaBedType("Textured PEI Plate")).toBe("Textured PEI Plate");
  });
});

describe("settings onto Orca's keys and back", () => {
  it("leave Orca's 0.20 mm Standard as it is for the defaults, but for the plate it names none of", () => {
    const configs = standard();
    applySlicing(configs, DEFAULT_SLICING);
    expect(configs.process).toEqual(presets.process["0.20mm Standard @BBL X2D"]);
    expect(configs.machine).toEqual({ ...presets.machine[MACHINE], curr_bed_type: "Textured PEI Plate" });
  });

  it("write each setting to its keys", () => {
    const configs = standard();
    applySlicing(configs, {
      ...DEFAULT_SLICING,
      layerHeight: 0.28,
      walls: 4,
      infill: 25,
      pattern: "gyroid",
      supports: "where-needed",
      supportStyle: "tree-slim",
      brim: "on",
      plate: "Smooth PEI Plate",
    });
    expect(configs.process).toMatchObject({
      layer_height: "0.28",
      wall_loops: "4",
      sparse_infill_density: "25%",
      sparse_infill_pattern: "gyroid",
      enable_support: "1",
      support_critical_regions_only: "1",
      support_type: "tree(auto)",
      support_style: "tree_slim",
      brim_type: "outer_only",
    });
    expect(configs.machine.curr_bed_type).toBe("High Temp Plate");
  });

  it("tell Orca supports off for fins, which are the model's own, and still read back as fins", () => {
    const fins = standard();
    applySlicing(fins, { ...DEFAULT_SLICING, supports: "everywhere" });
    applySlicing(fins, { ...DEFAULT_SLICING, supports: "fins" });
    expect(fins.process).toMatchObject({ enable_support: "0" });
    expect(readSlicing({ ...fins, filaments: [{}] }, { ...DEFAULT_SLICING, supports: "fins" }).supports).toBe("fins");
    // Without being asked for fins, the same configs are just supports off.
    expect(readSlicing({ ...fins, filaments: [{}] }).supports).toBe("off");
  });

  it("say supports where needed with Orca's critical regions only, and everywhere with its usual automatic ones", () => {
    const where = standard();
    applySlicing(where, { ...DEFAULT_SLICING, supports: "where-needed" });
    expect(where.process).toMatchObject({ enable_support: "1", support_critical_regions_only: "1" });
    const everywhere = standard();
    applySlicing(everywhere, { ...DEFAULT_SLICING, supports: "everywhere", supportStyle: "snug" });
    expect(everywhere.process).toMatchObject({
      enable_support: "1",
      support_critical_regions_only: "0",
      support_type: "normal(auto)",
      support_style: "snug",
    });
    // Off leaves the rest of the supports' keys alone.
    applySlicing(everywhere, { ...DEFAULT_SLICING, supports: "off", supportStyle: "snug" });
    expect(everywhere.process).toMatchObject({ enable_support: "0", support_type: "normal(auto)" });
  });

  it("turn a project's painted supports into automatic ones when supports are turned on here", () => {
    const configs = standard();
    configs.process.support_type = "tree(manual)";
    applySlicing(configs, { ...DEFAULT_SLICING, supports: "everywhere" });
    expect(configs.process.support_type).toBe("tree(auto)");
  });

  it("read back what they wrote", () => {
    const settings: SlicingSettings = {
      ...DEFAULT_SLICING,
      layerHeight: 0.12,
      walls: 3,
      infill: 40,
      pattern: "honeycomb",
      supports: "everywhere",
      supportStyle: "tree-hybrid",
      brim: "off",
      plate: "Smooth PEI Plate",
      filaments: [{ material: "PETG", colorHex: "#1d1d1f", colorName: "Black", spoolId: "s1" }],
      scale: 80,
    };
    const configs = standard();
    applySlicing(configs, settings);
    const filament = { filament_type: ["PETG"], filament_colour: ["#1D1D1F"] };
    expect(readSlicing({ ...configs, filaments: [filament] }, settings, [true])).toEqual(settings);
    // A stand-in's colour isn't anyone's choice: it isn't read back.
    expect(readSlicing({ ...configs, filaments: [filament] }, settings, [false]).filaments).toEqual([
      { material: "PETG" },
    ]);
  });

  it("read a project's own values in the settings' words, keeping what they can't tell apart", () => {
    const configs = standard();
    Object.assign(configs.process, { brim_type: "brim_ears", sparse_infill_density: "40", wall_loops: "4" });
    const read = readSlicing({ ...configs, filaments: [] });
    expect(read).toMatchObject({ brim: "on", infill: 40, walls: 4 });
    // Writing those settings back changes nothing: ears are a brim that is on.
    const before = structuredClone(configs.process);
    applySlicing(configs, read);
    expect(configs.process).toEqual(before);
  });

  it("leave a project's values that the settings round as they are, unless another is picked", () => {
    const configs = standard();
    Object.assign(configs.process, { sparse_infill_density: "12.5%", layer_height: "0.125" });
    const read = readSlicing({ ...configs, filaments: [] });
    expect(read).toMatchObject({ infill: 13, layerHeight: 0.13 });
    applySlicing(configs, read);
    expect(configs.process).toMatchObject({ sparse_infill_density: "12.5%", layer_height: "0.125" });
    applySlicing(configs, { ...read, infill: 15, layerHeight: 0.12 });
    expect(configs.process).toMatchObject({ sparse_infill_density: "15%", layer_height: "0.12" });
    // A key the config doesn't have is written.
    const bare = { machine: {}, process: {} as Config };
    applySlicing(bare, DEFAULT_SLICING);
    expect(bare.process).toMatchObject({ layer_height: "0.2", wall_loops: "2", sparse_infill_density: "15%" });
  });

  it("name the presets a slice that failed early would have used", () => {
    expect(presetRecord(DEFAULT_SLICING)).toEqual({
      machine: "Bambu Lab X2D 0.4 nozzle",
      process: "0.20mm Standard @BBL X2D",
      filaments: ["Bambu PLA Basic @BBL X2D 0.4 nozzle"],
      layerHeight: 0.2,
      materials: ["PLA"],
      bedType: "Textured PEI Plate",
      supports: false,
    });
    expect(presetRecord({ ...DEFAULT_SLICING, layerHeight: 0.28, supports: "where-needed" })).toMatchObject({
      process: "0.24mm Standard @BBL X2D",
      supports: true,
    });
    expect(presetRecord({ ...DEFAULT_SLICING, nozzle: 0.2, layerHeight: 0.1 })).toMatchObject({
      machine: "Bambu Lab X2D 0.2 nozzle",
      process: "0.10mm Standard @BBL X2D 0.2 nozzle",
      filaments: ["Bambu PLA Basic @BBL X2D 0.2 nozzle"],
    });
    expect(presetRecord({ ...DEFAULT_SLICING, nozzle: 0.8, layerHeight: 0.56 })).toMatchObject({
      process: "0.40mm Standard @BBL X2D 0.8 nozzle",
      filaments: ["Bambu PLA Basic @BBL X2D"],
    });
  });
});
