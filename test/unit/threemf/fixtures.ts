import { strToU8, zipSync } from "fflate";

/** Hand-written stand-ins for what Bambu Studio and Orca Slicer write: same structure, invented content. */

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
export const PNG_2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);

export function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] = typeof content === "string" ? strToU8(content) : content;
  }
  return zipSync(entries);
}

const xmlHead = '<?xml version="1.0" encoding="UTF-8"?>\n';

export const modelHead = (app: string) =>
  `${xmlHead}<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">${app}</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources/>
 <build/>
</model>`;

export const modelSettings = `${xmlHead}<config>
  <object id="2">
    <metadata key="name" value="Benchy &amp; friends"/>
    <metadata key="extruder" value="1"/>
    <part id="1" subtype="normal_part"><metadata key="name" value="hull"/></part>
  </object>
  <object id="5">
    <metadata key="name" value="Lid"/>
    <metadata key="extruder" value="2"/>
  </object>
  <object id="7">
    <metadata key="name" value="Spool holder"/>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="Hull"/>
    <metadata key="locked" value="false"/>
    <metadata key="bed_type" value="Textured PEI Plate"/>
    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>
    <model_instance>
      <metadata key="object_id" value="2"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="466"/>
    </model_instance>
    <model_instance>
      <metadata key="object_id" value="5"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="470"/>
    </model_instance>
  </plate>
  <plate>
    <metadata key="plater_id" value="2"/>
    <metadata key="plater_name" value=""/>
    <model_instance>
      <metadata key="object_id" value="7"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>
  </plate>
</config>`;

export const sliceInfo = `${xmlHead}<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="02.01.00.00"/>
  </header>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="printer_model_id" value="N1"/>
    <metadata key="nozzle_diameters" value="0.4"/>
    <metadata key="prediction" value="5400"/>
    <metadata key="weight" value="23.45"/>
    <metadata key="support_used" value="false"/>
    <object identify_id="466" name="Benchy &amp; friends" skipped="false" />
    <object identify_id="470" name="Lid" skipped="true" />
    <filament id="2" tray_info_idx="GFA00" type="PLA" color="#FFFFFF" used_m="1.50" used_g="4.50" />
    <filament id="1" tray_info_idx="GFA00" type="PLA" color="#00AE42FF" used_m="6.30" used_g="18.95" />
    <warning msg="bed_temperature_too_high_than_filament" level="1" error_code="1000C001"/>
  </plate>
  <plate>
    <metadata key="index" value="2"/>
    <metadata key="prediction" value="720.5"/>
    <metadata key="weight" value="3.1"/>
    <metadata key="support_used" value="true"/>
    <object identify_id="480" name="Spool holder" skipped="false" />
    <filament id="3" tray_info_idx="GFG00" type="PETG" color="#C12E1F" used_m="1.0" used_g="3.1" />
  </plate>
</config>`;

export const projectSettings = JSON.stringify({
  printer_model: "Bambu Lab X2D",
  printer_settings_id: "Bambu Lab X2D 0.4 nozzle",
  print_settings_id: "0.20mm Standard @BBL X2D",
  layer_height: "0.2",
  initial_layer_print_height: "0.2",
  sparse_infill_density: "15%",
  sparse_infill_pattern: "grid",
  wall_loops: "3",
  enable_support: "0",
  support_type: "normal(auto)",
  nozzle_diameter: ["0.4"],
  curr_bed_type: "Textured PEI Plate",
  nozzle_temperature: ["220", "220", "255"],
  nozzle_temperature_initial_layer: ["220", "220", "255"],
  textured_plate_temp: ["55", "55", "70"],
  hot_plate_temp: ["60", "60", "80"],
  filament_type: ["PLA", "PLA", "PETG"],
  filament_colour: ["#00AE42", "#FFFFFF", "#C12E1F"],
  filament_settings_id: ["Bambu PLA Basic @BBL X2D", "Generic PLA", "Bambu PETG HF"],
  some_future_key: { nested: true },
});

export const plateJson = (bed: string) =>
  JSON.stringify({
    bbox_all: [10, 10, 90, 90],
    bbox_objects: [{ name: "Benchy", bbox: [10, 10, 90, 90], area: 1, layer_height: 0.2 }],
    filament_ids: [0, 1],
    filament_colors: ["#00AE42", "#FFFFFF"],
    is_seq_print: false,
    first_extruder: 0,
    nozzle_diameter: 0.4000000059604645,
    version: 2,
    bed_type: bed,
    first_layer_time: 120,
  });

export const slicedFiles = (): Record<string, string | Uint8Array> => ({
  "[Content_Types].xml": `${xmlHead}<Types/>`,
  "3D/3dmodel.model": modelHead("BambuStudio-02.01.00.00"),
  "Metadata/model_settings.config": modelSettings,
  "Metadata/slice_info.config": sliceInfo,
  "Metadata/project_settings.config": projectSettings,
  "Metadata/plate_1.png": PNG,
  "Metadata/plate_2.png": PNG_2,
  "Metadata/plate_1.json": plateJson("Textured PEI Plate"),
  "Metadata/plate_1.gcode": "; HEADER_BLOCK_START\n; total estimated time: 1h 30m\nG1 X1 Y1\n",
});
