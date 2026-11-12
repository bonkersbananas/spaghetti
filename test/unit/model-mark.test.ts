import { describe, expect, it } from "vitest";
import { modelLetter, modelMarkIn, modelMarkOf, modelOf, modelPlace } from "../../src/shared/model-mark.ts";

const site = (url: string) => modelMarkOf(url)?.site ?? null;

describe("model marks", () => {
  it("knows MakerWorld model pages, with or without a language", () => {
    expect(site("https://makerworld.com/en/models/123-cable-comb")).toBe("makerworld");
    expect(site("https://makerworld.com/models/123")).toBe("makerworld");
    expect(site("https://makerworld.com/en")).toBeNull();
    expect(site("https://makerworld.com/en/search/models?keyword=hook")).toBeNull();
    expect(site("https://makerworld.com/en/@someone")).toBeNull();
  });
  it("knows Printables models", () => {
    expect(site("https://www.printables.com/model/45-hook")).toBe("printables");
    expect(site("https://www.printables.com/en/model/45-hook")).toBe("printables");
    expect(site("https://www.printables.com/")).toBeNull();
    expect(site("https://www.printables.com/search/models?q=hook")).toBeNull();
  });
  it("knows Thingiverse things", () => {
    expect(site("https://www.thingiverse.com/thing:6789")).toBe("thingiverse");
    expect(site("https://www.thingiverse.com/search?q=x")).toBeNull();
  });
  it("knows Thangs, Cults, MyMiniFactory and Creality Cloud", () => {
    expect(site("https://thangs.com/designer/Ann/3d-model/Hook-123")).toBe("thangs");
    expect(site("https://thangs.com/")).toBeNull();
    expect(site("https://cults3d.com/en/3d-model/home/hook")).toBe("cults3d");
    expect(site("https://cults3d.com/en/users/ann")).toBeNull();
    expect(site("https://www.myminifactory.com/object/3d-print-hook-123")).toBe("myminifactory");
    expect(site("https://www.myminifactory.com/search/?query=x")).toBeNull();
    expect(site("https://www.crealitycloud.com/model-detail/abc123")).toBe("crealitycloud");
    expect(site("https://www.crealitycloud.com/")).toBeNull();
  });
  it("knows direct model files", () => {
    for (const ext of ["3mf", "stl", "step", "stp", "obj", "STL"]) {
      const mark = modelMarkOf(`https://example.com/files/hook.${ext}?dl=1`);
      expect(mark?.kind).toBe("file");
      expect(mark?.name).toBe(`.${ext.toLowerCase()}`);
    }
    expect(modelMarkOf("https://example.com/hook.pdf")).toBeNull();
    expect(modelMarkOf("https://example.com/hook")).toBeNull();
  });
  it("ignores lookalike hosts and unsafe addresses", () => {
    expect(site("https://makerworld.com.evil.example/en/models/1")).toBeNull();
    expect(site("http://makerworld.com/en/models/1")).toBeNull();
    expect(modelMarkOf("https://127.0.0.1/hook.stl")).toBeNull();
  });
  it("finds the first model link in a note", () => {
    const note = "see https://example.com and https://www.printables.com/model/9-x), then https://x.org/a.stl";
    expect(modelMarkIn(note)?.site).toBe("printables");
    expect(modelMarkIn("only https://x.org/a.3mf")?.kind).toBe("file");
    expect(modelMarkIn("https://example.com/page")).toBeNull();
    expect(modelMarkIn("")).toBeNull();
  });
  it("counts a kept slicer file as a model, after any link", () => {
    const files = [{ id: "f1", name: "bin.gcode.3mf" }];
    const mark = modelOf({ note: "just words", files });
    expect(mark).toMatchObject({ kind: "file", name: ".3mf", url: "/api/files/f1" });
    expect(mark && modelLetter(mark)).toBe("3MF");
    expect(mark && modelPlace(mark)).toBe("3MF file");
    expect(modelOf({ note: "https://www.printables.com/model/9-x", files })?.site).toBe("printables");
    expect(modelOf({ note: "just words", files: [] })).toBeNull();
  });
});
