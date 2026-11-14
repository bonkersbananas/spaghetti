import { strFromU8, unzipSync } from "fflate";
import { md5Hex } from "../../../src/shared/slicing/md5.ts";

/**
 * What Bambu Studio's own reader needs to open a zip as a sliced plate, and what it does with the entries, from its
 * source (`_BBS_3MF_Importer::_load_model_from_file` and its `_handle_start_config_metadata`, `_handle_start_config_filament`,
 * `_handle_start_config_nozzle` and `_extract_filament_sequence_from_archive` in bbs_3mf.cpp, `PartPlateList::load_from_3mf_structure`,
 * `PresetBundle::load_config_file_config` and `validate_presets`, `SelectMachineDialog`). Each rule says why.
 *
 * Returns what is wrong, none when Bambu Studio would open it in its preview, ready to print.
 */
export function bambuStudioProblems(zip: Uint8Array): string[] {
  const problems: string[] = [];
  const files = unzipSync(zip);
  const names = Object.keys(files);
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : undefined);
  const attr = (tag: string, key: string) => new RegExp(`\\s${key}="([^"]*)"`).exec(tag)?.[1];

  // 3D/3dmodel.model's Application starts with "BambuStudio-" and then a version, or the reader sets
  // `dont_load_config` and skips the config, the G-code and the slice info: "The file does not contain any geometry
  // data." (2.0.0 or newer, or it treats the file as an old project.)
  const model = text("3D/3dmodel.model") ?? "";
  const app = /<metadata\s+name="Application">([^<]*)</.exec(model)?.[1] ?? "";
  const version = /^BambuStudio-(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/.exec(app);
  if (!version) problems.push(`Application is "${app}", not "BambuStudio-<version>"`);
  else if (Number(version[1]) < 2) problems.push(`Application ${app} is older than 2.0.0`);

  // The archive is read in order, and slice_info.config only finds its plate (`index`) among those model_settings.config
  // made already: a slice_info before it gets no filaments, time or weight.
  const at = (name: string) => names.indexOf(name);
  if (at("Metadata/model_settings.config") < 0) problems.push("model_settings.config is missing");
  if (!files["Metadata/slice_info.config"]) problems.push("slice_info.config is missing");
  if (at("Metadata/slice_info.config") >= 0 && at("Metadata/slice_info.config") < at("Metadata/model_settings.config"))
    problems.push("slice_info.config comes before model_settings.config in the zip");
  if (at("3D/3dmodel.model") > at("Metadata/model_settings.config"))
    problems.push("3D/3dmodel.model comes after model_settings.config in the zip");

  // The project settings: a non-empty settings object (an empty config turns the config off).
  let settings: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text("Metadata/project_settings.config") ?? "");
    if (!parsed || typeof parsed !== "object" || Object.keys(parsed).length === 0)
      problems.push("project_settings.config is empty");
    else settings = parsed as Record<string, unknown>;
  } catch {
    problems.push("project_settings.config is missing or not JSON");
  }
  const list = (key: string): string[] => {
    const value = settings[key];
    return Array.isArray(value) ? value.map(String) : value === undefined ? [] : [String(value)];
  };

  // load_config_file_config: the filament count is filament_colour's, and every per-filament list is split by it.
  const filaments = list("filament_colour").length;
  if (filaments === 0)
    problems.push("project_settings.config has no filament_colour (Studio: Invalid configuration file)");
  for (const key of ["filament_settings_id", "filament_type", "filament_ids"]) {
    if (list(key).length !== filaments) problems.push(`${key} has ${list(key).length} entries, ${filaments} filaments`);
  }
  // With `extruder_variant_list` the reader expects every per-filament list expanded to a slot for each extruder
  // variant (filament_extruder_variant and filament_self_index of equal size, at least one for each filament), and
  // throws "Invalid configuration file" when they aren't.
  if (settings.extruder_variant_list !== undefined) {
    const variants = list("filament_extruder_variant").length;
    if (variants !== list("filament_self_index").length || variants < filaments)
      problems.push("extruder_variant_list without matching filament_extruder_variant and filament_self_index");
  }
  // validate_presets: a printer or filament preset that isn't one of Studio's system presets (by name, else by
  // `inherits_group`) asks "Customized Preset"; a changed G-code in `different_settings_to_system` asks "Modified G-codes".
  const printer = list("printer_settings_id")[0] ?? "";
  if (!/^Bambu Lab X2D( 0\.[2468] nozzle)?$/.test(printer))
    problems.push(`printer_settings_id "${printer}" is not one of Bambu Studio's X2D presets`);
  for (const name of list("filament_settings_id")) {
    if (!/^(Bambu|Generic) .+ @BBL X2D( 0\.[2468] nozzle)?$/.test(name))
      problems.push(`filament preset "${name}" is not one of Bambu Studio's X2D presets`);
  }
  if (!/ @BBL X2D( 0\.[2468] nozzle)?$/.test(list("print_settings_id")[0] ?? ""))
    problems.push(`print_settings_id "${list("print_settings_id")[0] ?? ""}" is not one of Bambu Studio's X2D presets`);
  const gcodeKeys =
    /(?:^|;)(?:filament_end_gcode|filament_start_gcode|change_filament_gcode|layer_change_gcode|machine_end_gcode|machine_pause_gcode|machine_start_gcode|template_custom_gcode|printing_by_object_gcode|before_layer_change_gcode|time_lapse_gcode|wrapping_detection_gcode)(?:;|$)/;
  if (list("different_settings_to_system").some((value) => gcodeKeys.test(value)))
    problems.push("different_settings_to_system names a G-code setting (Studio asks to confirm modified G-codes)");
  // Bambu's own id of each filament ("GFA00"): the AMS mapping and the printer match trays by it.
  for (const id of list("filament_ids")) {
    if (!/^GF[A-Z]\d{2}$/.test(id)) problems.push(`filament_ids has "${id}", not a Bambu filament id`);
  }

  // model_settings.config: the plate (plater_id from 1, in order) names its G-code, which is in the zip with its
  // MD5 (upper case hex, as Studio writes it, which the printer checks the G-code by), and its thumbnail (a PNG).
  const modelSettings = text("Metadata/model_settings.config") ?? "";
  const plates = [...modelSettings.matchAll(/<plate>([\s\S]*?)<\/plate>/g)].map((m) => m[1] ?? "");
  const meta = (block: string, key: string) =>
    new RegExp(`<metadata\\s+key="${key}"\\s+value="([^"]*)"`).exec(block)?.[1];
  if (plates.length === 0) problems.push("model_settings.config names no plate");
  for (const [i, plate] of plates.entries()) {
    if (meta(plate, "plater_id") !== String(i + 1)) problems.push(`plate ${i + 1}'s plater_id is not ${i + 1}`);
    const gcodeName = meta(plate, "gcode_file");
    if (!gcodeName) problems.push(`plate ${i + 1} names no gcode_file`);
    else {
      const gcode = files[gcodeName];
      if (!gcode) problems.push(`${gcodeName} is named by model_settings.config but not in the file`);
      const md5 = text(`${gcodeName}.md5`);
      if (md5 === undefined) problems.push(`${gcodeName}.md5 is missing`);
      else if (!/^[0-9A-F]{32}$/.test(md5)) problems.push(`${gcodeName}.md5 is not 32 upper case hex digits`);
      else if (gcode && md5 !== md5Hex(gcode)) problems.push(`${gcodeName}.md5 is not the G-code's MD5`);
    }
    const thumbnail = meta(plate, "thumbnail_file");
    if (!thumbnail) problems.push(`plate ${i + 1} names no thumbnail_file (Studio shows no picture)`);
    else {
      const png = files[thumbnail];
      if (!png) problems.push(`${thumbnail} is named by model_settings.config but not in the file`);
      else if (![0x89, 0x50, 0x4e, 0x47].every((byte, k) => png[k] === byte))
        problems.push(`${thumbnail} is not a PNG`);
    }
  }

  // slice_info.config: each <plate> finds its model_settings plate by `index`; its prediction and weight are numbers
  // (Studio reads them with atoi/atof), its filaments (ids from 1) carry type, colour (#RRGGBB) and the id the AMS
  // is matched by, each filament's group_id is a <nozzle> id, and the objects carry the ids the G-code labels them with.
  const sliceInfo = text("Metadata/slice_info.config") ?? "";
  const sliced = [...sliceInfo.matchAll(/<plate>([\s\S]*?)<\/plate>/g)].map((m) => m[1] ?? "");
  if (sliced.length !== plates.length)
    problems.push("slice_info.config has another number of plates than model_settings.config");
  for (const [i, plate] of sliced.entries()) {
    if (meta(plate, "index") !== String(i + 1)) problems.push(`slice_info plate ${i + 1}'s index is not ${i + 1}`);
    if (!/^\d+$/.test(meta(plate, "prediction") ?? "")) problems.push("slice_info prediction is not whole seconds");
    if (!/^\d+(\.\d+)?$/.test(meta(plate, "weight") ?? "")) problems.push("slice_info weight is not a number of grams");
    const diameters = (meta(plate, "nozzle_diameters") ?? "").split(/[ ,]+/).filter(Boolean);
    if (diameters.length === 0 || diameters.some((value) => !(Number(value) > 0)))
      problems.push("slice_info nozzle_diameters isn't a list of diameters");
    // load_nozzle_infos_with_compatibility: the plate's nozzles; the printer's model decides what it can be sent to
    // (SelectMachineDialog::is_blocking_printing refuses a file whose printer_model_id isn't the printer's or compatible).
    if (!/^[A-Z0-9]{2,}$/.test(meta(plate, "printer_model_id") ?? ""))
      problems.push("slice_info printer_model_id is empty or not Bambu's model id (the printer refuses the file)");
    else if (list("printer_model")[0] === "Bambu Lab X2D" && meta(plate, "printer_model_id") !== "N6")
      problems.push(`slice_info printer_model_id is "${meta(plate, "printer_model_id")}", the X2D's is N6`);
    const nozzleIds = [...plate.matchAll(/<nozzle\b[^>]*>/g)].map((m) => attr(m[0], "id"));
    const filamentTags = [...plate.matchAll(/<filament\b[^>]*>/g)].map((m) => m[0]);
    if (filamentTags.length === 0) problems.push("slice_info lists no filament");
    for (const [k, tag] of filamentTags.entries()) {
      if (attr(tag, "id") !== String(k + 1)) problems.push(`slice_info filament ${k + 1}'s id is "${attr(tag, "id")}"`);
      if (!attr(tag, "type")) problems.push(`slice_info filament ${k + 1} has no type`);
      if (!/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(attr(tag, "color") ?? ""))
        problems.push(`slice_info filament ${k + 1}'s colour isn't #RRGGBB`);
      if (!(Number(attr(tag, "used_g")) >= 0) || !(Number(attr(tag, "used_m")) >= 0))
        problems.push(`slice_info filament ${k + 1}'s use isn't numbers`);
      if (!/^GF[A-Z]\d{2}$/.test(attr(tag, "tray_info_idx") ?? ""))
        problems.push(`slice_info filament ${k + 1}'s tray_info_idx is not a Bambu filament id`);
      if (attr(tag, "tray_info_idx") !== list("filament_ids")[k])
        problems.push(`slice_info filament ${k + 1}'s tray_info_idx differs from project_settings' filament_ids`);
      if (attr(tag, "type") !== list("filament_type")[k])
        problems.push(`slice_info filament ${k + 1}'s type differs from project_settings'`);
      if (!nozzleIds.includes(attr(tag, "group_id")))
        problems.push(`slice_info filament ${k + 1}'s group_id is no <nozzle> id`);
    }
    const maps = (meta(plate, "filament_maps") ?? "").split(/\s+/).filter(Boolean);
    if (maps.length !== filamentTags.length) problems.push("slice_info filament_maps isn't one extruder per filament");
    if (maps.some((value) => !/^[12]$/.test(value)))
      problems.push("slice_info filament_maps names an extruder the X2D lacks");
    const objectTags = [...plate.matchAll(/<object\b[^>]*>/g)].map((m) => m[0]);
    const ids = objectTags.map((tag) => attr(tag, "identify_id"));
    if (new Set(ids).size !== ids.length || ids.some((id) => !/^\d+$/.test(id ?? "")))
      problems.push("slice_info objects' identify_ids aren't unique whole numbers");
    for (const tag of objectTags) {
      if (!attr(tag, "name")) problems.push("slice_info lists an object with no name (it can't be told apart to skip)");
      if (attr(tag, "skipped") !== "false") problems.push("slice_info lists an object as skipped");
    }
    // The printer skips an object by the label its moves are wrapped in: the G-code's labels are the plate's objects.
    const gcodeName = meta(plates[i] ?? "", "gcode_file");
    const gcode = gcodeName ? files[gcodeName] : undefined;
    if (gcode && meta(plate, "label_object_enabled") === "true") {
      const head = new TextDecoder().decode(gcode.subarray(0, Math.min(gcode.length, 64 * 1024)));
      const labels = (/; model label id: ([\d,\s]+)/.exec(head)?.[1] ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      if (objectTags.length > 0 && labels.join(",") !== ids.join(","))
        problems.push(`slice_info's object ids (${ids.join(",")}) aren't the G-code's labels (${labels.join(",")})`);
    }
    if (nozzleIds.length === 0) problems.push("slice_info lists no <nozzle>");

    // plate_N.json, which the printer's skip-object view draws from: the same objects, by the same ids.
    const layout = text(`Metadata/plate_${i + 1}.json`);
    if (layout === undefined) problems.push(`plate_${i + 1}.json is missing`);
    else {
      try {
        const json = JSON.parse(layout) as {
          bbox_all?: number[];
          bbox_objects?: { id?: number; name?: string; bbox?: number[] }[];
          filament_colors?: string[];
        };
        if (!Array.isArray(json.bbox_all) || json.bbox_all.length !== 4)
          problems.push("plate json's bbox_all isn't four numbers");
        const jsonIds = (json.bbox_objects ?? []).map((object) => String(object.id));
        if (jsonIds.join(",") !== ids.join(",")) problems.push("plate json's objects aren't slice_info's (by id)");
        if ((json.filament_colors ?? []).length !== filamentTags.length)
          problems.push("plate json's filament_colors aren't one for each filament");
      } catch {
        problems.push(`plate_${i + 1}.json is not JSON`);
      }
    }
  }

  // filament_sequence.json: when there, `plate_N` holds 1-based `sequence` and 0-based `nozzle_sequence`.
  const sequence = text("Metadata/filament_sequence.json");
  if (sequence !== undefined) {
    try {
      const json = JSON.parse(sequence) as Record<string, { sequence?: number[]; nozzle_sequence?: number[] }>;
      for (const [i] of plates.entries()) {
        const entry = json[`plate_${i + 1}`];
        if (!entry || !Array.isArray(entry.sequence) || !Array.isArray(entry.nozzle_sequence))
          problems.push(`filament_sequence.json lacks plate_${i + 1}'s sequences`);
        else if (entry.sequence.some((value) => !(value >= 1 && value <= filaments)))
          problems.push("filament_sequence.json's sequence isn't 1-based filament numbers");
      }
    } catch {
      problems.push("filament_sequence.json is not JSON");
    }
  }
  return problems;
}
