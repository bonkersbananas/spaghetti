import { strToU8, type Zippable, zipSync } from "fflate";
import type { Box } from "./arrange.ts";
import { BAMBU_PRINTER_MODEL_IDS, bambuFilamentId } from "./bambu-ids.ts";
import { md5Hex } from "./md5.ts";

/**
 * Packs the engine's G-code for one plate into a `.gcode.3mf`, laid out the way OrcaSlicer's own export is
 * (`Metadata/plate_1.gcode` with its `.md5`, `slice_info.config`, `project_settings.config`,
 * `model_settings.config`, `plate_1.json`), so Spaghetti's reader, the 3D view, Bambu Studio and Orca read it as
 * a sliced file. It carries no meshes (the original file is kept beside it) and adds the plate picture Orca's
 * command line can't draw (`plate_1.png`).
 */

export type ConfigValue = string | string[];
export type Config = Record<string, ConfigValue>;

export interface PackedFilament {
  /** "PLA" */
  type: string;
  /** "#F2754E" */
  colour: string;
  usedGrams?: number;
  usedMeters?: number;
  /**
   * Bambu's id of the filament ("GFA00", `tray_info_idx`): what Bambu Studio's AMS mapping and the printer match
   * against the tray's. Taken from the preset's name in `settings.filament_settings_id` when not given.
   */
  trayInfoIdx?: string;
}

export interface Gcode3mfInput {
  gcode: Uint8Array;
  /** The plate picture (PNG). */
  thumbnail?: Uint8Array;
  /** The engine's estimate for the whole print, in seconds. */
  seconds: number | null;
  grams: number | null;
  /** How many layers the G-code has, for the plate's list of filaments by layer. */
  layers?: number | null;
  /** The objects as placed on the plate. */
  objects: { name: string; box: Box; id?: number }[];
  /** Every setting the plate was sliced with (machine, process and filaments together), in Orca's text. */
  settings: Config;
  filaments: PackedFilament[];
  /** "OrcaSlicer" and its version: who made the G-code. */
  slicer: { name: string; version: string };
  /** What the archive is called inside (the original file's name). */
  title: string;
}

/** The Bambu Studio file version Orca 2.5 writes into its sliced files for the printers' sake. */
const BBL_CLIENT_VERSION = "02.08.01.55";

/**
 * What Bambu Studio's reader needs in `Application`: only a file whose generator starts with "BambuStudio-" is
 * trusted with its config, G-code and slice info (`_handle_end_metadata`, then `dont_load_config`); with any other
 * name it loads no G-code, finds no model and says "The file does not contain any geometry data." Who really made
 * the G-code is in slice_info's header and the G-code's own first line. 2.0.0 is the oldest version it takes as
 * current, and no real version is older than it, so it never asks to update.
 */
export const BAMBU_STUDIO_APPLICATION = "BambuStudio-02.00.00.00";

const xml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const first = (value: ConfigValue | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * What Bambu Studio can't take from a config of the X2D's: `extruder_variant_list` makes its reader expect every
 * per-filament list in the file expanded to one entry per extruder variant (with `filament_self_index` saying which
 * filament each belongs to), and it refuses the whole file ("Invalid configuration file") when they aren't; ours
 * are one entry per filament. Without the key it reads them as the single-variant lists they are.
 */
const VARIANT_KEYS = ["extruder_variant_list"];

/** The project settings as the file holds them: Studio's `filament_ids`, and nothing that expects variants. */
function projectSettings(input: Gcode3mfInput): Config {
  const out: Config = { ...input.settings };
  for (const key of VARIANT_KEYS) delete out[key];
  const names = [out.filament_settings_id ?? []].flat();
  out.filament_ids = input.filaments.map(
    (filament, index) => filament.trayInfoIdx ?? bambuFilamentId(names[index] ?? ""),
  );
  return out;
}

const EXTRUDER_TYPES: Record<string, string> = { "Direct Drive": "0", Bowden: "1" };

export function packGcode3mf(input: Gcode3mfInput): Uint8Array {
  const { settings } = input;
  const project = projectSettings(input);
  const printerModelId = BAMBU_PRINTER_MODEL_IDS[first(settings.printer_model) ?? ""] ?? "";
  const extruderTypes = [settings.extruder_type ?? "Direct Drive"].flat().map((type) => EXTRUDER_TYPES[type] ?? "0");
  const nozzles = [settings.nozzle_diameter ?? "0.4"].flat();
  const supportUsed = first(settings.enable_support) === "1";
  const bedType = first(settings.curr_bed_type) ?? "Textured PEI Plate";
  const all = input.objects.length ? input.objects.map((object) => object.box) : [];
  const bboxAll = all.length
    ? [
        Math.min(...all.map((box) => box.min[0])),
        Math.min(...all.map((box) => box.min[1])),
        Math.max(...all.map((box) => box.max[0])),
        Math.max(...all.map((box) => box.max[1])),
      ]
    : [0, 0, 0, 0];

  const files: Zippable = {
    "[Content_Types].xml": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
        ' <Default Extension="png" ContentType="image/png"/>',
        ' <Default Extension="json" ContentType="application/json"/>',
        ' <Default Extension="gcode" ContentType="text/x.gcode"/>',
        "</Types>",
        "",
      ].join("\n"),
    ),
    "_rels/.rels": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
        ...(input.thumbnail
          ? [
              ' <Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>',
            ]
          : []),
        "</Relationships>",
        "",
      ].join("\n"),
    ),
    "3D/3dmodel.model": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">',
        ` <metadata name="Application">${BAMBU_STUDIO_APPLICATION}</metadata>`,
        ' <metadata name="BambuStudio:3mfVersion">1</metadata>',
        ` <metadata name="Title">${xml(input.title)}</metadata>`,
        " <resources/>",
        " <build/>",
        "</model>",
        "",
      ].join("\n"),
    ),
    "Metadata/plate_1.gcode": [input.gcode, { level: 6 }],
    "Metadata/plate_1.gcode.md5": strToU8(md5Hex(input.gcode)),
    "Metadata/_rels/model_settings.config.rels": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        ' <Relationship Target="/Metadata/plate_1.gcode" Id="rel-1" Type="http://schemas.bambulab.com/package/2021/gcode"/>',
        "</Relationships>",
        "",
      ].join("\n"),
    ),
    "Metadata/model_settings.config": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<config>",
        "  <plate>",
        '    <metadata key="plater_id" value="1"/>',
        '    <metadata key="plater_name" value=""/>',
        '    <metadata key="locked" value="false"/>',
        '    <metadata key="gcode_file" value="Metadata/plate_1.gcode"/>',
        ...(input.thumbnail ? ['    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>'] : []),
        "  </plate>",
        "</config>",
        "",
      ].join("\n"),
    ),
    "Metadata/slice_info.config": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<config>",
        "  <header>",
        '    <header_item key="X-BBL-Client-Type" value="slicer"/>',
        `    <header_item key="X-BBL-Client-Version" value="${BBL_CLIENT_VERSION}"/>`,
        `    <header_item key="OrcaSlicer-Version" value="${xml(input.slicer.version)}"/>`,
        "  </header>",
        "  <plate>",
        '    <metadata key="index" value="1"/>',
        `    <metadata key="extruder_type" value="${extruderTypes.join(" ")}"/>`,
        '    <metadata key="nozzle_volume_type" value="0"/>',
        `    <metadata key="printer_model_id" value="${xml(printerModelId)}"/>`,
        `    <metadata key="nozzle_diameters" value="${xml(nozzles.join(","))}"/>`,
        ...(first(settings.timelapse_type) !== undefined
          ? [`    <metadata key="timelapse_type" value="${xml(first(settings.timelapse_type) ?? "0")}"/>`]
          : []),
        ...(input.seconds !== null ? [`    <metadata key="prediction" value="${Math.round(input.seconds)}"/>`] : []),
        ...(input.grams !== null ? [`    <metadata key="weight" value="${round(input.grams, 2)}"/>`] : []),
        '    <metadata key="outside" value="false"/>',
        `    <metadata key="support_used" value="${supportUsed}"/>`,
        `    <metadata key="label_object_enabled" value="${input.objects.length < 64}"/>`,
        '    <metadata key="enable_filament_dynamic_map" value="false"/>',
        '    <metadata key="has_filament_switcher" value="false"/>',
        `    <metadata key="filament_maps" value="${input.filaments.map(() => "1").join(" ")}"/>`,
        `    <metadata key="limit_filament_maps" value="${input.filaments.map(() => "0").join(" ")}"/>`,
        ...input.objects.map(
          (object, index) =>
            `    <object identify_id="${object.id ?? index + 1}" name="${xml(object.name)}" skipped="false"/>`,
        ),
        ...input.filaments.map(
          (filament, index) =>
            `    <filament id="${index + 1}" tray_info_idx="${xml([project.filament_ids ?? []].flat()[index] ?? "")}" type="${xml(filament.type)}" color="${xml(filament.colour)}" used_m="${round(filament.usedMeters ?? 0, 2)}" used_g="${round(filament.usedGrams ?? 0, 2)}" group_id="0" nozzle_diameter="${Number(nozzles[0]) || 0.4}" volume_type="Standard" used_for_object="true" used_for_support="false"/>`,
        ),
        `    <nozzle id="0" extruder_id="1" nozzle_diameter="${Number(nozzles[0]) || 0.4}" volume_type="Standard"/>`,
        "    <layer_filament_lists>",
        ...(input.layers
          ? [
              `      <layer_filament_list filament_list="${input.filaments.map((_, index) => index).join(" ")}" layer_ranges="0 ${Math.max(0, input.layers - 1)}" />`,
            ]
          : []),
        "    </layer_filament_lists>",
        "  </plate>",
        "</config>",
        "",
      ].join("\n"),
    ),
    "Metadata/filament_sequence.json": strToU8(
      JSON.stringify({
        plate_1: {
          nozzle_sequence: input.filaments.map(() => 0),
          optimal_assignment: input.filaments.map(() => 0),
          sequence: input.filaments.map((_, index) => index + 1),
        },
      }),
    ),
    "Metadata/plate_1.json": strToU8(
      JSON.stringify({
        bbox_all: bboxAll,
        bbox_objects: input.objects.map((object, index) => ({
          id: object.id ?? index + 1,
          name: object.name,
          bbox: [object.box.min[0], object.box.min[1], object.box.max[0], object.box.max[1]],
          layer_height: Number(first(settings.layer_height)) || 0.2,
        })),
        bed_type: bedTypeKey(bedType),
        filament_colors: input.filaments.map((filament) => filament.colour),
        filament_ids: input.filaments.map((_, index) => index),
        first_extruder: 0,
        is_seq_print: first(settings.print_sequence) === "by object",
        nozzle_diameter: Number(nozzles[0]) || 0.4,
        version: 2,
      }),
    ),
    "Metadata/project_settings.config": strToU8(JSON.stringify(project, null, 4)),
  };
  if (input.thumbnail) files["Metadata/plate_1.png"] = [input.thumbnail, { level: 0 }];
  return zipSync(files, { level: 6 });
}

/** "Textured PEI Plate" → "textured_plate", as plate_N.json names bed types. */
function bedTypeKey(bedType: string): string {
  const keys: Record<string, string> = {
    "Cool Plate": "cool_plate",
    "Engineering Plate": "eng_plate",
    "High Temp Plate": "hot_plate",
    "Textured PEI Plate": "textured_plate",
    "Supertack Plate": "supertack_plate",
    "Textured Cool Plate": "textured_cool_plate",
  };
  return keys[bedType] ?? "textured_plate";
}

/** What the G-code says about itself in its header and its last lines. */
export interface GcodeSummary {
  seconds: number | null;
  layers: number | null;
  /** The ids the G-code labels its objects with (`; model label id: 22,23`), which the printer skips them by. */
  labels: number[];
  /** Per filament, in the slicer's order. */
  grams: number[];
  millimetres: number[];
}

/** Reads the estimate, layer count and filament use from the G-code's header and footer comments. */
export function summarizeGcode(gcode: Uint8Array): GcodeSummary {
  const decoder = new TextDecoder();
  const head = decoder.decode(gcode.subarray(0, Math.min(gcode.length, 16 * 1024)));
  const tail = decoder.decode(gcode.subarray(Math.max(0, gcode.length - 64 * 1024)));
  const total = /total estimated time: ([^;\n]+)/.exec(head)?.[1];
  const layers = /; total layer number: (\d+)/.exec(head)?.[1];
  const list = (pattern: RegExp) =>
    (pattern.exec(tail)?.[1] ?? "")
      .split(",")
      .filter((value) => value.trim() !== "")
      .map((value) => Number(value.trim()))
      .filter(Number.isFinite);
  return {
    seconds: total ? durationSeconds(total) : null,
    layers: layers ? Number(layers) : null,
    labels: (/; model label id: ([\d,\s]+)/.exec(head)?.[1] ?? "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0),
    grams: list(/; filament used \[g\] = ([^\n]+)/),
    millimetres: list(/; filament used \[mm\] = ([^\n]+)/),
  };
}

/** "1h 16m 47s", "2d 1h" → seconds. */
function durationSeconds(text: string): number | null {
  let total = 0;
  let found = false;
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/g)) {
    found = true;
    total += Number(match[1]) * ({ d: 86400, h: 3600, m: 60, s: 1 }[match[2] as "d" | "h" | "m" | "s"] ?? 0);
  }
  return found ? Math.round(total) : null;
}
