import { describe, expect, it } from "vitest";
import {
  firstModelLink,
  isModelImageUrl,
  lonelyModelLink,
  modelSite,
  pictureRequestUrl,
} from "../../src/shared/model-links.ts";

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

  it("asks the image hosts for a WebP of a picture, never the original PNG or 9 MB JPEG", () => {
    expect(pictureRequestUrl("https://makerworld.bblmw.com/makerworld/model/A/design/b.png")).toBe(
      "https://makerworld.bblmw.com/makerworld/model/A/design/b.png?x-oss-process=image/resize,w_1600/format,webp",
    );
    // Printables: an original (what its API names), and one of its own PNG thumbnails (what a page names).
    const folder = "https://media.printables.com/media/prints/3161/images/20206_70fde6a0";
    expect(pictureRequestUrl(`${folder}/benchy.jpg`)).toBe(`${folder}/thumbs/inside/1600x1200/jpg/benchy.webp`);
    expect(pictureRequestUrl(`${folder}/thumbs/cover/800x800/png/party-glasses.png`)).toBe(
      `${folder}/thumbs/inside/1600x1200/png/party-glasses.webp`,
    );
    // The scout's smaller pictures, and a width beyond the host's biggest box.
    expect(pictureRequestUrl(`${folder}/benchy.JPG`, 900)).toBe(`${folder}/thumbs/inside/1280x960/jpg/benchy.webp`);
    expect(pictureRequestUrl(`${folder}/benchy.jpg`, 4000)).toBe(`${folder}/thumbs/inside/1920x1440/jpg/benchy.webp`);
    // Anything it doesn't know the shape of is asked for as it is.
    expect(pictureRequestUrl("https://media.printables.com/media/users/avatar.png")).toBe(
      "https://media.printables.com/media/users/avatar.png",
    );
    expect(pictureRequestUrl("https://cdn.thingiverse.com/assets/a.jpg")).toBe(
      "https://cdn.thingiverse.com/assets/a.jpg",
    );
  });
});
