/**
 * A stand-in for a sliced Bambu Studio `.gcode.3mf` from the X2D: two plates
 * (cable clips in green PLA, a hook in white PETG) with their pictures, stats
 * and settings, laid out as the slicer writes them. Used by the e2e tests and
 * the screenshot seed. Invented content, real structure (docs/printer.md).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";

const here = import.meta.dirname;
const xml = '<?xml version="1.0" encoding="UTF-8"?>\n';

const model = `${xml}<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">BambuStudio-02.01.00.00</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources/>
 <build/>
</model>`;

const modelSettings = `${xml}<config>
  <object id="2"><metadata key="name" value="Cable clip"/><metadata key="extruder" value="1"/></object>
  <object id="4"><metadata key="name" value="Desk hook"/><metadata key="extruder" value="2"/></object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="Cable clips"/>
    <metadata key="bed_type" value="Textured PEI Plate"/>
    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>
    <model_instance><metadata key="object_id" value="2"/><metadata key="identify_id" value="101"/></model_instance>
  </plate>
  <plate>
    <metadata key="plater_id" value="2"/>
    <metadata key="plater_name" value="Hook"/>
    <metadata key="bed_type" value="Textured PEI Plate"/>
    <metadata key="thumbnail_file" value="Metadata/plate_2.png"/>
    <model_instance><metadata key="object_id" value="4"/><metadata key="identify_id" value="201"/></model_instance>
  </plate>
</config>`;

const sliceInfo = `${xml}<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="02.01.00.00"/>
  </header>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="nozzle_diameters" value="0.4"/>
    <metadata key="prediction" value="4320"/>
    <metadata key="weight" value="18.4"/>
    <metadata key="support_used" value="false"/>
    <object identify_id="101" name="Cable clip" skipped="false" />
    <filament id="1" tray_info_idx="GFA00" type="PLA" color="#00AE42FF" used_m="6.10" used_g="18.40" />
  </plate>
  <plate>
    <metadata key="index" value="2"/>
    <metadata key="nozzle_diameters" value="0.4"/>
    <metadata key="prediction" value="2700"/>
    <metadata key="weight" value="11.2"/>
    <metadata key="support_used" value="true"/>
    <object identify_id="201" name="Desk hook" skipped="false" />
    <filament id="2" tray_info_idx="GFG99" type="PETG" color="#FFFFFFFF" used_m="3.60" used_g="11.20" />
  </plate>
</config>`;

const projectSettings = JSON.stringify({
  printer_model: "Bambu Lab X2D",
  printer_settings_id: "Bambu Lab X2D 0.4 nozzle",
  print_settings_id: "0.20mm Standard @BBL X2D",
  layer_height: "0.2",
  initial_layer_print_height: "0.2",
  sparse_infill_density: "15%",
  sparse_infill_pattern: "grid",
  wall_loops: "3",
  enable_support: "0",
  support_type: "tree(auto)",
  nozzle_diameter: ["0.4"],
  curr_bed_type: "Textured PEI Plate",
  nozzle_temperature: ["220", "250"],
  nozzle_temperature_initial_layer: ["220", "250"],
  textured_plate_temp: ["55", "70"],
  filament_type: ["PLA", "PETG"],
  filament_colour: ["#00AE42", "#FFFFFF"],
  filament_settings_id: ["Bambu PLA Basic @BBL X2D", "Generic PETG @BBL X2D"],
});

/** The file's bytes; `name` is what tests and the seed call it. */
export const SLICER_FILE_NAME = "desk-clips.gcode.3mf";

export function slicerFile(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(`${xml}<Types/>`),
    "3D/3dmodel.model": strToU8(model),
    "Metadata/model_settings.config": strToU8(modelSettings),
    "Metadata/slice_info.config": strToU8(sliceInfo),
    "Metadata/project_settings.config": strToU8(projectSettings),
    "Metadata/plate_1.png": new Uint8Array(readFileSync(join(here, "plate-clips.png"))),
    "Metadata/plate_2.png": new Uint8Array(readFileSync(join(here, "plate-hook.png"))),
    "Metadata/plate_1.gcode": strToU8("; HEADER_BLOCK_START\n; total estimated time: 1h 12m\nG28\n"),
  });
}
