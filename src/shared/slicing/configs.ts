/**
 * The engine's configs for one slice: OrcaSlicer's X2D presets (the engine's presets.json, flattened by Orca's own
 * loader), the defaults (defaults.ts), what a 3MF project says, and what was asked ("Slice with supports"). Pure, so
 * the worker and the tests share it.
 */
import { filamentPresetFor, SLICING_DEFAULTS, SUPPORTS_ON } from "./defaults.ts";
import type { Config, ConfigValue } from "./gcode3mf.ts";
import type { SliceOptions, SliceSettings } from "./types.ts";

/** presets.json in the engine's release (scripts/slicer/resolve-presets.mjs). */
export interface PresetSet {
  format: number;
  orca: { version: string; commit: string; repository: string };
  machine: Record<string, Config>;
  process: Record<string, Config>;
  filament: Record<string, Config>;
}

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
  /** Where the prime tower stands (mm), when the project says: needed once two filaments print. */
  tower?: { x: number; y: number };
  settings: Omit<SliceSettings, "scale" | "engine" | "orca">;
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

const first = (value: ConfigValue | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
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

/** "#f2754eff" or "#F2754E" → "#F2754E"; anything else → null. */
function colourOf(value: string | undefined): string | null {
  const match = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec((value ?? "").trim());
  return match?.[1] ? `#${match[1].toUpperCase()}` : null;
}

/**
 * The configs and what to say about them. `filaments` is how many filaments the plate's objects use (from 1); a
 * project's own filaments (material and colour) fill them, else the default filament does.
 */
export function sliceSetup(
  presets: PresetSet,
  options: SliceOptions & { project?: ProjectSettings; filaments?: number },
): SliceSetup {
  const machineName = SLICING_DEFAULTS.machine;
  const machineBase = presets.machine[machineName];
  if (!machineBase) throw new Error(`presets.json has no ${machineName}`);
  const project = options.project?.settings;
  const own = !!project && projectIsFor(project, machineBase);

  const projectProcess = own ? first(project?.print_settings_id) : undefined;
  const processName = projectProcess && presets.process[projectProcess] ? projectProcess : SLICING_DEFAULTS.process;
  const process: Config = { ...(presets.process[processName] as Config) };
  if (project) {
    const keys = own ? Object.keys(process) : INTENT_KEYS.filter((key) => key in process);
    for (const key of keys) {
      if (IDENTITY_KEYS.has(key)) continue;
      const value = project[key];
      if (fits(process[key] as ConfigValue, value)) process[key] = value;
    }
  }
  if (options.supports) Object.assign(process, SUPPORTS_ON);
  // The presets' names go into the sliced file's settings, where Orca, Bambu Studio and Spaghetti's reader look.
  process.print_settings_id = processName;

  const bedFromProject = own ? first(project?.curr_bed_type) : undefined;
  const bedType = bedFromProject && /plate/i.test(bedFromProject) ? bedFromProject : SLICING_DEFAULTS.bedType;
  const machine: Config = { ...machineBase, curr_bed_type: bedType, printer_settings_id: machineName };

  const count = Math.max(1, Math.min(16, options.filaments ?? 1));
  const types = list(project?.filament_type);
  const projectColours = list(project?.filament_colour);
  const filamentNames: string[] = [];
  const filaments: Config[] = [];
  const colours: string[] = [];
  for (let index = 0; index < count; index++) {
    const name = project ? filamentPresetFor(types[index]) : SLICING_DEFAULTS.filament;
    const base = presets.filament[name] ?? presets.filament[SLICING_DEFAULTS.filament];
    if (!base) throw new Error(`presets.json has no ${name}`);
    const colour =
      colourOf(projectColours[index]) ?? SLICING_DEFAULTS.colours[index % SLICING_DEFAULTS.colours.length] ?? "#F2754E";
    filamentNames.push(presets.filament[name] ? name : SLICING_DEFAULTS.filament);
    filaments.push({ ...base, filament_colour: [colour], filament_settings_id: [filamentNames.at(-1) as string] });
    colours.push(colour);
  }

  const towerX = Number(first(project?.wipe_tower_x));
  const towerY = Number(first(project?.wipe_tower_y));
  return {
    machine,
    process,
    filaments,
    colours,
    ...(own && Number.isFinite(towerX) && Number.isFinite(towerY) && project?.wipe_tower_x !== undefined
      ? { tower: { x: towerX, y: towerY } }
      : {}),
    settings: {
      machine: machineName,
      process: processName,
      filaments: filamentNames,
      layerHeight: Number(first(process.layer_height)) || 0.2,
      materials: filaments.map((filament) => first(filament.filament_type) ?? "PLA"),
      bedType,
      supports: first(process.enable_support) === "1",
      ...(project ? { project: own ? ("own" as const) : ("some" as const) } : {}),
    },
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
