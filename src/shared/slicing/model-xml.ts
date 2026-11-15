/**
 * The model a sliced `.gcode.3mf` carries: the objects' meshes in `3D/3dmodel.model`, laid out as Bambu Studio's own
 * files are (each part of an object a mesh object, an object with several parts a wrapper of components, one build
 * item per object), and what `model_settings.config` says about them (names, parts, filaments, and which objects are
 * on the plate). Without it Bambu Studio shows the sliced preview, but once something changes (a filament, say) it
 * drops that slice and shows the plate from the model: an empty one.
 */

export interface ModelXmlObject {
  name: string;
  /** Nine floats a triangle, in plate coordinates (mm). */
  positions: Float32Array;
  /** The filament it prints in (1 is the first). */
  extruder?: number;
  /** When its parts print in different filaments: triangles `from` (first) `to` (past the last) of `positions`. */
  parts?: { from: number; to: number; extruder?: number; name?: string }[];
  /** The id the G-code labels it with, which the plate's instance carries as its `identify_id`. */
  id?: number;
}

const xmlText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (value: number) => String(Number(value.toPrecision(9)));
const IDENTITY = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1";

/** A mesh object's XML: its vertices shared between triangles, as Studio reads them. */
function meshXml(positions: Float32Array, from: number, to: number): { xml: string; triangles: number } {
  const index = new Map<string, number>();
  const vertices: string[] = [];
  const triangles: string[] = [];
  for (let t = from; t < to; t++) {
    const corner: number[] = [];
    for (let v = 0; v < 3; v++) {
      const at = t * 9 + v * 3;
      const x = positions[at] as number;
      const y = positions[at + 1] as number;
      const z = positions[at + 2] as number;
      if (!Number.isFinite(x + y + z)) break;
      const key = `${x},${y},${z}`;
      let id = index.get(key);
      if (id === undefined) {
        id = vertices.length;
        index.set(key, id);
        vertices.push(`     <vertex x="${num(x)}" y="${num(y)}" z="${num(z)}"/>`);
      }
      corner.push(id);
    }
    if (corner.length === 3 && new Set(corner).size === 3) {
      triangles.push(`     <triangle v1="${corner[0]}" v2="${corner[1]}" v3="${corner[2]}"/>`);
    }
  }
  return {
    xml: `   <mesh>\n    <vertices>\n${vertices.join("\n")}\n    </vertices>\n    <triangles>\n${triangles.join("\n")}\n    </triangles>\n   </mesh>`,
    triangles: triangles.length,
  };
}

export interface ModelXml {
  /** `<resources>` and `<build>` for 3dmodel.model. */
  resources: string;
  /** The `<object>` entries of model_settings.config. */
  objects: string;
  /** The `<model_instance>` entries of its `<plate>`. */
  instances: string;
}

export function modelXml(objects: readonly ModelXmlObject[]): ModelXml {
  let next = 1;
  const resources: string[] = [];
  const build: string[] = [];
  const settings: string[] = [];
  const instances: string[] = [];
  objects.forEach((object, index) => {
    const triangles = Math.floor(object.positions.length / 9);
    const extruder = object.extruder ?? 1;
    // Parts in order, the triangles no part covers (fins, say) printing in the object's filament.
    const ranges: { from: number; to: number; extruder: number; name: string }[] = [];
    let at = 0;
    for (const part of [...(object.parts ?? [])].sort((a, b) => a.from - b.from)) {
      const from = Math.max(part.from, at);
      const to = Math.min(part.to, triangles);
      if (from > at) ranges.push({ from: at, to: from, extruder, name: object.name });
      if (to > from) ranges.push({ from, to, extruder: part.extruder ?? extruder, name: part.name ?? object.name });
      at = Math.max(at, to);
    }
    if (at < triangles || !ranges.length) ranges.push({ from: at, to: triangles, extruder, name: object.name });
    const single = ranges.length === 1;

    const partIds: number[] = [];
    const partXml: string[] = [];
    let faces = 0;
    for (const range of ranges) {
      const mesh = meshXml(object.positions, range.from, range.to);
      faces += mesh.triangles;
      const id = next++;
      partIds.push(id);
      resources.push(`  <object id="${id}" name="${xmlText(range.name)}" type="model">\n${mesh.xml}\n  </object>`);
      partXml.push(
        `    <part id="${id}" subtype="normal_part">\n      <metadata key="name" value="${xmlText(range.name)}"/>\n      <metadata key="matrix" value="${IDENTITY}"/>\n      <metadata key="extruder" value="${range.extruder}"/>\n      <mesh_stat face_count="${mesh.triangles}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n    </part>`,
      );
    }
    let objectId = partIds[0] as number;
    if (!single) {
      objectId = next++;
      resources.push(
        `  <object id="${objectId}" name="${xmlText(object.name)}" type="model">\n   <components>\n${partIds.map((id) => `    <component objectid="${id}"/>`).join("\n")}\n   </components>\n  </object>`,
      );
    }
    build.push(`  <item objectid="${objectId}" transform="1 0 0 0 1 0 0 0 1 0 0 0" printable="1"/>`);
    settings.push(
      `  <object id="${objectId}">\n    <metadata key="name" value="${xmlText(object.name)}"/>\n    <metadata key="extruder" value="${extruder}"/>\n    <metadata face_count="${faces}"/>\n${partXml.join("\n")}\n  </object>`,
    );
    instances.push(
      `    <model_instance>\n      <metadata key="object_id" value="${objectId}"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="${object.id ?? index + 1}"/>\n    </model_instance>`,
    );
  });
  return {
    resources: ` <resources>\n${resources.join("\n")}\n </resources>\n <build>\n${build.join("\n")}\n </build>`,
    objects: settings.join("\n"),
    instances: instances.join("\n"),
  };
}
