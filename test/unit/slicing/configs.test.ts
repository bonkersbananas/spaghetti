import { describe, expect, it } from "vitest";
import {
  INTENT_KEYS,
  mergedSettings,
  type PresetSet,
  projectIsFor,
  sliceSetup,
} from "../../../src/shared/slicing/configs.ts";
import {
  defaultSettings,
  filamentPresetFor,
  SLICING_DEFAULTS,
  SUPPORTS_ON,
} from "../../../src/shared/slicing/defaults.ts";

/** presets.json as the engine's release has it, cut down to what the tests look at. */
const presets: PresetSet = {
  format: 1,
  orca: { version: "2.5.0-dev", commit: "2d1163eb6f", repository: "https://github.com/Muon-3D/OrcaSlicer" },
  machine: {
    "Bambu Lab X2D 0.4 nozzle": {
      printer_model: "Bambu Lab X2D",
      nozzle_diameter: ["0.4", "0.4"],
      printable_area: ["0x0", "256x0", "256x256", "0x256"],
      printable_height: "261",
      default_bed_type: "",
    },
  },
  process: {
    "0.20mm Standard @BBL X2D": {
      layer_height: "0.2",
      wall_loops: "2",
      sparse_infill_density: "15%",
      enable_support: "0",
      support_type: "tree(auto)",
      outer_wall_speed: ["200", "200"],
      print_settings_id: "",
      compatible_printers: ["Bambu Lab X2D 0.4 nozzle"],
    },
    "0.16mm High Quality @BBL X2D": { layer_height: "0.16", wall_loops: "3", print_settings_id: "" },
  },
  filament: {
    "Bambu PLA Basic @BBL X2D 0.4 nozzle": {
      filament_type: ["PLA"],
      filament_colour: ["#FFFFFF"],
      filament_settings_id: [""],
    },
    "Generic PETG @BBL X2D 0.4 nozzle": {
      filament_type: ["PETG"],
      filament_colour: ["#FFFFFF"],
      filament_settings_id: [""],
    },
    "Generic PLA @BBL X2D 0.4 nozzle": {
      filament_type: ["PLA"],
      filament_colour: ["#FFFFFF"],
      filament_settings_id: [""],
    },
  },
};

describe("the defaults", () => {
  it("slice for the X2D's 0.4 nozzle, 0.20 mm Standard, Bambu PLA Basic on the Textured PEI plate, no supports", () => {
    const setup = sliceSetup(presets, {});
    expect(setup.settings).toEqual(defaultSettings());
    expect(setup.settings).toEqual({
      machine: "Bambu Lab X2D 0.4 nozzle",
      process: "0.20mm Standard @BBL X2D",
      filaments: ["Bambu PLA Basic @BBL X2D 0.4 nozzle"],
      layerHeight: 0.2,
      materials: ["PLA"],
      bedType: "Textured PEI Plate",
      supports: false,
    });
    expect(setup.machine.curr_bed_type).toBe("Textured PEI Plate");
    expect(setup.process.print_settings_id).toBe("0.20mm Standard @BBL X2D");
    expect(setup.filaments).toHaveLength(1);
    expect(setup.filaments[0]).toMatchObject({
      filament_colour: [SLICING_DEFAULTS.colours[0]],
      filament_settings_id: ["Bambu PLA Basic @BBL X2D 0.4 nozzle"],
    });
    expect(setup.colours).toEqual([SLICING_DEFAULTS.colours[0]]);
    // Nobody chose that colour: it is a stand-in's.
    expect(setup.chosen).toEqual([false]);
    expect(setup.tower).toBeUndefined();
  });

  it("turn on Orca's tree supports when asked", () => {
    const setup = sliceSetup(presets, { supports: true });
    expect(setup.process).toMatchObject(SUPPORTS_ON);
    expect(setup.settings.supports).toBe(true);
  });

  it("find a filament preset for a material, Bambu's PLA Basic for PLA and Orca's generic for the rest", () => {
    expect(filamentPresetFor(undefined)).toBe("Bambu PLA Basic @BBL X2D 0.4 nozzle");
    expect(filamentPresetFor("pla")).toBe("Bambu PLA Basic @BBL X2D 0.4 nozzle");
    expect(filamentPresetFor("PLA Silk")).toBe("Generic PLA Silk @BBL X2D 0.4 nozzle");
    expect(filamentPresetFor("PETG-CF")).toBe("Generic PETG-CF @BBL X2D 0.4 nozzle");
    expect(filamentPresetFor("PAHT-CF")).toBe("Generic PA-CF @BBL X2D 0.4 nozzle");
    expect(filamentPresetFor("TPE")).toBe("Generic TPU @BBL X2D 0.4 nozzle");
    expect(filamentPresetFor("Wood")).toBe("Generic PLA @BBL X2D 0.4 nozzle");
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
    expect(setup.process).toMatchObject({ layer_height: "0.16", wall_loops: "4" });
    // Names of presets and printers are never taken from a file.
    expect(setup.process.compatible_printers).toBeUndefined();
    expect(setup.colours).toEqual(["#00AE42", "#1D1D1F"]);
    expect(setup.chosen).toEqual([true, true]);
    expect(setup.tower).toEqual({ x: 165, y: 216 });
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
      process: "0.20mm Standard @BBL X2D",
      bedType: "Textured PEI Plate",
    });
    expect(setup.process).toMatchObject({ layer_height: "0.16", wall_loops: "4", sparse_infill_density: "40" });
    expect(setup.process.outer_wall_speed).toEqual(["200", "200"]);
    expect(setup.tower).toBeUndefined();
    expect(INTENT_KEYS).toContain("enable_support");
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
