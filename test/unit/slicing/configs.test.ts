import { describe, expect, it } from "vitest";
import {
  INTENT_KEYS,
  MissingPreset,
  mergedSettings,
  projectIsFor,
  sliceSetup,
} from "../../../src/shared/slicing/configs.ts";
import { DEFAULT_SLICING } from "../../../src/shared/slicing/defaults.ts";
import { presetRecord, STAND_IN_COLOURS } from "../../../src/shared/slicing/orca.ts";
import { presets } from "./presets.ts";

const orange = { material: "PLA", brand: "Bambu", finish: "basic", colorHex: "#f2711c", colorName: "Orange" };

describe("the defaults", () => {
  it("slice for the X2D's 0.4 nozzle, 0.20 mm Standard, Bambu PLA Basic on the Textured PEI plate, no supports", () => {
    const setup = sliceSetup(presets);
    expect(setup.settings).toEqual(presetRecord(DEFAULT_SLICING));
    expect(setup.settings).toEqual({
      machine: "Bambu Lab X2D 0.4 nozzle",
      process: "0.20mm Standard @BBL X2D",
      filaments: ["Bambu PLA Basic @BBL X2D 0.4 nozzle"],
      layerHeight: 0.2,
      materials: ["PLA"],
      bedType: "Textured PEI Plate",
      supports: false,
    });
    expect(setup.slicing).toEqual(DEFAULT_SLICING);
    // Orca's own preset, untouched: only the plate it names none of, and the presets' names.
    expect(setup.process).toEqual({
      ...presets.process["0.20mm Standard @BBL X2D"],
      print_settings_id: "0.20mm Standard @BBL X2D",
    });
    expect(setup.machine.curr_bed_type).toBe("Textured PEI Plate");
    expect(setup.filaments).toHaveLength(1);
    expect(setup.filaments[0]).toMatchObject({
      filament_colour: [STAND_IN_COLOURS[0]],
      filament_settings_id: ["Bambu PLA Basic @BBL X2D 0.4 nozzle"],
    });
    expect(setup.colours).toEqual([STAND_IN_COLOURS[0]]);
    // Nobody chose that colour: it is a stand-in's.
    expect(setup.chosen).toEqual([false]);
    expect(setup.tower).toBeUndefined();
  });

  it("turn on Orca's tree supports under every steep overhang for supports everywhere", () => {
    const setup = sliceSetup(presets, { settings: { supports: "everywhere", supportStyle: "tree" } });
    expect(setup.process).toMatchObject({ enable_support: "1", support_type: "tree(auto)" });
    expect(setup.process.support_critical_regions_only).toBe("0");
    expect(setup.settings.supports).toBe(true);
    expect(setup.slicing.supports).toBe("everywhere");
  });
});

describe("chosen settings", () => {
  it("start from Orca's process for the quality and set what was chosen", () => {
    const setup = sliceSetup(presets, {
      settings: { layerHeight: 0.12, walls: 4, infill: 25, pattern: "gyroid", supports: "where-needed", brim: "off" },
    });
    expect(setup.settings.process).toBe("0.12mm High Quality @BBL X2D");
    expect(setup.process).toMatchObject({
      layer_height: "0.12",
      wall_loops: "4",
      sparse_infill_density: "25%",
      sparse_infill_pattern: "gyroid",
      enable_support: "1",
      support_critical_regions_only: "1",
      brim_type: "no_brim",
      // The rest is the High Quality preset's own.
      outer_wall_speed: ["60", "60"],
    });
    expect(setup.slicing).toEqual({
      ...DEFAULT_SLICING,
      layerHeight: 0.12,
      walls: 4,
      infill: 25,
      pattern: "gyroid",
      supports: "where-needed",
      brim: "off",
    });
  });

  it("slice Extra draft as the 0.24 mm Standard at 0.28 mm", () => {
    const setup = sliceSetup(presets, { settings: { layerHeight: 0.28 } });
    expect(setup.settings).toMatchObject({ process: "0.24mm Standard @BBL X2D", layerHeight: 0.28 });
    expect(setup.process).toMatchObject({ layer_height: "0.28", top_shell_layers: "4" });
  });

  it("slice with a spool from the Pantry: its preset and its colour, which was chosen", () => {
    const setup = sliceSetup(presets, { settings: { filaments: [orange] } });
    expect(setup.settings.filaments).toEqual(["Bambu PLA Basic @BBL X2D 0.4 nozzle"]);
    expect(setup.colours).toEqual(["#F2711C"]);
    expect(setup.chosen).toEqual([true]);
    expect(setup.slicing.filaments).toEqual([orange]);
    const petg = sliceSetup(presets, { settings: { filaments: [{ material: "PETG", colorHex: "#1d1d1f" }] } });
    expect(petg.settings).toMatchObject({ filaments: ["Generic PETG @BBL X2D 0.4 nozzle"], materials: ["PETG"] });
  });

  it("take the workspace's defaults for what wasn't chosen", () => {
    const defaults = { ...DEFAULT_SLICING, layerHeight: 0.16, filaments: [orange], plate: "Cool Plate" };
    const setup = sliceSetup(presets, { defaults, settings: { supports: "everywhere" } });
    expect(setup.slicing).toEqual({ ...defaults, supports: "everywhere" });
    expect(setup.settings).toMatchObject({ process: "0.16mm Standard @BBL X2D", bedType: "Cool Plate" });
  });

  it("refuse a nozzle the engine's presets don't have yet", () => {
    expect(() => sliceSetup(presets, { settings: { nozzle: 0.6 } })).toThrow(MissingPreset);
  });

  it("keep layer heights within the nozzle's range", () => {
    const setup = sliceSetup(presets, { settings: { layerHeight: 0.4 } });
    expect(setup.process.layer_height).toBe("0.28");
  });
});

describe("a 3MF project's settings", () => {
  const x2d = {
    printer_model: "Bambu Lab X2D",
    nozzle_diameter: ["0.4", "0.4"],
    print_settings_id: "0.16mm High Quality @BBL X2D",
    layer_height: "0.16",
    wall_loops: "4",
    outer_wall_speed: ["150", "150"],
    sparse_infill_density: "40",
    compatible_printers: ["Someone else"],
    curr_bed_type: "Cool Plate",
    filament_type: ["PLA", "PETG"],
    filament_colour: ["#00AE42FF", "#1d1d1f"],
    wipe_tower_x: ["165"],
    wipe_tower_y: ["216"],
  };

  it("are its own when it was made for this printer: its process, plate, filaments and prime tower", () => {
    expect(projectIsFor(x2d, presets.machine["Bambu Lab X2D 0.4 nozzle"] ?? {})).toBe(true);
    const setup = sliceSetup(presets, { project: { settings: x2d }, filaments: 2 });
    expect(setup.settings).toMatchObject({
      process: "0.16mm High Quality @BBL X2D",
      layerHeight: 0.16,
      materials: ["PLA", "PETG"],
      filaments: ["Bambu PLA Basic @BBL X2D 0.4 nozzle", "Generic PETG @BBL X2D 0.4 nozzle"],
      bedType: "Cool Plate",
      project: "own",
    });
    // Values in the shape ours have replace them; one that isn't (a percent without its sign stays a string) does too.
    expect(setup.process).toMatchObject({ layer_height: "0.16", wall_loops: "4", sparse_infill_density: "40" });
    // Names of presets and printers are never taken from a file.
    expect(setup.process.compatible_printers).toEqual(["Bambu Lab X2D 0.4 nozzle"]);
    expect(setup.colours).toEqual(["#00AE42", "#1D1D1F"]);
    expect(setup.chosen).toEqual([true, true]);
    expect(setup.tower).toEqual({ x: 165, y: 216 });
    // In the settings' words: what the project said, so a change made later keeps the rest of it.
    expect(setup.slicing).toEqual({
      ...DEFAULT_SLICING,
      layerHeight: 0.16,
      walls: 4,
      infill: 40,
      pattern: "gyroid",
      plate: "Cool Plate",
      filaments: [
        { material: "PLA", colorHex: "#00ae42" },
        { material: "PETG", colorHex: "#1d1d1f" },
      ],
    });
  });

  it("give way to what was chosen, and keep the rest", () => {
    const setup = sliceSetup(presets, {
      project: { settings: x2d },
      filaments: 2,
      settings: { layerHeight: 0.12, supports: "where-needed", filaments: [orange] },
    });
    expect(setup.process).toMatchObject({
      layer_height: "0.12",
      wall_loops: "4",
      enable_support: "1",
      support_critical_regions_only: "1",
      // A project made for the X2D brings all of its own process.
      outer_wall_speed: ["150", "150"],
    });
    expect(setup.colours).toEqual(["#F2711C", "#1D1D1F"]);
    expect(setup.slicing.filaments).toEqual([orange, { material: "PETG", colorHex: "#1d1d1f" }]);
    expect(setup.machine.curr_bed_type).toBe("Cool Plate");
  });

  it("slice again the same, from what a first slice said its settings were", () => {
    const first = sliceSetup(presets, { project: { settings: x2d }, filaments: 2 });
    const again = sliceSetup(presets, { project: { settings: x2d }, filaments: 2, settings: first.slicing });
    expect(again.process).toEqual(first.process);
    expect(again.machine).toEqual(first.machine);
    expect(again.filaments).toEqual(first.filaments);
  });

  it("are only what says how to print it when it was made for another printer", () => {
    const other = {
      ...x2d,
      printer_model: "Bambu Lab X1 Carbon",
      outer_wall_speed: ["300"],
      curr_bed_type: "Cool Plate",
    };
    const setup = sliceSetup(presets, { project: { settings: other }, filaments: 1 });
    expect(setup.settings).toMatchObject({
      project: "some",
      // Orca's process for the project's layer height, with its walls and infill.
      process: "0.16mm Standard @BBL X2D",
      bedType: "Textured PEI Plate",
    });
    expect(setup.process).toMatchObject({ layer_height: "0.16", wall_loops: "4", sparse_infill_density: "40" });
    expect(setup.process.outer_wall_speed).toEqual(["200", "200"]);
    expect(setup.tower).toBeUndefined();
    expect(INTENT_KEYS).toContain("enable_support");
    // "Slice with supports" turns them on over a project's own.
    const supported = sliceSetup(presets, {
      project: { settings: { ...other, enable_support: "0" } },
      settings: { supports: "everywhere" },
    });
    expect(supported.process).toMatchObject({ enable_support: "1", wall_loops: "4", layer_height: "0.16" });
  });

  it("go into the sliced file as one config, each filament key a list with a value per filament", () => {
    const setup = sliceSetup(presets, { project: { settings: x2d }, filaments: 2 });
    const merged = mergedSettings(setup);
    expect(merged).toMatchObject({
      printer_model: "Bambu Lab X2D",
      layer_height: "0.16",
      filament_type: ["PLA", "PETG"],
      filament_colour: ["#00AE42", "#1D1D1F"],
      filament_settings_id: ["Bambu PLA Basic @BBL X2D 0.4 nozzle", "Generic PETG @BBL X2D 0.4 nozzle"],
      curr_bed_type: "Cool Plate",
    });
  });
});
