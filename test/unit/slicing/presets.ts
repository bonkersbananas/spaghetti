import type { PresetSet } from "../../../src/shared/slicing/orca.ts";

const X2D = ["Bambu Lab X2D 0.4 nozzle"];
const X2D_02 = ["Bambu Lab X2D 0.2 nozzle"];

/** A process preset as presets.json has it, cut down to the keys the mapping reads and writes. */
function process(layer: string, pattern: string, extra: Record<string, string | string[]> = {}) {
  return {
    layer_height: layer,
    wall_loops: "2",
    sparse_infill_density: "15%",
    sparse_infill_pattern: pattern,
    enable_support: "0",
    support_type: "tree(auto)",
    support_style: "default",
    support_critical_regions_only: "0",
    brim_type: "auto_brim",
    print_settings_id: "",
    compatible_printers: X2D,
    ...extra,
  };
}

const filament = (type: string, printers = X2D) => ({
  filament_type: [type],
  filament_colour: ["#FFFFFF"],
  filament_settings_id: [""],
  compatible_printers: printers,
});

/**
 * presets.json as the engine's release has it (slicer-v2), cut down to what the tests look at: the 0.4 mm nozzle and
 * the 0.2 mm (the 0.6 and 0.8 mm are left out, for a nozzle it has no presets for).
 */
export const presets: PresetSet = {
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
    "Bambu Lab X2D 0.2 nozzle": {
      printer_model: "Bambu Lab X2D",
      nozzle_diameter: ["0.2", "0.2"],
      printable_area: ["0x0", "256x0", "256x256", "0x256"],
      printable_height: "261",
      default_bed_type: "",
    },
  },
  process: {
    "0.08mm High Quality @BBL X2D": process("0.08", "gyroid"),
    "0.12mm High Quality @BBL X2D": process("0.12", "gyroid", { outer_wall_speed: ["60", "60"] }),
    "0.16mm High Quality @BBL X2D": process("0.16", "gyroid", { wall_loops: "3", outer_wall_speed: ["60", "60"] }),
    "0.16mm Standard @BBL X2D": process("0.16", "crosshatch", { outer_wall_speed: ["200", "200"] }),
    "0.20mm High Quality @BBL X2D": process("0.2", "gyroid"),
    "0.20mm Standard @BBL X2D": process("0.2", "crosshatch", { outer_wall_speed: ["200", "200"] }),
    "0.24mm Standard @BBL X2D": process("0.24", "crosshatch", { top_shell_layers: "4" }),
    "0.08mm High Quality @BBL X2D 0.2 nozzle": process("0.08", "crosshatch", { compatible_printers: X2D_02 }),
    "0.10mm Standard @BBL X2D 0.2 nozzle": process("0.1", "crosshatch", { compatible_printers: X2D_02 }),
    "0.12mm Balanced Quality @BBL X2D 0.2 nozzle": process("0.12", "crosshatch", { compatible_printers: X2D_02 }),
  },
  filament: {
    "Bambu PLA Basic @BBL X2D 0.4 nozzle": filament("PLA"),
    "Generic PLA @BBL X2D 0.4 nozzle": filament("PLA"),
    "Generic PLA Silk @BBL X2D 0.4 nozzle": filament("PLA"),
    "Generic PETG @BBL X2D 0.4 nozzle": filament("PETG"),
    "Generic PETG-CF @BBL X2D 0.4 nozzle": filament("PETG-CF"),
    "Bambu PLA Basic @BBL X2D 0.2 nozzle": filament("PLA", X2D_02),
    "Generic PLA @BBL X2D 0.2 nozzle": filament("PLA", X2D_02),
    "Generic PETG @BBL X2D 0.2 nozzle": filament("PETG", X2D_02),
  },
};
