import { describe, expect, it } from "vitest";
import {
  type AttemptSettings,
  byPrintTime,
  carryOver,
  describeChanges,
  slugify,
  tagLabel,
} from "../../src/shared/attempts.ts";

const texts = (before: AttemptSettings, after: AttemptSettings) =>
  describeChanges(before, after).map((change) => change.text);

describe("describeChanges", () => {
  it("is empty when nothing changed, and ignores results", () => {
    const settings: AttemptSettings = { bedTemperature: 60, layerHeight: 0.2, brim: false };
    expect(texts(settings, { ...settings })).toEqual([]);
    expect(texts({ actualMinutes: 10, failedAtLayer: 3 }, { actualMinutes: 50, weightGrams: 12 })).toEqual([]);
    expect(texts({}, {})).toEqual([]);
  });

  it("says what changed in a few words", () => {
    expect(texts({ bedTemperature: 60 }, { bedTemperature: 65 })).toEqual(["bed 60 → 65 °C"]);
    expect(texts({}, { brim: true })).toEqual(["added a brim"]);
    expect(texts({ brim: true }, { brim: false })).toEqual(["no brim"]);
    expect(texts({ brim: false }, {})).toEqual([]);
    expect(texts({ layerHeight: 0.2 }, { layerHeight: 0.16 })).toEqual(["layers 0.20 → 0.16 mm"]);
    expect(texts({}, { infillDensity: 15 })).toEqual(["infill 15%"]);
    expect(texts({ nozzleTemperature: 220 }, {})).toEqual(["no nozzle temperature"]);
    expect(texts({ bedType: "Textured PEI Plate" }, { bedType: "Cool Plate" })).toEqual(["Textured PEI → Cool plate"]);
    expect(texts({ processPreset: "0.20mm Standard @BBL X2D" }, { processPreset: "0.16mm Optimal @BBL X2D" })).toEqual([
      "0.20mm Standard → 0.16mm Optimal",
    ]);
    expect(texts({}, { filamentDried: true })).toEqual(["dried the filament"]);
  });

  it("describes supports", () => {
    expect(texts({}, { supportEnabled: true, supportType: "tree" })).toEqual(["added tree supports"]);
    expect(texts({}, { supportEnabled: true })).toEqual(["added supports"]);
    expect(texts({ supportEnabled: true }, { supportEnabled: true, supportType: "tree" })).toEqual([
      "normal → tree supports",
    ]);
    expect(texts({ supportEnabled: true }, { supportEnabled: false })).toEqual(["no supports"]);
    // A support type without supports on is no change.
    expect(texts({ supportType: "tree" }, {})).toEqual([]);
  });

  it("describes filaments", () => {
    const pla = { type: "PLA", brand: "Bambu", colorName: "Jade white", colorHex: "#ffffff" };
    expect(texts({ filaments: [pla] }, { filaments: [{ ...pla, type: "PETG" }] })).toEqual(["PETG instead of PLA"]);
    expect(texts({ filaments: [pla] }, { filaments: [{ ...pla, colorName: "Black", colorHex: "#000000" }] })).toEqual([
      "Jade white → Black",
    ]);
    expect(texts({}, { filaments: [pla] })).toEqual(["added Jade white Bambu PLA"]);
    expect(texts({ filaments: [pla, pla] }, { filaments: [pla] })).toEqual(["dropped Jade white Bambu PLA"]);
    expect(texts({ filaments: [pla, pla] }, { filaments: [pla, { ...pla, brand: "Polymaker" }] })).toEqual([
      "filament 2: Polymaker instead of Bambu",
    ]);
    // AMS slots aren't a change in how it was printed.
    expect(texts({ filaments: [{ ...pla, amsSlot: "A1" }] }, { filaments: [{ ...pla, amsSlot: "B2" }] })).toEqual([]);
  });
});

describe("carryOver", () => {
  it("keeps the choices and drops the results", () => {
    const before: AttemptSettings = {
      bedTemperature: 60,
      filaments: [{ type: "PLA" }],
      estimatedMinutes: 90,
      actualMinutes: 42,
      weightGrams: 12,
      failedAtPercent: 30,
      failedAtLayer: 12,
    };
    const next = carryOver(before);
    expect(next).toEqual({ bedTemperature: 60, filaments: [{ type: "PLA" }] });
    // A copy: changing the new attempt leaves the old one alone.
    const [copied] = next.filaments ?? [];
    if (copied) copied.type = "PETG";
    expect(before.filaments?.[0]?.type).toBe("PLA");
    expect(before.actualMinutes).toBe(42);
  });

  it("starts empty without a previous attempt", () => {
    expect(carryOver(undefined)).toEqual({});
  });
});

describe("slugify", () => {
  it("makes stable slugs from labels", () => {
    expect(slugify("Nozzle hit the part!")).toBe("nozzle-hit-the-part");
    expect(slugify("  Elephant's foot ")).toBe("elephants-foot");
    expect(slugify("Crème brûlée")).toBe("creme-brulee");
    expect(slugify("PLA / PETG")).toBe("pla-petg");
    expect(slugify("!!!")).toBe("");
    expect(slugify("")).toBe("");
  });

  it("is at most 48 characters and never ends in a dash", () => {
    const slug = slugify(`${"a".repeat(47)} b`);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug).toBe("a".repeat(47));
    expect(slugify("x".repeat(60))).toHaveLength(48);
  });
});

describe("tagLabel", () => {
  it("finds built-in labels, then people's own, then makes the slug readable", () => {
    expect(tagLabel("failure", "elephants-foot")).toBe("Elephant's foot");
    expect(tagLabel("success", "colors-crisp")).toBe("Crisp colors");
    expect(tagLabel("failure", "colors-crisp")).toBe("Colors crisp");
    expect(tagLabel("failure", "nozzle-hit", [{ slug: "nozzle-hit", label: "Nozzle hit the part!" }])).toBe(
      "Nozzle hit the part!",
    );
    expect(tagLabel("failure", "mystery-blob")).toBe("Mystery blob");
  });
});

describe("byPrintTime", () => {
  it("orders by print time, then creation, then id, without changing the list", () => {
    const list = [
      { id: "c", printedAt: 2, createdAt: 1 },
      { id: "b", printedAt: 1, createdAt: 2 },
      { id: "a", printedAt: 1, createdAt: 2 },
      { id: "d", printedAt: 1, createdAt: 1 },
    ];
    expect(byPrintTime(list).map((attempt) => attempt.id)).toEqual(["d", "a", "b", "c"]);
    expect(list[0]?.id).toBe("c");
  });
});
