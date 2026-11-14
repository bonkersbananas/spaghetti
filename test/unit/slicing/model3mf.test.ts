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

  it("reads each part of an object whose parts print in different filaments, as its triangles and filament", () => {
    const read = readModel3mf(
      zip({
        "3D/3dmodel.model": model(
          `<resources>
             <object id="1" type="model">${MESH}</object>
             <object id="2" type="model">${MESH}</object>
             <object id="3" type="model">${MESH}</object>
             <object id="7" type="model">${MESH}</object>
             <object id="8" type="model"><components><component objectid="2"/><component objectid="3" transform="1 0 0 0 1 0 0 0 1 0 20 0"/></components></object>
             <object id="10" type="model"><components><component objectid="1"/><component objectid="7"/><component objectid="8" transform="1 0 0 0 1 0 0 0 1 20 0 0"/><component objectid="3"/></components></object>
             <object id="11" type="model"><components><component objectid="1"/><component objectid="2"/></components></object>
           </resources>
           <build><item objectid="10"/><item objectid="11" transform="1 0 0 0 1 0 0 0 1 60 0 0"/></build>`,
        ),
        "Metadata/model_settings.config": `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="10">
    <metadata key="name" value="Sign"/>
    <metadata key="extruder" value="1"/>
    <part id="1" subtype="normal_part"><metadata key="name" value="board"/></part>
    <part id="7" subtype="modifier_part"/>
    <part id="8" subtype="normal_part"><metadata key="name" value="letters"/><metadata key="extruder" value="2"/></part>
    <part id="3" subtype="normal_part"><metadata key="extruder" value="3"/></part>
  </object>
  <object id="11">
    <metadata key="name" value="Plain"/>
    <part id="1" subtype="normal_part"><metadata key="extruder" value="2"/></part>
    <part id="2" subtype="normal_part"><metadata key="extruder" value="2"/></part>
  </object>
</config>`,
      }),
    );
    if (typeof read === "string") throw new Error(read);
    const [sign, plain] = read.objects;
    // The board in the object's filament; the letters (a part of two meshes) in 2, the last part in 3; the modifier
    // left out. The object's triangles are its parts' in that order, as before.
    expect(sign?.positions.length).toBe(4 * 4 * 9);
    expect(sign?.extruder).toBe(1);
    expect(sign?.parts).toEqual([
      { from: 0, to: 4, extruder: 1 },
      { from: 4, to: 12, extruder: 2 },
      { from: 12, to: 16, extruder: 3 },
    ]);
    // Parts that all print in one filament are just the object.
    expect(plain?.parts).toBeUndefined();
  });

  it("reads a project's painted colours, as triangles of its object with their codes", () => {
    // The prism with paint on some triangles: `codes` by triangle, in the mesh's order.
    const painted = (codes: (string | null)[]) =>
      MESH.replace(/<triangle ([^/]*)\/>/g, (tag, inner: string) => {
        const code = codes.shift();
        return code ? `<triangle ${inner} paint_color="${code}"/>` : tag;
      });
    const read = readModel3mf(
      zip({
        "3D/3dmodel.model": model(
          `<resources>
             <object id="1" type="model">${painted([null, "8", null, "081"])}</object>
             <object id="7" type="model">${painted(["4", "4", "4", "4"])}</object>
             <object id="2" type="model">${painted(["0", null, "G8", "4"])}</object>
             <object id="10" type="model"><components><component objectid="1"/><component objectid="7"/><component objectid="2"/></components></object>
             <object id="11" type="model">${MESH}</object>
           </resources>
           <build><item objectid="10"/><item objectid="11" transform="1 0 0 0 1 0 0 0 1 60 0 0"/></build>`,
        ),
        "Metadata/model_settings.config": `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="10">
    <metadata key="name" value="Painted"/>
    <part id="1" subtype="normal_part"/>
    <part id="7" subtype="modifier_part"/>
    <part id="2" subtype="normal_part"/>
  </object>
</config>`,
      }),
    );
    if (typeof read === "string") throw new Error(read);
    const [object, plain] = read.objects;
    // The first part's second and fourth triangles, and the second part's last (the object's eighth); the modifier's
    // paint left out with it, a code that paints nothing (state 0) or isn't one ("G8") left out as Orca leaves it.
    expect(object?.positions.length).toBe(8 * 9);
    expect([...(object?.paint?.triangles ?? [])]).toEqual([1, 3, 7]);
    expect(object?.paint?.codes).toBe("80814");
    expect([...(object?.paint?.ends ?? [])]).toEqual([1, 4, 5]);
    expect(plain?.paint).toBeUndefined();
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

describe("readModel3mf plates", () => {
  /** A project of `count` plates with one 10 mm prism each, laid out on Bambu's grid (1.2 × a 256 mm bed). */
  const project = (count: number, names: string[] = []) => {
    const columns =
      Math.round(Math.sqrt(count)) < Math.sqrt(count) ? Math.round(Math.sqrt(count)) + 1 : Math.round(Math.sqrt(count));
    const ids = Array.from({ length: count }, (_, n) => n * 2 + 2);
    const items = ids.map((id, n) => {
      const x = 128 + (n % columns) * 307.2;
      const y = 128 - Math.floor(n / columns) * 307.2;
      return `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${x} ${y} 0"/>`;
    });
    const objects = ids.map(
      (id) => `<object id="${id}" type="model">${MESH.replace('z="10"', `z="${id * 10}"`)}</object>`,
    );
    const plates = ids.map(
      (
        id,
        n,
      ) => `<plate><metadata key="plater_id" value="${n + 1}"/><metadata key="plater_name" value="${names[n] ?? ""}"/>
        <metadata key="thumbnail_file" value="Metadata/plate_${n + 1}.png"/>
        <model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="0"/></model_instance></plate>`,
    );
    const settings = ids.map((id) => `<object id="${id}"><metadata key="name" value="Bin ${id}"/></object>`);
    return zip({
      "3D/3dmodel.model": model(`<resources>${objects.join("")}</resources><build>${items.join("")}</build>`),
      "Metadata/model_settings.config": `<config>${settings.join("")}${plates.join("")}</config>`,
    });
  };
  const read = (bytes: Uint8Array, plate?: number) => {
    const out = readModel3mf(bytes, { plate });
    if (typeof out === "string") throw new Error(out);
    return out;
  };

  it("lists the plates, each with its objects, height and picture, and reads the first by default", () => {
    const got = read(project(3, ["", "Tall", ""]));
    expect(got.plate).toBe(1);
    expect(got.plates.map((p) => [p.index, p.name, p.objects, p.picture])).toEqual([
      [1, "", ["Bin 2"], "Metadata/plate_1.png"],
      [2, "Tall", ["Bin 4"], "Metadata/plate_2.png"],
      [3, "", ["Bin 6"], "Metadata/plate_3.png"],
    ]);
    expect(got.plates.map((p) => p.height)).toEqual([20, 40, 60]);
    expect(got.objects.map((o) => o.name)).toEqual(["Bin 2"]);
  });

  it("moves a chosen plate's objects from its grid spot onto the bed, where they sit on that plate", () => {
    for (const [plate, name] of [
      [2, "Bin 4"],
      [3, "Bin 6"],
    ] as const) {
      const got = read(project(3), plate);
      expect(got.plate).toBe(plate);
      expect(got.objects.map((o) => o.name)).toEqual([name]);
      // The prism's corner (0, 0) lands where plate 1's would: the file's centre at 128, 128 less 5 of the mesh's 10.
      expect(
        boundsOf(got.objects[0]?.positions ?? new Float32Array())
          .min.slice(0, 2)
          .map((v) => Math.round(v)),
      ).toEqual([128, 128]);
    }
  });

  it("reads the first plate for a plate the file doesn't have, and plates in a grid of four or five", () => {
    expect(read(project(3), 9).plate).toBe(1);
    for (const count of [4, 5, 7]) {
      const got = read(project(count), count);
      expect(
        boundsOf(got.objects[0]?.positions ?? new Float32Array())
          .min.slice(0, 2)
          .map((v) => Math.round(v)),
      ).toEqual([128, 128]);
    }
  });

  it("gives a file without plates none", () => {
    const got = read(
      zip({
        "3D/3dmodel.model": model(
          `<resources><object id="1">${MESH}</object></resources><build><item objectid="1"/></build>`,
        ),
      }),
    );
    expect(got.plates).toEqual([]);
    expect(got.plate).toBe(0);
  });
});
