import { describe, expect, it } from "vitest";
import {
  type AttemptSettings,
  byPrintTime,
  carryOver,
  describeChanges,
  diffSettings,
  outcomeWords,
  plateName,
  slugify,
  summarizeBuild,
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
    expect(texts({ bedType: "Textured PEI Plate" }, { bedType: "Cool Plate" })).toEqual(["Textured PEI → Cool Plate"]);
    expect(texts({}, { bedType: "Smooth PEI Plate" })).toEqual(["Smooth PEI plate"]);
    expect(texts({}, { bedType: "Engineering Plate" })).toEqual(["Engineering Plate"]);
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

describe("plateName", () => {
  it("drops 'Plate' only where the name says enough without it", () => {
    expect(plateName("Textured PEI Plate")).toBe("Textured PEI");
    expect(plateName("Smooth PEI Plate")).toBe("Smooth PEI");
    expect(plateName("Cool Plate")).toBe("Cool Plate");
    expect(plateName("Engineering Plate")).toBe("Engineering Plate");
    expect(plateName("High Temp Plate")).toBe("High Temp Plate");
    expect(plateName("Supertack Plate")).toBe("Supertack Plate");
    expect(plateName("Garolite")).toBe("Garolite");
  });
});

describe("diffSettings", () => {
  const row = (before: AttemptSettings, after: AttemptSettings, key: string) => {
    const found = diffSettings(before, after).find((r) => r.key === key);
    if (!found) throw new Error(`no row ${key}`);
    return found;
  };

  it("has a row for every known setting, changed or not", () => {
    const keys = diffSettings({}, {}).map((r) => r.key);
    expect(keys).toEqual([
      "bedType",
      "nozzle",
      "nozzleDiameter",
      "layerHeight",
      "infillDensity",
      "wallLoops",
      "supports",
      "brim",
      "processPreset",
      "nozzleTemperature",
      "bedTemperature",
      "chamberTemperature",
      "filamentDried",
    ]);
    expect(diffSettings({}, {}).every((r) => r.unset && !r.changed)).toBe(true);
  });

  it("gives before and after as words, for the table in the compare sheet", () => {
    expect(row({ bedTemperature: 60 }, { bedTemperature: 65 }, "bedTemperature")).toMatchObject({
      label: "Bed",
      before: "60 °C",
      after: "65 °C",
      changed: true,
      unset: false,
    });
    expect(row({}, { chamberTemperature: 35 }, "chamberTemperature")).toMatchObject({ before: "none", after: "35 °C" });
    expect(row({}, { filamentDried: true }, "filamentDried")).toMatchObject({ before: "not dried", after: "dried" });
    expect(row({ bedType: "Smooth PEI Plate" }, { bedType: "Textured PEI Plate" }, "bedType")).toMatchObject({
      before: "Smooth PEI",
      after: "Textured PEI",
    });
    expect(row({ supportEnabled: true }, { supportEnabled: true, supportType: "tree" }, "supports")).toMatchObject({
      before: "normal",
      after: "tree",
      changed: true,
    });
  });

  it("marks what is the same, with its value, and what neither attempt says", () => {
    const same = row({ layerHeight: 0.2 }, { layerHeight: 0.2 }, "layerHeight");
    expect(same).toMatchObject({ before: "0.20 mm", after: "0.20 mm", changed: false, unset: false, changes: [] });
    expect(row({}, {}, "brim")).toMatchObject({ changed: false, unset: true });
    expect(row({ brim: false }, {}, "brim")).toMatchObject({ changed: false, unset: false });
  });

  it("has a row per filament, with the chips that describe it", () => {
    const pla = { type: "PLA", colorName: "White" };
    const petg = { type: "PETG", colorName: "White" };
    const [first, second] = diffSettings({ filaments: [pla, pla] }, { filaments: [petg, pla] });
    expect(first).toMatchObject({ label: "Filament 1", changed: true });
    expect(first?.changes.map((c) => c.text)).toEqual(["filament 1: PETG instead of PLA"]);
    expect(second).toMatchObject({ label: "Filament 2", changed: false, before: "White PLA" });
    const added = diffSettings({}, { filaments: [pla] })[0];
    expect(added).toMatchObject({ label: "Filament", before: "none", after: "White PLA", changed: true });
  });

  it("agrees with describeChanges: the chips are exactly the changed rows' chips", () => {
    const before: AttemptSettings = {
      filaments: [{ type: "PLA", brand: "Bambu", colorName: "Yellow", colorHex: "#f0b323" }],
      bedType: "Smooth PEI Plate",
      layerHeight: 0.2,
      infillDensity: 15,
      bedTemperature: 55,
      brim: false,
      supportEnabled: true,
      processPreset: "0.20mm Standard @BBL X2D",
    };
    const after: AttemptSettings = {
      filaments: [{ type: "PETG", brand: "Bambu", colorName: "Teal", colorHex: "#2c8a87" }],
      bedType: "Textured PEI Plate",
      layerHeight: 0.16,
      infillDensity: 15,
      bedTemperature: 60,
      chamberTemperature: 35,
      brim: true,
      supportEnabled: false,
      processPreset: "0.16mm Optimal @BBL X2D",
      filamentDried: true,
      weightGrams: 40,
    };
    const rows = diffSettings(before, after);
    expect(describeChanges(before, after)).toEqual(rows.flatMap((r) => r.changes));
    for (const r of rows) expect(r.changed).toBe(r.changes.length > 0);
    // Results are not settings.
    expect(rows.some((r) => r.key === "weightGrams")).toBe(false);
  });
});

describe("summarizeBuild", () => {
  const done = (outcome: "success" | "partial" | "failed", settings: AttemptSettings = {}) => ({ outcome, settings });
  const printing = (settings: AttemptSettings = {}) => ({ outcome: null, settings });

  it("says how the attempts went, worst first, with what is printing last", () => {
    const summary = summarizeBuild([done("failed"), done("partial"), done("failed"), printing()]);
    expect(summary.counts).toEqual({ success: 0, partial: 1, failed: 2, printing: 1 });
    expect(summary.words).toBe("2 spaghetti, 1 partly, printing now");
    expect(outcomeWords({ success: 3, partial: 0, failed: 0, printing: 0 })).toBe("3 worked");
    expect(summarizeBuild([]).words).toBe("");
  });

  it("adds the time on the bed exactly when every attempt knows it", () => {
    const summary = summarizeBuild([
      done("failed", { actualMinutes: 197 }),
      done("success", { actualMinutes: 185, estimatedMinutes: 190 }),
    ]);
    expect(summary.minutes).toEqual({ value: 382, approximate: false });
  });

  it("falls back to the estimate and then says 'about'", () => {
    const summary = summarizeBuild([done("failed", { actualMinutes: 100 }), done("success", { estimatedMinutes: 60 })]);
    expect(summary.minutes).toEqual({ value: 160, approximate: true });
    // An attempt with no time at all makes the total a guess too, but it still shows what is known.
    expect(summarizeBuild([done("failed", { actualMinutes: 100 }), done("success")]).minutes).toEqual({
      value: 100,
      approximate: true,
    });
  });

  it("leaves out a figure nobody has", () => {
    const summary = summarizeBuild([done("failed"), done("success")]);
    expect(summary.minutes).toBeNull();
    expect(summary.grams).toBeNull();
  });

  it("adds the weight, and says 'at least' when some attempts have none", () => {
    expect(summarizeBuild([done("failed", { weightGrams: 64 }), done("success", { weightGrams: 66 })]).grams).toEqual({
      value: 130,
      atLeast: false,
    });
    expect(summarizeBuild([done("failed", { weightGrams: 64 }), done("success")]).grams).toEqual({
      value: 64,
      atLeast: true,
    });
  });

  it("counts nothing from a print still on the bed", () => {
    const summary = summarizeBuild([
      done("failed", { actualMinutes: 100, weightGrams: 50 }),
      printing({ estimatedMinutes: 190 }),
    ]);
    expect(summary.minutes).toEqual({ value: 100, approximate: false });
    expect(summary.grams).toEqual({ value: 50, atLeast: false });
    expect(summary.counts.printing).toBe(1);
  });

  it("lists each filament once: by spool, else by type and color", () => {
    const yellow = { type: "PLA", colorName: "Yellow", colorHex: "#F0B323" };
    const summary = summarizeBuild([
      done("failed", { filaments: [yellow, { type: "PLA", colorName: "White", spoolId: "s1" }] }),
      done("partial", {
        filaments: [
          { ...yellow, colorHex: "#f0b323" },
          { type: "PLA", colorName: "Jade white", spoolId: "s1" },
          { type: "PETG", colorName: "Teal", colorHex: "#2c8a87" },
          {},
        ],
      }),
    ]);
    expect(summary.filaments.map((f) => f.colorName)).toEqual(["Yellow", "White", "Teal"]);
  });
});
