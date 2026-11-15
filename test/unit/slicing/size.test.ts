import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { layMeshDown } from "../../../src/shared/mesh.ts";
import { boundsOf } from "../../../src/shared/slicing/arrange.ts";
import { packGcode3mf } from "../../../src/shared/slicing/gcode3mf.ts";
import { readSize, sizeFromModelXml, sizeOfBoxes, sizeSpoken, sizeWords } from "../../../src/shared/slicing/size.ts";
import { box } from "./meshes.ts";

/** A `.gcode.3mf` of these objects (one box each) as the app packs it, and its model. */
function modelOf(objects: { name: string; min: [number, number, number]; max: [number, number, number] }[]) {
  const sliced = packGcode3mf({
    gcode: new TextEncoder().encode("; total layer number: 1\nG28\n"),
    seconds: 60,
    grams: 1,
    layers: 1,
    objects: objects.map((o, index) => ({
      name: o.name,
      id: index + 1,
      box: boundsOf(box(o.min, o.max)),
      mesh: { positions: box(o.min, o.max) },
    })),
    settings: { printer_model: "Bambu Lab X2D", nozzle_diameter: ["0.4"], layer_height: "0.2" },
    filaments: [{ type: "PLA", colour: "#ffffff" }],
    slicer: { name: "OrcaSlicer", version: "2.5.1" },
    title: "box",
  });
  return strFromU8(unzipSync(sliced)["3D/3dmodel.model"] as Uint8Array);
}

describe("sizeFromModelXml", () => {
  it("measures a known box as it stands on the plate", () => {
    const xml = modelOf([{ name: "tag", min: [100, 110, 0], max: [129.96, 121.5, 11.35] }]);
    expect(sizeFromModelXml(xml)).toEqual([29.96, 11.5, 11.35]);
  });

  it("is of one copy when the file has several, copies being appended after the originals", () => {
    const one = {
      name: "tag",
      min: [10, 10, 0] as [number, number, number],
      max: [40, 22, 8] as [number, number, number],
    };
    const xml = modelOf([
      one,
      { name: "tag (2)", min: [60, 10, 0], max: [90, 22, 8] },
      { name: "tag (3)", min: [110, 10, 0], max: [140, 22, 8] },
    ]);
    expect(sizeFromModelXml(xml, 3)).toEqual([30, 12, 8]);
    // Without the count, everything on the plate.
    expect(sizeFromModelXml(xml)).toEqual([130, 12, 8]);
  });

  it("is of everything on the plate except the copies when there are several objects", () => {
    const xml = modelOf([
      { name: "bin", min: [10, 10, 0], max: [50, 40, 20] },
      { name: "lid", min: [60, 10, 0], max: [90, 40, 5] },
      { name: "bin (2)", min: [100, 10, 0], max: [140, 40, 20] },
      { name: "lid (2)", min: [150, 10, 0], max: [180, 40, 5] },
    ]);
    expect(sizeFromModelXml(xml, 2)).toEqual([80, 30, 20]);
  });

  it("follows a build item's transform: a model turned 90° about Z swaps width and depth", () => {
    const xml = `<model><resources><object id="1"><mesh><vertices>
      <vertex x="0" y="0" z="0"/><vertex x="30" y="0" z="0"/><vertex x="30" y="10" z="5"/><vertex x="0" y="10" z="5"/>
    </vertices></mesh></object></resources>
    <build><item objectid="1" transform="0 1 0 -1 0 0 0 0 1 50 60 0"/></build></model>`;
    expect(sizeFromModelXml(xml)).toEqual([10, 30, 5]);
  });

  it("composes a wrapper's components with the item", () => {
    const xml = `<model><resources>
      <object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="4" z="2"/></vertices></mesh></object>
      <object id="2"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 20 0 0"/><component objectid="1"/></components></object>
    </resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 5 5 0"/></build></model>`;
    expect(sizeFromModelXml(xml)).toEqual([30, 4, 2]);
  });

  it("is null without a mesh", () => {
    expect(sizeFromModelXml("<model><resources/><build/></model>")).toBeNull();
  });

  // The brim, skirt, prime tower, supports and purge are toolpaths in plate_1.gcode: the size never reads them.
  it("does not read the G-code's brim or prime tower", () => {
    const xml = modelOf([{ name: "tag", min: [100, 100, 0], max: [120, 110, 10] }]);
    expect(xml).not.toContain("G1");
    expect(sizeFromModelXml(xml)).toEqual([20, 10, 10]);
  });
});

describe("sizeOfBoxes", () => {
  it("reports the printed orientation of a block laid on another face", () => {
    // 30 wide, 12 deep, 8 tall, laid on its +X face: it stands 30 tall.
    const turned = layMeshDown({ positions: box([0, 0, 0], [30, 12, 8]) }, [1, 0, 0]);
    const size = sizeOfBoxes([boundsOf(turned.positions)]);
    expect(size?.[2]).toBe(30);
    expect([size?.[0], size?.[1]].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([8, 12]);
  });
});

describe("saying a size", () => {
  it("shows up to two decimals with trailing zeros trimmed", () => {
    expect(sizeWords([29.96, 11.5, 11.35])).toBe("29.96 × 11.5 × 11.35 mm");
    expect(sizeWords([20, 20.004, 19.999])).toBe("20 × 20 × 20 mm");
    expect(sizeSpoken([29.96, 11.5, 11.35])).toBe("Width 29.96 mm, depth 11.5 mm, height 11.35 mm");
  });

  it("reads only three good numbers", () => {
    expect(readSize([1, 2, 3])).toEqual([1, 2, 3]);
    expect(readSize([1, 2])).toBeUndefined();
    expect(readSize([1, Number.NaN, 3])).toBeUndefined();
    expect(readSize(undefined)).toBeUndefined();
  });
});
