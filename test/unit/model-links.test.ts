import { describe, expect, it } from "vitest";
import { firstModelLink, isModelImageUrl, lonelyModelLink, modelSite } from "../../src/shared/model-links.ts";

describe("model links", () => {
  it("knows the three sites, their subdomains, and nothing else", () => {
    expect(modelSite("https://makerworld.com/en/models/1")?.site.id).toBe("makerworld");
    expect(modelSite("https://www.printables.com/model/2-x")?.site.id).toBe("printables");
    expect(modelSite("https://www.thingiverse.com/thing:3")?.site.id).toBe("thingiverse");
    expect(modelSite("https://makerworld.com.evil.example/x")).toBeNull();
    expect(modelSite("https://notmakerworld.com/x")).toBeNull();
    expect(modelSite("http://makerworld.com/x")).toBeNull();
    expect(modelSite("https://127.0.0.1/x")).toBeNull();
  });

  it("only allows the sites' own image hosts", () => {
    expect(isModelImageUrl("https://media.printables.com/media/prints/1.jpg")).toBe(true);
    expect(isModelImageUrl("https://cdn.thingiverse.com/a.jpg")).toBe(true);
    expect(isModelImageUrl("https://printables.com.evil.example/a.jpg")).toBe(false);
    expect(isModelImageUrl("https://makerworld.com/a.jpg")).toBe(false);
    expect(isModelImageUrl("http://media.printables.com/a.jpg")).toBe(false);
  });

  it("tells a bare link from a note with a person's words", () => {
    expect(lonelyModelLink("https://makerworld.com/en/models/1")?.site.name).toBe("MakerWorld");
    expect(lonelyModelLink("Cable comb https://makerworld.com/en/models/1")).not.toBeNull();
    expect(lonelyModelLink(`${"words ".repeat(20)} https://makerworld.com/en/models/1`)).toBeNull();
    expect(lonelyModelLink("https://example.com/x")).toBeNull();
    expect(lonelyModelLink("https://makerworld.com/a https://printables.com/b")).toBeNull();
    expect(firstModelLink("see https://example.com and https://printables.com/model/9)")?.url).toBe(
      "https://printables.com/model/9",
    );
  });
});
