import { strToU8, zipSync } from "fflate";

type Vec = [number, number, number];

/** A box as a 3MF mesh, its lowest corner at `at`, its faces turned outward. */
function boxMesh([x, y, z]: Vec, [w, d, h]: Vec): string {
  const corners: Vec[] = [
    [x, y, z],
    [x + w, y, z],
    [x + w, y + d, z],
    [x, y + d, z],
    [x, y, z + h],
    [x + w, y, z + h],
    [x + w, y + d, z + h],
    [x, y + d, z + h],
  ];
  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [2, 3, 7],
    [2, 7, 6],
    [0, 4, 7],
    [0, 7, 3],
    [1, 2, 6],
    [1, 6, 5],
  ];
  const vertices = corners.map(([vx, vy, vz]) => `<vertex x="${vx}" y="${vy}" z="${vz}"/>`).join("");
  const triangles = faces.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join("");
  return `<mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh>`;
}

/**
 * A Bambu Studio or OrcaSlicer project of two coasters side by side on its plate, the first printing in filament 1
 * (white PLA), the second in filament 2 (red PLA): a plate in two colours, as such a project says it (each object's
 * `extruder` in model_settings.config, the filaments in project_settings.config).
 */
export function twoColourProject(): Uint8Array {
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>
<object id="1" type="model">${boxMesh([96, 118, 0], [24, 24, 3])}</object>
<object id="2" type="model">${boxMesh([136, 118, 0], [24, 24, 3])}</object>
</resources>
<build><item objectid="1"/><item objectid="2"/></build>
</model>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1"><metadata key="name" value="White coaster"/><metadata key="extruder" value="1"/></object>
  <object id="2"><metadata key="name" value="Red coaster"/><metadata key="extruder" value="2"/></object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <model_instance><metadata key="object_id" value="1"/></model_instance>
    <model_instance><metadata key="object_id" value="2"/></model_instance>
  </plate>
</config>`;
  const project = { filament_type: ["PLA", "PLA"], filament_colour: ["#F2EEE4", "#C2412D"] };
  return zipSync({
    "3D/3dmodel.model": strToU8(model),
    "Metadata/model_settings.config": strToU8(settings),
    "Metadata/project_settings.config": strToU8(JSON.stringify(project)),
  });
}

/**
 * A Bambu Studio or OrcaSlicer project made for the X2D with its 0.4 mm nozzle, a block on its plate, that asks for a
 * raft of two layers (`raft_layers`): a project for the printer in use says all its settings, and our own slicer
 * can't build a raft yet.
 */
export function raftProject(): Uint8Array {
  return boxProject({ raft_layers: "2" });
}

/**
 * The same block in a project whose sparse infill is `pattern`: one of the patterns only a project asks for, which
 * our own slicer printed as straight lines until release 11 (triangles, tri-hexagon, quarter cubic).
 */
export function patternProject(pattern: string): Uint8Array {
  return boxProject({ sparse_infill_pattern: pattern });
}

/** A 24 × 24 × 10 mm block in a project for the X2D, its settings Orca's defaults but `settings`. */
function boxProject(settings: Record<string, string>): Uint8Array {
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>
<object id="1" type="model">${boxMesh([116, 116, 0], [24, 24, 10])}</object>
</resources>
<build><item objectid="1"/></build>
</model>`;
  const project = { printer_model: "Bambu Lab X2D", nozzle_diameter: ["0.4", "0.4"], ...settings };
  return zipSync({
    "3D/3dmodel.model": strToU8(model),
    "Metadata/project_settings.config": strToU8(JSON.stringify(project)),
  });
}
