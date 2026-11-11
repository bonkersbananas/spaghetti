import { describe, expect, it } from "vitest";
import {
  allPartsPrinted,
  attemptPartsLabel,
  countsForOutcome,
  goodPieces,
  type Part,
  partProgress,
  partsFromFiles,
  partsFromObjects,
  partsOnPlate,
  partsSummary,
  progressLabel,
  tidyObjectName,
} from "../../src/shared/parts.ts";

const part = (id: string, name: string, quantity: number, position = 0): Part => ({
  id,
  itemId: "item",
  name,
  quantity,
  position,
  photoId: null,
  createdAt: 1,
  updatedAt: 1,
});

describe("tidyObjectName", () => {
  it("makes object names readable", () => {
    expect(tidyObjectName("hull_left")).toBe("Hull left");
    expect(tidyObjectName("Deck.stl")).toBe("Deck");
    expect(tidyObjectName("  drawer   bin  ")).toBe("Drawer bin");
  });
  it("drops copy numbers", () => {
    expect(tidyObjectName("drawer_bin_2")).toBe("Drawer bin");
    expect(tidyObjectName("Drawer bin (3)")).toBe("Drawer bin");
    expect(tidyObjectName("clip.4")).toBe("Clip");
    expect(tidyObjectName("clip copy 2")).toBe("Clip");
  });
  it("keeps numbers that belong to the name", () => {
    expect(tidyObjectName("M3 screw")).toBe("M3 screw");
  });
  it("never comes back empty", () => {
    expect(tidyObjectName("")).toBe("Part");
    expect(tidyObjectName("___")).toBe("Part");
  });
});

describe("partsFromObjects", () => {
  it("groups identical objects into one part with a quantity", () => {
    expect(partsFromObjects(["hull_left", "hull_right", "deck", "hull_left_1", "Hull Left"])).toEqual([
      { name: "Hull left", quantity: 3 },
      { name: "Hull right", quantity: 1 },
      { name: "Deck", quantity: 1 },
    ]);
  });
  it("is empty without objects", () => {
    expect(partsFromObjects([])).toEqual([]);
  });
});

describe("partsFromFiles", () => {
  it("counts a plate once however many attempts printed it", () => {
    const files = [
      { name: "tug.gcode.3mf", plate: 1, objects: ["hull_left", "hull_right"] },
      { name: "tug.gcode.3mf", plate: 1, objects: ["hull_left", "hull_right"] },
      { name: "tug.gcode.3mf", plate: 2, objects: ["deck"] },
    ];
    expect(partsFromFiles(files)).toEqual([
      { name: "Hull left", quantity: 1 },
      { name: "Hull right", quantity: 1 },
      { name: "Deck", quantity: 1 },
    ]);
  });
});

describe("partsOnPlate", () => {
  it("finds the parts a plate's objects are, with how many", () => {
    const parts = [part("a", "Hull half", 2), part("b", "Deck", 1), part("c", "Mast", 1)];
    expect(partsOnPlate(["hull_half", "hull_half_2", "Deck"], parts)).toEqual([
      { partId: "a", count: 2 },
      { partId: "b", count: 1 },
    ]);
    expect(partsOnPlate(["something else"], parts)).toEqual([]);
  });
});

describe("progress", () => {
  const parts = [part("hull", "Hull half", 2, 0), part("deck", "Deck", 1, 1)];
  it("counts worked and partly worked pieces, not a print still printing", () => {
    const attempts = [
      { outcome: "success" as const, parts: [{ partId: "hull", count: 1 }] },
      { outcome: "partial" as const, parts: [{ partId: "deck", count: 1 }] },
      { outcome: null, parts: [{ partId: "hull", count: 1 }] },
    ];
    const progress = partProgress(parts, attempts);
    expect(progress.map((p) => [p.part.name, p.made, p.printing, p.done])).toEqual([
      ["Hull half", 1, 1, false],
      ["Deck", 1, 0, true],
    ]);
    expect(partsSummary(progress)).toBe("Hull half: 1 of 2 · Deck: done");
    expect(allPartsPrinted(progress)).toBe(false);
  });
  it("counts a spaghetti's pieces only when a number was set", () => {
    expect(goodPieces({ outcome: "failed", parts: [{ partId: "hull", count: 0 }] }, "hull")).toBe(0);
    expect(goodPieces({ outcome: "failed", parts: [{ partId: "hull", count: 1 }] }, "hull")).toBe(1);
  });
  it("is all printed when every part reached its quantity", () => {
    const progress = partProgress(parts, [
      {
        outcome: "success",
        parts: [
          { partId: "hull", count: 2 },
          { partId: "deck", count: 1 },
        ],
      },
    ]);
    expect(allPartsPrinted(progress)).toBe(true);
    expect(progressLabel(progress[0] as (typeof progress)[number])).toBe("done");
  });
  it("is never all printed without parts", () => {
    expect(allPartsPrinted([])).toBe(false);
  });
});

describe("countsForOutcome", () => {
  const onPlate = [{ partId: "hull", count: 2 }];
  it("zeroes a spaghetti and brings the plate back for a print that worked", () => {
    const failed = countsForOutcome(onPlate, "failed");
    expect(failed).toEqual([{ partId: "hull", count: 0 }]);
    expect(countsForOutcome(failed, "success", onPlate)).toEqual(onPlate);
    expect(countsForOutcome(onPlate, "partial")).toEqual(onPlate);
  });
  it("never drops the picked parts: a saved spaghetti switched to worked gets one piece of each", () => {
    const zeroed = [
      { partId: "hull", count: 0 },
      { partId: "deck", count: 0 },
    ];
    expect(countsForOutcome(zeroed, "success")).toEqual([
      { partId: "hull", count: 1 },
      { partId: "deck", count: 1 },
    ]);
    expect(countsForOutcome(zeroed, "success", [])).toHaveLength(2);
    expect(countsForOutcome([], "success", [])).toEqual([]);
  });
});

describe("attemptPartsLabel", () => {
  const parts = [part("hull", "Hull half", 2, 0), part("deck", "Deck", 1, 1)];
  it("names what an attempt printed", () => {
    expect(
      attemptPartsLabel(
        {
          parts: [
            { partId: "deck", count: 1 },
            { partId: "hull", count: 2 },
          ],
        },
        parts,
      ),
    ).toBe("Hull half ×2, Deck");
    expect(attemptPartsLabel({ parts: [{ partId: "gone", count: 1 }] }, parts)).toBeNull();
    expect(attemptPartsLabel({ parts: [] }, parts)).toBeNull();
  });
});
