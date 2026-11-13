import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { boundsOf } from "../../../src/shared/slicing/arrange.ts";
import { readModel3mf } from "../../../src/shared/slicing/model3mf.ts";

/** One mesh: a 10 mm triangle prism's corners, enough to measure. */
const MESH = `<mesh><vertices>
  <vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/>
</vertices><triangles>
  <triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="0" v2="3" v3="2"/>
</triangles></mesh>`;

const model = (body: string, unit = "millimeter") =>
  `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
${body}
</model>`;

const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));

describe("readModel3mf", () => {
  it("reads a plain 3MF's objects where its build items put them, in millimetres", () => {
    const read = readModel3mf(
      zip({
        "3D/3dmodel.model": model(
          `<resources><object id="1" type="model" name="Wedge">${MESH}</object></resources>
           <build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 100 50 2"/><item objectid="1" transform="2 0 0 0 2 0 0 0 2 0 0 0"/></build>`,
          "centimeter",
        ),
      }),
    );
    if (typeof read === "string") throw new Error(read);
    expect(read.project).toBe(false);
    expect(read.sliced).toBe(false);
    expect(read.objects.map((object) => object.name)).toEqual(["Wedge", "Wedge"]);
    // Centimetres: the mesh is 100 mm, the first item moved by 100 cm, 50 cm and 2 cm.
    expect(boundsOf(read.objects[0]?.positions ?? new Float32Array())).toEqual({
      min: [1000, 500, 20],
      max: [1100, 600, 120],
    });
    expect(boundsOf(read.objects[1]?.positions ?? new Float32Array()).max).toEqual([200, 200, 200]);
  });

  it("follows components into other model files, and reads a Bambu or Orca project's names, filaments, plate and settings", () => {
    const read = readModel3mf(
      zip({
        "3D/3dmodel.model": model(
          `<resources>
             <object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0"/><component p:path="/3D/Objects/object_1.model" objectid="9"/></components></object>
             <object id="4" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1"/></components></object>
             <object id="6" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1"/></components></object>
           </resources>
           <build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 20 20 0"/><item objectid="4"/><item objectid="6" printable="0"/></build>`,
        ),
        "3D/Objects/object_1.model": model(
          `<resources><object id="1" type="model">${MESH}</object><object id="9" type="model">${MESH}</object></resources>`,
        ),
        "Metadata/model_settings.config": `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="2">
    <metadata key="name" value="Badge"/>
    <metadata key="extruder" value="2"/>
    <part id="1" subtype="normal_part"><metadata key="name" value="body"/></part>
    <part id="9" subtype="negative_part"><metadata key="name" value="hole"/></part>
  </object>
  <object id="4"><metadata key="name" value="Spare"/></object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <model_instance><metadata key="object_id" value="2"/></model_instance>
  </plate>
  <plate>
    <metadata key="plater_id" value="2"/>
    <model_instance><metadata key="object_id" value="4"/></model_instance>
  </plate>
</config>`,
        "Metadata/project_settings.config": JSON.stringify({ printer_model: "Bambu Lab X2D", layer_height: "0.16" }),
      }),
    );
    if (typeof read === "string") throw new Error(read);
    expect(read.project).toBe(true);
    // Only plate 1's objects; the negative part is left out.
    expect(read.objects).toHaveLength(1);
    expect(read.objects[0]).toMatchObject({ name: "Badge", extruder: 2 });
    expect(read.objects[0]?.positions.length).toBe(4 * 9);
    expect(boundsOf(read.objects[0]?.positions ?? new Float32Array()).min).toEqual([25, 20, 0]);
    expect(read.settings).toEqual({ printer_model: "Bambu Lab X2D", layer_height: "0.16" });
  });

  it("knows a sliced file, and says what it can't read", () => {
    const sliced = readModel3mf(
      zip({
        "3D/3dmodel.model": model(
          `<resources><object id="1" type="model">${MESH}</object></resources><build><item objectid="1"/></build>`,
        ),
        "Metadata/plate_1.gcode": "G28\n",
      }),
    );
    expect(typeof sliced !== "string" && sliced.sliced).toBe(true);
    expect(readModel3mf(strToU8("not a zip"))).toBe("not-3mf");
    expect(readModel3mf(zip({ "readme.txt": "hello" }))).toBe("not-3mf");
    expect(readModel3mf(zip({ "3D/3dmodel.model": model("<resources/><build/>") }))).toBe("no-objects");
    expect(
      readModel3mf(
        zip({
          "3D/3dmodel.model": model(
            `<resources><object id="1" type="support">${MESH}</object></resources><build><item objectid="1"/></build>`,
          ),
        }),
      ),
    ).toBe("no-objects");
  });
});
