import { describe, expect, it } from "vitest";
import {
  cleanModelUrl,
  linkKey,
  modelLetter,
  modelMarkIn,
  modelMarkOf,
  modelOf,
  modelPlace,
  sameModel,
  tidyModelLinks,
  withoutModelLines,
} from "../../src/shared/model-mark.ts";

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
    expect(mark).toMatchObject({
      kind: "file",
      name: ".3mf",
      url: "/api/files/f1",
    });
    expect(mark && modelLetter(mark)).toBe("3MF");
    expect(mark && modelPlace(mark)).toBe("3MF file");
    expect(modelOf({ note: "https://www.printables.com/model/9-x", files })?.site).toBe("printables");
    expect(modelOf({ note: "just words", files: [] })).toBeNull();
  });
});

const FLEXI = "https://makerworld.com/en/models/3531476-flexi-mini-hummingbird?from=search#profileId-4037895";

describe("the same model, however its link is written", () => {
  it("matches a MakerWorld design with or without a query, fragment, language or slug", () => {
    const clean = "https://makerworld.com/en/models/3531476-flexi-mini-hummingbird";
    expect(sameModel(FLEXI, clean)).toBe(true);
    expect(sameModel(FLEXI, "https://makerworld.com/models/3531476")).toBe(true);
    expect(sameModel(FLEXI, "https://makerworld.com/de/models/3531476-flexi-mini-kolibri")).toBe(true);
    expect(sameModel(FLEXI, "https://makerworld.com/zh-cn/models/3531476?from=recommend")).toBe(true);
    expect(sameModel(FLEXI, "https://www.makerworld.com/en/models/3531476-flexi-mini-hummingbird")).toBe(true);
    expect(sameModel(FLEXI, "https://makerworld.com/en/models/3531477-flexi-mini-hummingbird")).toBe(false);
  });
  it("matches a Thingiverse thing on www. or not, its files tab, a query", () => {
    expect(sameModel("https://www.thingiverse.com/thing:123", "https://thingiverse.com/thing:123/files")).toBe(true);
    expect(sameModel("https://www.thingiverse.com/thing:123", "https://www.thingiverse.com/thing:123?ref=x")).toBe(
      true,
    );
    expect(sameModel("https://www.thingiverse.com/thing:123", "https://www.thingiverse.com/thing:1234")).toBe(false);
  });
  it("matches Printables by its number, and never models on two sites", () => {
    expect(sameModel("https://www.printables.com/model/45-hook", "https://printables.com/en/model/45")).toBe(true);
    expect(sameModel("https://www.printables.com/model/45-hook", "https://makerworld.com/en/models/45")).toBe(false);
  });
  it("matches files by their whole address, and nothing that isn't a model", () => {
    expect(sameModel("https://x.org/a.stl?dl=1", "https://x.org/a.stl?dl=1#top")).toBe(true);
    expect(sameModel("https://x.org/a.stl?dl=1", "https://x.org/a.stl?dl=2")).toBe(false);
    expect(sameModel("https://example.com/page", "https://example.com/page")).toBe(false);
    expect(sameModel("https://makerworld.com/en", "https://makerworld.com/en")).toBe(false);
    expect(linkKey("https://example.com/page")).toBe("https://example.com/page");
    expect(linkKey(FLEXI)).toBe(linkKey("https://makerworld.com/models/3531476"));
  });
});

describe("model links without their tracking bits", () => {
  it("keeps a model page's path and drops its query and fragment", () => {
    expect(cleanModelUrl(FLEXI)).toBe("https://makerworld.com/en/models/3531476-flexi-mini-hummingbird");
    expect(modelMarkOf(FLEXI)?.url).toBe("https://makerworld.com/en/models/3531476-flexi-mini-hummingbird");
    expect(cleanModelUrl("https://www.thingiverse.com/thing:123?utm_source=x")).toBe(
      "https://www.thingiverse.com/thing:123",
    );
  });
  it("leaves other links, and files' queries, as they are", () => {
    expect(cleanModelUrl("https://www.youtube.com/watch?v=abc")).toBe("https://www.youtube.com/watch?v=abc");
    expect(cleanModelUrl("https://makerworld.com/en/search/models?keyword=hook")).toBe(
      "https://makerworld.com/en/search/models?keyword=hook",
    );
    expect(cleanModelUrl("https://x.org/a.stl?token=1")).toBe("https://x.org/a.stl?token=1");
  });
  it("tidies every model link in a note and nothing else", () => {
    const note = `Green one: ${FLEXI}, and the stand https://www.thingiverse.com/thing:9?ref=x.\nVideo https://youtu.be/x?t=3`;
    expect(tidyModelLinks(note)).toBe(
      "Green one: https://makerworld.com/en/models/3531476-flexi-mini-hummingbird, and the stand https://www.thingiverse.com/thing:9.\nVideo https://youtu.be/x?t=3",
    );
    expect(tidyModelLinks("no links")).toBe("no links");
    expect(tidyModelLinks(FLEXI)).toBe("https://makerworld.com/en/models/3531476-flexi-mini-hummingbird");
  });
});

describe("mirror links", () => {
  const mirror = "https://3dgo.app/models/makerworld/2487194";
  it("are the source model's link, and stay as pasted", () => {
    const mark = modelMarkOf(mirror);
    expect(mark).toMatchObject({
      kind: "page",
      site: "makerworld",
      url: "https://makerworld.com/models/2487194",
      via: mirror,
    });
    expect(cleanModelUrl(mirror)).toBe(mirror);
    expect(tidyModelLinks(`see ${mirror}`)).toBe(`see ${mirror}`);
    expect(modelMarkIn(`see ${mirror}`)?.name).toBe("MakerWorld");
  });
  it("are the same model as the source's own address", () => {
    expect(sameModel(mirror, "https://makerworld.com/en/models/2487194-infinity-heart")).toBe(true);
    expect(linkKey(mirror)).toBe(linkKey("https://makerworld.com/models/2487194"));
    expect(sameModel(mirror, "https://makerworld.com/models/1")).toBe(false);
  });
});

describe("withoutModelLines", () => {
  const model = "https://www.printables.com/model/512340-bath-tugboat";

  it("leaves out a line that is only the model's link", () => {
    expect(withoutModelLines(`Chunky enough.\n\n${model}`, model)).toBe("Chunky enough.");
  });

  it("keeps a link inside a sentence", () => {
    const note = `Print it from ${model} in halves`;
    expect(withoutModelLines(note, model)).toBe(note);
  });

  it("returns a note with nothing to leave out exactly as typed", () => {
    expect(withoutModelLines("  A\n\n\n\nB  \n", model)).toBe("  A\n\n\n\nB  \n");
  });

  it("keeps the model's link when it would get no card (past the first three links)", () => {
    const note = ["https://a.example/1", "https://b.example/2", "https://c.example/3", model].join("\n");
    expect(withoutModelLines(note, model)).toBe(note);
    expect(withoutModelLines(["https://a.example/1", "https://b.example/2", model].join("\n"), model)).toBe(
      "https://a.example/1\nhttps://b.example/2",
    );
  });
});
