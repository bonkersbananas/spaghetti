import { describe, expect, it } from "vitest";
import { tugboatFile } from "../../e2e/fixtures/gcode-tugboat.ts";
import { hotdogModel } from "../../e2e/fixtures/model-3mf.ts";
import { boxStl } from "../../e2e/fixtures/model-stl.ts";
import { isIos, looksLikeModel, modelAccept } from "../../src/client/lib/model-pick.ts";

// iOS greys out files whose type it can't map from `accept` (3MF has none), so there the inputs take everything.

const iphone = {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  platform: "iPhone",
  maxTouchPoints: 5,
};
const ipadAsMac = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  platform: "MacIntel",
  maxTouchPoints: 5,
};
const mac = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 };
const windows = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32", maxTouchPoints: 0 };
const android = { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)", platform: "Linux armv81", maxTouchPoints: 5 };

describe("modelAccept", () => {
  it("has no filter on iPhone and on an iPad that says it is a Mac", () => {
    expect(modelAccept(undefined, iphone)).toBeUndefined();
    expect(modelAccept("stl", iphone)).toBeUndefined();
    expect(modelAccept(undefined, ipadAsMac)).toBeUndefined();
    expect(isIos(ipadAsMac)).toBe(true);
  });
  it("keeps the filter on a Mac, Windows and Android", () => {
    for (const nav of [mac, windows, android]) expect(modelAccept(undefined, nav)).toContain(".3mf");
    expect(modelAccept("stl", mac)).toBe(".stl,model/stl");
  });
});

const file = (bytes: BlobPart, name: string) => new File([bytes], name);
const bytes = (data: Uint8Array) => data as unknown as BlobPart;

describe("looksLikeModel", () => {
  it("takes a binary STL, an ASCII STL, a 3MF and a .gcode.3mf", async () => {
    expect(await looksLikeModel(file(bytes(boxStl(10)), "box.stl"))).toBe(true);
    expect(await looksLikeModel(file("solid cube\nendsolid cube\n", "cube.STL"))).toBe(true);
    expect(await looksLikeModel(file(bytes(hotdogModel()), "dog.3mf"))).toBe(true);
    expect(await looksLikeModel(file(bytes(tugboatFile()), "tugboat.gcode.3mf"))).toBe(true);
  });
  it("turns away a JPEG, an empty file, a .3mf that isn't a zip and a truncated STL", async () => {
    expect(await looksLikeModel(file(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]), "photo.jpg"))).toBe(false);
    expect(await looksLikeModel(file(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]), "photo.stl"))).toBe(false);
    expect(await looksLikeModel(file("", "empty.stl"))).toBe(false);
    expect(await looksLikeModel(file("", "empty.3mf"))).toBe(false);
    expect(await looksLikeModel(file("not a zip at all", "fake.3mf"))).toBe(false);
    expect(await looksLikeModel(file(bytes(boxStl(10).slice(0, 100)), "cut.stl"))).toBe(false);
  });
  it("takes only STL where only STL is asked", async () => {
    expect(await looksLikeModel(file(bytes(hotdogModel()), "dog.3mf"), "stl")).toBe(false);
    expect(await looksLikeModel(file(bytes(boxStl(10)), "box.stl"), "stl")).toBe(true);
  });
});
