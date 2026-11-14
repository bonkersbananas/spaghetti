import { strFromU8, unzipSync } from "fflate";

/**
 * What Bambu Studio's own reader needs to open a zip as a sliced plate, from its source
 * (`_BBS_3MF_Importer::_load_model_from_file`, `_handle_end_metadata`, `Plater::priv::load_files`):
 *
 * - `3D/3dmodel.model`'s `Application` starts with "BambuStudio-" and then a version, or the reader sets
 *   `dont_load_config` and skips the config, the G-code and the slice info: "The file does not contain any
 *   geometry data." (2.0.0 or newer, or it treats the file as an old project.)
 * - `Metadata/project_settings.config` is a non-empty settings object (an empty config turns the config off).
 * - `Metadata/model_settings.config` names each plate's `gcode_file`, and that entry is in the zip, with its
 *   `.md5`; `Metadata/slice_info.config` is there too.
 *
 * Returns what is wrong, none when Bambu Studio would open it in its preview.
 */
export function bambuStudioProblems(zip: Uint8Array): string[] {
  const problems: string[] = [];
  const files = unzipSync(zip);
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : undefined);

  const model = text("3D/3dmodel.model") ?? "";
  const app = /<metadata\s+name="Application">([^<]*)</.exec(model)?.[1] ?? "";
  const version = /^BambuStudio-(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/.exec(app);
  if (!version) problems.push(`Application is "${app}", not "BambuStudio-<version>"`);
  else if (Number(version[1]) < 2) problems.push(`Application ${app} is older than 2.0.0`);

  try {
    const settings: unknown = JSON.parse(text("Metadata/project_settings.config") ?? "");
    if (!settings || typeof settings !== "object" || Object.keys(settings).length === 0)
      problems.push("project_settings.config is empty");
  } catch {
    problems.push("project_settings.config is missing or not JSON");
  }

  const modelSettings = text("Metadata/model_settings.config") ?? "";
  const gcodeFiles = [...modelSettings.matchAll(/<metadata\s+key="gcode_file"\s+value="([^"]*)"/g)].map(
    (m) => m[1] ?? "",
  );
  if (gcodeFiles.length === 0) problems.push("model_settings.config names no plate's gcode_file");
  for (const name of gcodeFiles) {
    if (!files[name]) problems.push(`${name} is named by model_settings.config but not in the file`);
    if (!files[`${name}.md5`]) problems.push(`${name}.md5 is missing`);
  }
  if (!files["Metadata/slice_info.config"]) problems.push("slice_info.config is missing");
  return problems;
}
