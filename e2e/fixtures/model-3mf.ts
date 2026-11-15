import { strToU8, zipSync } from "fflate";

type Vec = [number, number, number];

/**
 * A box as a 3MF mesh, its lowest corner at `at`, its faces turned outward; `paint` gives some of its triangles
 * painted colours (`paint_color`, Orca's codes), by their index: 2 and 3 are the top.
 */
function boxMesh([x, y, z]: Vec, [w, d, h]: Vec, paint: Record<number, string> = {}): string {
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
  const triangles = faces
    .map(([a, b, c], index) => {
      const code = paint[index];
      return `<triangle v1="${a}" v2="${b}" v3="${c}"${code ? ` paint_color="${code}"` : ""}/>`;
    })
    .join("");
  return `<mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh>`;
}

/** The colours of `hotdogModel`: eight named ones, two of them (the reds, the creams) near each other. */
export const HOTDOG_COLOURS: { name: string; hex: string }[] = [
  { name: "Ketchup Red", hex: "#D2281E" },
  { name: "Tomato Red", hex: "#CC3A2B" },
  { name: "Mustard", hex: "#E3B505" },
  { name: "Bun", hex: "#D9A25E" },
  { name: "Sausage", hex: "#8F3B2A" },
  { name: "Lettuce", hex: "#5FAE3B" },
  { name: "Cream", hex: "#F3E9D2" },
  { name: "Ivory", hex: "#F1E8D8" },
  { name: "Grape", hex: "#6E32A0" },
];

/**
 * A plain 3MF as a model site or a CAD tool gives it, with no Bambu metadata: fourteen small boxes in a row, each an
 * object with its own colour from the core's `basematerials` (nine named colours, `displaycolor` with an alpha
 * byte), no colours on single triangles.
 */
export function hotdogModel(): Uint8Array {
  const bases = HOTDOG_COLOURS.map((c) => `<base name="${c.name}" displaycolor="${c.hex}FF"/>`).join("");
  // Which colour each object takes: more than one object in some colours.
  const order = [0, 2, 3, 3, 4, 5, 1, 6, 7, 6, 0, 2, 4, 8];
  const objects = order
    .map(
      (colour, index) =>
        `<object id="${index + 2}" type="model" name="Part ${index + 1}" pid="1" pindex="${colour}">${boxMesh([index * 12, 0, 0], [10, 10, 6])}</object>`,
    )
    .join("");
  const items = order.map(
    (_, index) => `<item objectid="${index + 2}" transform="1 0 0 0 1 0 0 0 1 ${60 + index * 12} 100 0"/>`,
  );
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources><basematerials id="1">${bases}</basematerials>${objects}</resources>
<build>${items.join("")}</build>
</model>`;
  return zipSync({ "3D/3dmodel.model": strToU8(model) });
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
 * A Bambu Studio or OrcaSlicer project of one object made of two parts in different filaments: a two-tone coaster,
 * its left half printing in filament 1 (white PLA) and its right half in filament 2 (red PLA), as such a project says
 * it (each part's `extruder` in model_settings.config). Our own slicer prints each half in its filament since the app
 * hands it the parts (slicer-rs-v16's add_part); OrcaSlicer's engine gets the object whole, its red half painted in
 * filament 2. Without `settings`, it is such a file as other programs write: the parts' filaments named, but no
 * project settings listing them, so no material or colour for them.
 */
export function partsProject({ settings: withSettings = true }: { settings?: boolean } = {}): Uint8Array {
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>
<object id="1" type="model">${boxMesh([116, 116, 0], [12, 24, 3])}</object>
<object id="2" type="model">${boxMesh([128, 116, 0], [12, 24, 3])}</object>
<object id="3" type="model"><components><component objectid="1"/><component objectid="2"/></components></object>
</resources>
<build><item objectid="3"/></build>
</model>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="3">
    <metadata key="name" value="Two-tone coaster"/>
    <metadata key="extruder" value="1"/>
    <part id="1" subtype="normal_part"><metadata key="name" value="White half"/><metadata key="extruder" value="1"/></part>
    <part id="2" subtype="normal_part"><metadata key="name" value="Red half"/><metadata key="extruder" value="2"/></part>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <model_instance><metadata key="object_id" value="3"/></model_instance>
  </plate>
</config>`;
  const project = { filament_type: ["PLA", "PLA"], filament_colour: ["#F2EEE4", "#C2412D"] };
  return zipSync({
    "3D/3dmodel.model": strToU8(model),
    "Metadata/model_settings.config": strToU8(settings),
    ...(withSettings ? { "Metadata/project_settings.config": strToU8(JSON.stringify(project)) } : {}),
  });
}

/**
 * A Bambu Studio or OrcaSlicer project of one object made of three parts in two filaments: a T whose column's left
 * half prints in filament 1 (white PLA), its right half in filament 2 (red PLA), and its bar on top in filament 1, its
 * arms 16 mm out over the plate, so they need supports. Ours works them out for the whole T since slicer-rs-v18, and
 * prints each layer's in the filament the layer starts with, as Orca does; before, it left such objects to OrcaSlicer's
 * engine.
 */
export function tPartsProject(): Uint8Array {
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>
<object id="1" type="model">${boxMesh([122, 122, 0], [6, 12, 20])}</object>
<object id="2" type="model">${boxMesh([128, 122, 0], [6, 12, 20])}</object>
<object id="3" type="model">${boxMesh([106, 122, 20], [44, 12, 5])}</object>
<object id="4" type="model"><components><component objectid="1"/><component objectid="2"/><component objectid="3"/></components></object>
</resources>
<build><item objectid="4"/></build>
</model>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="4">
    <metadata key="name" value="Two-tone T"/>
    <metadata key="extruder" value="1"/>
    <part id="1" subtype="normal_part"><metadata key="name" value="Left"/><metadata key="extruder" value="1"/></part>
    <part id="2" subtype="normal_part"><metadata key="name" value="Right"/><metadata key="extruder" value="2"/></part>
    <part id="3" subtype="normal_part"><metadata key="name" value="Bar"/><metadata key="extruder" value="1"/></part>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <model_instance><metadata key="object_id" value="4"/></model_instance>
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
 * A Bambu Studio or OrcaSlicer project of one coaster with a bow tie painted on its top: each of the top's two
 * triangles halved along the other diagonal (Orca's code 5 and 9, a split of one side), the front and back quarters
 * painted in filament 2 (red PLA, 8), the left and right ones left in the coaster's own (0, white PLA). Both slicers
 * print the paint as Orca does: the bow tie red down through the top's shells.
 */
export function paintedProject(): Uint8Array {
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>
<object id="1" type="model">${boxMesh([116, 116, 0], [24, 24, 3], { 2: "085", 3: "089" })}</object>
</resources>
<build><item objectid="1"/></build>
</model>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1"><metadata key="name" value="Farfalle coaster"/><metadata key="extruder" value="1"/></object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <model_instance><metadata key="object_id" value="1"/></model_instance>
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
 * raft of two layers (`raft_layers`) and for `settings` besides: a project for the printer in use says all its
 * settings. Our own slicer refused rafts until release 17, under organic trees until release 20, and still refuses
 * one under Orca's classic trees (slim, strong or hybrid).
 */
export function raftProject(settings: Record<string, string> = {}): Uint8Array {
  return boxProject({ raft_layers: "2", ...settings });
}

/**
 * The same block in a project whose sparse infill is `pattern`: one of the patterns only a project asks for, which
 * our own slicer printed as straight lines until release 11 (triangles, tri-hexagon, quarter cubic).
 */
export function patternProject(pattern: string): Uint8Array {
  return boxProject({ sparse_infill_pattern: pattern });
}

/**
 * The same block in a project printed in spiral vase mode (`spiral_mode`): its bottom, then one wall rising as it goes
 * round. Our own slicer refused spiral vases until release 12.
 */
export function vaseProject(): Uint8Array {
  return boxProject({ spiral_mode: "1" });
}

/**
 * The same block in a project whose brim is `brim`: brim ears ("brim_ears", a disc at each sharp corner) or a brim
 * inside holes ("inner_only", "outer_and_inner"), which our own slicer refused until release 14.
 */
export function brimProject(brim: string): Uint8Array {
  return boxProject({ brim_type: brim });
}

/**
 * The same block in a project that asks for its seams `position` (`seam_position`: "nearest" or "random"), which our
 * own slicer places as aligned ones since release 13, saying so.
 */
export function seamProject(position: string): Uint8Array {
  return boxProject({ seam_position: position });
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

/** A one-pixel grey-green picture standing in for the plate renders Bambu Studio puts in a project (Metadata/plate_N.png). */
const PLATE_PICTURE = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOYtmwGAAOqAdVTRFctAAAAAElFTkSuQmCC"),
  (char) => char.charCodeAt(0),
);

/**
 * A MakerWorld-style Bambu project of stackable bins in three heights, a plate each (120, 96 and 57.6 mm), laid out
 * on Bambu's plate grid (1.2 bed sizes apart: plate 2 at x + 307.2, plate 3 at y - 307.2) with the project's own
 * pictures. Every bin is 70 mm square and stands where its plate's middle is.
 */
export function platesProject(count = 3): Uint8Array {
  const heights = [120, 96, 57.6, 80, 40, 108, 70].slice(0, count);
  // Bambu's grid: round(sqrt(plates)) columns (one more if that fell short), 1.2 beds apart, rows going down.
  const root = Math.sqrt(count);
  const columns = Math.max(1, root > Math.round(root) ? Math.round(root) + 1 : Math.round(root));
  const spots: [number, number][] = heights.map((_, n) => [(n % columns) * 307.2, -Math.floor(n / columns) * 307.2]);
  const objects = heights
    .map((h, n) => `<object id="${n * 2 + 2}" type="model">${boxMesh([-35, -35, 0], [70, 70, h])}</object>`)
    .join("");
  const items = spots
    .map(
      ([x, y], n) =>
        `<item objectid="${n * 2 + 2}" transform="1 0 0 0 1 0 0 0 1 ${128 + x} ${128 + y} 0" printable="1"/>`,
    )
    .join("");
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>${objects}</resources>
<build>${items}</build>
</model>`;
  const names = heights.map((_, n) => `Bin ${n + 1}`);
  const plates = heights
    .map(
      (_, n) => `<plate>
    <metadata key="plater_id" value="${n + 1}"/>
    <metadata key="plater_name" value=""/>
    <metadata key="thumbnail_file" value="Metadata/plate_${n + 1}.png"/>
    <model_instance><metadata key="object_id" value="${n * 2 + 2}"/><metadata key="instance_id" value="0"/></model_instance>
  </plate>`,
    )
    .join("");
  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>${names
    .map(
      (name, n) =>
        `<object id="${n * 2 + 2}"><metadata key="name" value="${name}"/><metadata key="extruder" value="1"/></object>`,
    )
    .join("")}${plates}</config>`;
  const project = { printer_model: "Bambu Lab X2D", nozzle_diameter: ["0.4", "0.4"] };
  return zipSync({
    "3D/3dmodel.model": strToU8(model),
    "Metadata/model_settings.config": strToU8(settings),
    "Metadata/project_settings.config": strToU8(JSON.stringify(project)),
    ...Object.fromEntries(heights.map((_, n) => [`Metadata/plate_${n + 1}.png`, PLATE_PICTURE])),
  });
}
