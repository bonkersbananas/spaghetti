import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { HOTDOG_COLOURS, hotdogModel, partsProject, twoColourProject } from "../../../e2e/fixtures/model-3mf.ts";
import { colourHex, readModel3mf } from "../../../src/shared/slicing/model3mf.ts";

const read = (bytes: Uint8Array) => {
  const model = readModel3mf(bytes);
  if (typeof model === "string") throw new Error(model);
  return model;
};

describe("colourHex", () => {
  it("reads #rrggbb and #rrggbbaa, in any case, and nothing else", () => {
    expect(colourHex("#D2281EFF")).toBe("#d2281e");
    expect(colourHex("#d2281e")).toBe("#d2281e");
    expect(colourHex("D2281E")).toBe("#d2281e");
    expect(colourHex("#fff")).toBeUndefined();
    expect(colourHex("red")).toBeUndefined();
    expect(colourHex(undefined)).toBeUndefined();
  });
});

describe("a plain 3MF's colours", () => {
  it("gives each object the named colour its basematerials say", () => {
    const model = read(hotdogModel());
    expect(model.project).toBe(false);
    expect(model.objects).toHaveLength(13);
    expect(model.objects.every((object) => object.colours?.length === 1)).toBe(true);
    const first = model.objects[0];
    expect(first?.colours).toEqual([{ from: 0, to: 12, colour: { hex: "#d2281e", name: "Ketchup Red" } }]);
    const names = new Set(model.objects.map((object) => object.colours?.[0]?.colour.name));
    expect(names.size).toBe(HOTDOG_COLOURS.length);
  });

  it("follows a component to its parent's colour, and lets a child's own colour win", () => {
    const mesh = `<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="5" y="0" z="0"/><vertex x="0" y="5" z="0"/><vertex x="0" y="0" z="5"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/></triangles></mesh>`;
    const model = read(
      zipSync({
        "3D/3dmodel.model": strToU8(`<model unit="millimeter" xmlns="x"><resources>
<m:basematerials id="7" xmlns:m="y"><m:base name="A &amp; B" displaycolor="#FF0000"/><m:base name="Blue" displaycolor="#0000FF80"/></m:basematerials>
<object id="1" type="model">${mesh}</object>
<object id="2" type="model" pid="7" pindex="1">${mesh}</object>
<object id="3" type="model" pid="7" pindex="0"><components><component objectid="1"/><component objectid="2"/></components></object>
</resources><build><item objectid="3"/></build></model>`),
      }),
    );
    expect(model.objects[0]?.colours).toEqual([
      { from: 0, to: 2, colour: { hex: "#ff0000", name: "A & B" } },
      { from: 2, to: 4, colour: { hex: "#0000ff", name: "Blue" } },
    ]);
  });

  it("leaves colours out when the file gives none, or points at a base that isn't there", () => {
    const model = read(
      zipSync({
        "3D/3dmodel.model": strToU8(`<model xmlns="x"><resources>
<basematerials id="1"><base name="Bad" displaycolor="nope"/></basematerials>
<object id="1" type="model" pid="1" pindex="0"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
<object id="2" type="model" pid="9" pindex="3"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
</resources><build><item objectid="1"/><item objectid="2"/></build></model>`),
      }),
    );
    expect(model.objects.map((object) => object.colours)).toEqual([undefined, undefined]);
  });
});

describe("a project's colours", () => {
  it("takes an object's colour from the filament it prints in", () => {
    const model = read(twoColourProject());
    expect(model.objects.map((object) => object.colours?.map((run) => run.colour.hex))).toEqual([
      ["#f2eee4"],
      ["#c2412d"],
    ]);
  });

  it("gives each part of an object its own filament's colour", () => {
    const [object] = read(partsProject()).objects;
    expect(object?.colours?.length).toBe(2);
    expect(object?.colours?.[0]?.colour.hex).not.toBe(object?.colours?.[1]?.colour.hex);
    expect(object?.colours?.[0]?.to).toBe(object?.colours?.[1]?.from);
  });
});
