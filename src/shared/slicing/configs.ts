/**
 * The engine's configs for one slice: OrcaSlicer's X2D presets (the engine's presets.json, flattened by Orca's own
 * loader), what a 3MF project says, and the slicing settings (settings.ts), put together through orca.ts's mapping.
 * Each setting is what was chosen, else what the project says, else the defaults. Pure, so the worker and the tests
 * share it.
 */
import { DEFAULT_SLICING } from "./defaults.ts";
import type { Config, ConfigValue } from "./gcode3mf.ts";
import {
  applySlicing,
  colourOf,
  filamentPreset,
  first,
  machinePreset,
  ORCA_KEYS,
  type PresetSet,
  processPreset,
  readSlicing,
  STAND_IN_COLOURS,
} from "./orca.ts";
import { layerRange, type SlicingFilament, type SlicingSettings, withNozzle } from "./settings.ts";
import type { SliceSettings } from "./types.ts";

export type { PresetSet } from "./orca.ts";

/** What a 3MF project brings: its settings (`Metadata/project_settings.config`). */
export interface ProjectSettings {
  settings: Config;
}

export interface SliceSetup {
  machine: Config;
  process: Config;
  /** One per filament the plate uses, in order (filament 1 first). */
  filaments: Config[];
  /** Each filament's colour, "#RRGGBB". */
  colours: string[];
  /** Per filament: whether its colour was chosen (a project's, a spool's), else it is only a stand-in's. */
  chosen: boolean[];
  /** Where the prime tower stands (mm), when the project says: needed once two filaments print. */
  tower?: { x: number; y: number };
  /** The presets it starts from, as a slice's record names them. */
  settings: Omit<SliceSettings, "scale" | "engine" | "orca">;
  /** The settings it slices with, as people change them: whole, the scale included. */
  slicing: SlicingSettings;
}

/** presets.json lacks what the settings need: a nozzle the engine's release has no presets for yet. */
export class MissingPreset extends Error {
  readonly preset: string;
  constructor(preset: string) {
    super(`presets.json has no ${preset}`);
    this.preset = preset;
  }
}

/** A project's keys that say how its model should print, taken even from a project made for another printer. */
export const INTENT_KEYS = [
  "layer_height",
  "wall_loops",
  "top_shell_layers",
  "bottom_shell_layers",
  "sparse_infill_density",
  "sparse_infill_pattern",
  "enable_support",
  "support_type",
  "support_on_build_plate_only",
  "brim_type",
  "brim_width",
] as const;

/** Keys that name a preset or a printer rather than say how to print: never copied from a project. */
const IDENTITY_KEYS = new Set([
  "name",
  "inherits",
  "from",
  "type",
  "version",
  "setting_id",
  "instantiation",
  "print_settings_id",
  "printer_settings_id",
  "filament_settings_id",
  "compatible_printers",
  "compatible_printers_condition",
  "print_compatible_printers",
  "print_extruder_id",
  "print_extruder_variant",
  "different_settings_to_system",
  "inherits_group",
]);

const list = (value: ConfigValue | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Whether a project was made for the printer and nozzle the presets are for (its own settings then apply whole). */
export function projectIsFor(project: Config, machine: Config): boolean {
  const model = first(project.printer_model);
  const nozzle = first(project.nozzle_diameter);
  return !!model && model === first(machine.printer_model) && (!nozzle || nozzle === first(machine.nozzle_diameter));
}

/** A value of the project's that fits where ours goes: the same shape (a list of the same length, or one value). */
function fits(ours: ConfigValue, theirs: ConfigValue | undefined): theirs is ConfigValue {
  if (theirs === undefined) return false;
  if (Array.isArray(ours) !== Array.isArray(theirs)) return false;
  return !Array.isArray(ours) || ours.length === (theirs as string[]).length;
}

/**
 * The configs and what to say about them. `settings` holds what was chosen (all of it once a model has been sliced
 * and changed, nothing on its first slice); a 3MF project's own values fill what wasn't, and `defaults` (the
 * workspace's, else Spaghetti's) the rest. `filaments` is how many filaments the plate's objects use (from 1).
 */
export function sliceSetup(
  presets: PresetSet,
  input: {
    settings?: Partial<SlicingSettings>;
    defaults?: SlicingSettings;
    project?: ProjectSettings;
    filaments?: number;
  } = {},
): SliceSetup {
  const chosen = input.settings ?? {};
  const nozzle = chosen.nozzle ?? (input.defaults ?? DEFAULT_SLICING).nozzle;
  // The defaults for the nozzle chosen: their quality keeps its name there (Standard is 0.10 mm on the 0.2 mm).
  const defaults = withNozzle(input.defaults ?? DEFAULT_SLICING, nozzle);
  const machineName = machinePreset(nozzle);
  const machineBase = presets.machine[machineName];
  if (!machineBase) throw new MissingPreset(machineName);
  const project = input.project?.settings;
  const own = !!project && projectIsFor(project, machineBase);

  // The process: a project's own when it is for this printer and keeps its layer height, else Orca's for the height.
  const projectLayer = Number(first(project?.layer_height));
  const range = layerRange(nozzle);
  const layer = Math.min(
    range.max,
    Math.max(range.min, chosen.layerHeight ?? (Number.isFinite(projectLayer) ? projectLayer : defaults.layerHeight)),
  );
  const projectProcess = own ? first(project?.print_settings_id) : undefined;
  const processName =
    projectProcess && presets.process[projectProcess] && Math.abs(projectLayer - layer) < 0.001
      ? projectProcess
      : processPreset(presets, machineName, layer);
  if (!processName || !presets.process[processName]) throw new MissingPreset(`a process for ${machineName}`);
  const process: Config = { ...(presets.process[processName] as Config) };
  const machine: Config = { ...machineBase, printer_settings_id: machineName };

  // What the project says: all of its settings when it is for this printer, else only how its model should print.
  const said = new Set<string>();
  if (project) {
    const keys = own ? Object.keys(process) : INTENT_KEYS.filter((key) => key in process);
    for (const key of keys) {
      if (IDENTITY_KEYS.has(key)) continue;
      const value = project[key];
      if (fits(process[key] as ConfigValue, value)) {
        process[key] = value;
        said.add(key);
      }
    }
    const bed = own ? first(project.curr_bed_type) : undefined;
    if (bed && /plate/i.test(bed)) {
      machine.curr_bed_type = bed;
      said.add("curr_bed_type");
    }
  }
  const fromProject = readSlicing({ machine, process, filaments: [] }, defaults);
  // A project made for this printer says everything (what it leaves out, its process preset says); another
  // printer's only what it has of the keys that say how to print.
  const says = (key: keyof typeof ORCA_KEYS) => own || ORCA_KEYS[key].some((orcaKey) => said.has(orcaKey));
  const pick = <K extends keyof typeof ORCA_KEYS>(key: K): SlicingSettings[K] =>
    (chosen[key] as SlicingSettings[K] | undefined) ?? (says(key) ? fromProject[key] : defaults[key]);

  // The filaments: chosen ones (a spool for filament 1), else the project's own (material and colour), else defaults.
  const count = Math.max(1, Math.min(16, input.filaments ?? 1));
  const types = list(project?.filament_type);
  const projectColours = list(project?.filament_colour);
  const filaments: SlicingFilament[] = [];
  for (let index = 0; index < count; index++) {
    const type = types[index];
    const colorHex = colourOf(projectColours[index]);
    filaments.push(
      chosen.filaments?.[index] ??
        (type ? { material: type, ...(colorHex ? { colorHex } : {}) } : undefined) ??
        defaults.filaments[index] ??
        (defaults.filaments[0] as SlicingFilament),
    );
  }

  const target: SlicingSettings = {
    layerHeight: layer,
    walls: pick("walls"),
    infill: pick("infill"),
    pattern: pick("pattern"),
    supports: pick("supports"),
    supportStyle: pick("supportStyle"),
    brim: pick("brim"),
    filaments,
    plate: pick("plate"),
    nozzle,
    scale: chosen.scale ?? defaults.scale,
    orientation: chosen.orientation !== undefined ? chosen.orientation : defaults.orientation,
  };
  applySlicing({ machine, process }, target);
  // The presets' names go into the sliced file's settings, where Orca, Bambu Studio and Spaghetti's reader look.
  process.print_settings_id = processName;

  const fallback = filamentPreset(DEFAULT_SLICING.filaments[0] as SlicingFilament, nozzle);
  const filamentNames: string[] = [];
  const filamentConfigs: Config[] = [];
  const colours: string[] = [];
  const colourChosen: boolean[] = [];
  for (const [index, filament] of filaments.entries()) {
    const wanted = filamentPreset(filament, nozzle);
    const name = presets.filament[wanted] ? wanted : fallback;
    const base = presets.filament[name];
    if (!base) throw new MissingPreset(name);
    // A filament that names no colour of its own takes the project's for its place, else a stand-in's.
    const own = filament.colorHex ?? colourOf(projectColours[index]);
    const colour = (own ?? STAND_IN_COLOURS[index % STAND_IN_COLOURS.length] ?? STAND_IN_COLOURS[0]).toUpperCase();
    filamentNames.push(name);
    filamentConfigs.push({ ...base, filament_colour: [colour], filament_settings_id: [name] });
    colours.push(colour);
    colourChosen.push(!!own);
  }

  const towerX = Number(first(project?.wipe_tower_x));
  const towerY = Number(first(project?.wipe_tower_y));
  const slicing = readSlicing({ machine, process, filaments: filamentConfigs }, target, colourChosen);
  return {
    machine,
    process,
    filaments: filamentConfigs,
    colours,
    chosen: colourChosen,
    ...(own && Number.isFinite(towerX) && Number.isFinite(towerY) && project?.wipe_tower_x !== undefined
      ? { tower: { x: towerX, y: towerY } }
      : {}),
    settings: {
      machine: machineName,
      process: processName,
      filaments: filamentNames,
      layerHeight: slicing.layerHeight,
      materials: filamentConfigs.map((filament) => first(filament.filament_type) ?? "PLA"),
      bedType: first(machine.curr_bed_type) ?? slicing.plate,
      supports: slicing.supports === "where-needed" || slicing.supports === "everywhere",
      ...(project ? { project: own ? ("own" as const) : ("some" as const) } : {}),
    },
    slicing,
  };
}

/**
 * Every setting of a slice in one config, as a sliced file's `project_settings.config` holds it: the machine, the
 * process, and each filament key as a list with one value per filament.
 */
export function mergedSettings(setup: Pick<SliceSetup, "machine" | "process" | "filaments">): Config {
  const merged: Config = { ...setup.machine, ...setup.process };
  const keys = new Set(setup.filaments.flatMap((filament) => Object.keys(filament)));
  for (const key of keys) {
    if (IDENTITY_KEYS.has(key) && key !== "filament_settings_id") continue;
    const values = setup.filaments.flatMap((filament) => list(filament[key]));
    if (values.length) merged[key] = values;
  }
  return merged;
}
