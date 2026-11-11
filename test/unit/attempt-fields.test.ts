import { describe, expect, it } from "vitest";
import { fieldsFor, type SheetValue, toChanges, toFields, toValue } from "../../src/shared/attempt-fields.ts";

const attempt: SheetValue = {
  outcome: "partial",
  printedAt: 1000,
  note: "Original",
  failureTags: ["warping"],
  successNotes: [],
  parts: [{ partId: "hull", count: 1 }],
  settings: { bedTemperature: 60, layerHeight: 0.2, filaments: [{ type: "PLA", colorName: "White" }] },
};

describe("attempt fields", () => {
  it("round-trips an attempt, with a field for every setting", () => {
    const fields = toFields(attempt);
    expect(fields["s.bedTemperature"]).toBe(60);
    expect("s.brim" in fields).toBe(true);
    expect(fields["s.brim"]).toBeUndefined();
    expect(toValue(fields)).toEqual(attempt);
  });

  it("keeps what's on the plate as one field that goes as it is", () => {
    const fields = toFields(attempt);
    expect(fields.parts).toEqual([{ partId: "hull", count: 1 }]);
    const next = [
      { partId: "hull", count: 2 },
      { partId: "deck", count: 1 },
    ];
    expect(fieldsFor(fields, { parts: next })).toEqual({ parts: next });
    expect(toChanges({ parts: next }, attempt.settings)).toEqual({ changes: { parts: next } });
  });

  it("turns a change to the sheet's value into only the fields that differ", () => {
    const fields = toFields(attempt);
    expect(fieldsFor(fields, { note: "Edited" })).toEqual({ note: "Edited" });
    expect(fieldsFor(fields, { settings: { ...attempt.settings, bedTemperature: 65 } })).toEqual({
      "s.bedTemperature": 65,
    });
    // A cleared setting is a field gone to undefined; one added is a new field.
    const { layerHeight: _cleared, ...without } = attempt.settings;
    expect(fieldsFor(fields, { settings: { ...without, brim: true } })).toEqual({
      "s.layerHeight": undefined,
      "s.brim": true,
    });
    expect(fieldsFor(fields, { settings: { ...attempt.settings } })).toEqual({});
  });

  it("sends plain fields as they are, and only the settings that changed as a merge", () => {
    // The other person added a nozzle temperature and changed the layer height since this sheet loaded.
    const known = { ...attempt.settings };
    expect(toChanges({ note: "Mine" }, known)).toEqual({ changes: { note: "Mine" } });
    expect(toChanges({ "s.bedTemperature": 65, note: "Mine" }, known)).toEqual({
      // For the cache (and an attempt the server doesn't have): the whole settings as known here, with the change.
      changes: { note: "Mine", settings: { ...known, bedTemperature: 65 } },
      // For the server: just the change, so its own latest settings are kept.
      settingsMerge: { set: { bedTemperature: 65 }, unset: [] },
    });
    // Clearing a setting removes it, and says only that.
    const cleared = toChanges({ "s.bedTemperature": undefined }, known);
    expect(cleared.settingsMerge).toEqual({ set: {}, unset: ["bedTemperature"] });
    expect(cleared.changes.settings).toEqual({ layerHeight: 0.2, filaments: known.filaments });
  });
});
