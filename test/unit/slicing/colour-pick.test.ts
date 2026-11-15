import { describe, expect, it } from "vitest";
import { planColours, planProject, slotKey } from "../../../src/shared/slicing/colours.ts";
import { sliceSetup } from "../../../src/shared/slicing/configs.ts";
import { DEFAULT_SLICING } from "../../../src/shared/slicing/defaults.ts";
import { changeWords, modelSlicing, slicingAhead } from "../../../src/shared/slicing/model.ts";
import { filamentOfSpool } from "../../../src/shared/slicing/pantry.ts";
import { normalizeSlicing, type SlicingSettings, slicingFor } from "../../../src/shared/slicing/settings.ts";
import type { FileSlice } from "../../../src/shared/slicing/types.ts";
import { presets } from "./presets.ts";

/** What the slice worker records for a project of three filaments sliced with `chosen` (as slice-worker.ts does). */
function sliceOf(chosen: Partial<SlicingSettings>, used = 3): FileSlice {
  const listed = Array.from({ length: used }, (_, index) => ({ slot: index + 1, material: "PLA" }));
  const spools = [{ id: "jade", material: "PLA", colorHex: "#f4f1ea", colorName: "Jade white", slot: "A1" }];
  const plan = planProject(listed, new Set(listed.map((f) => f.slot)), spools, chosen.colours ?? []);
  const setup = sliceSetup(presets, {
    settings: { ...chosen, filaments: plan.filaments },
    defaults: DEFAULT_SLICING,
    filaments: used,
  });
  // The worker's withChoices, then the record as the server keeps it.
  const recorded = normalizeSlicing(
    JSON.parse(JSON.stringify({ ...setup.slicing, ...(chosen.colours?.length ? { colours: chosen.colours } : {}) })),
    DEFAULT_SLICING,
  );
  return {
    status: "sliced",
    colours: plan.rows.map((row) => ({
      hex: row.hex ?? "#8c8c8c",
      slot: row.slot,
      share: 0,
      filament: row.match.filament,
      inPantry: row.match.inPantry,
    })),
    settings: { ...setup.settings, scale: 100, engine: "1", orca: "2.5", slicing: recorded },
    at: 1,
  } as FileSlice;
}

/** The same for a model with colours of its own (the hotdog): the plate's filaments are the choices' groups'. */
function colouredSliceOf(chosen: Partial<SlicingSettings>): FileSlice {
  const uses = [
    { hex: "#e4b200", name: "Mustard", area: 50 },
    { hex: "#d2281e", name: "Ketchup", area: 40 },
    { hex: "#6f3fa0", name: "Grape", area: 10 },
  ];
  const plan = planColours(
    uses,
    [{ id: "jade", material: "PLA", colorHex: "#f4f1ea", colorName: "Jade white" }],
    chosen.colours ?? [],
  );
  const setup = sliceSetup(presets, {
    settings: { ...chosen, filaments: plan.filaments },
    defaults: DEFAULT_SLICING,
    filaments: plan.filaments.length,
  });
  const recorded = normalizeSlicing(
    JSON.parse(JSON.stringify({ ...setup.slicing, ...(chosen.colours?.length ? { colours: chosen.colours } : {}) })),
    DEFAULT_SLICING,
  );
  return {
    status: "sliced",
    colours: plan.groups.map((group) => ({
      hex: group.hex,
      share: 0,
      filament: group.filament,
      inPantry: group.inPantry,
    })),
    settings: { ...setup.settings, scale: 100, engine: "1", orca: "2.5", slicing: recorded },
    at: 1,
  } as FileSlice;
}

describe("a colour pick and the slice made with it", () => {
  const palette = (slot: number, hex = "#f4f1ea", name = "Jade white") => ({
    from: slotKey(slot),
    filament: { material: "PLA", colorHex: hex, colorName: name },
  });
  const spool = {
    from: slotKey(1),
    filament: filamentOfSpool({
      id: "jade",
      material: "PLA",
      colorHex: "#f4f1ea",
      colorName: "Jade white",
      slot: "A1",
    }),
  };

  for (const [name, choices] of [
    ["a palette colour", [palette(3)]],
    ["two palette colours", [palette(1, "#e4f01c", "Neon yellow"), palette(2, "#1d1d1f", "Black")]],
    ["a Pantry spool", [spool]],
    ["a spool and a palette colour", [spool, palette(2, "#1d1d1f", "Black")]],
  ] as const) {
    it(`is not ahead of its slice once sliced: ${name}`, () => {
      const first = sliceOf({});
      const settings = modelSlicing({ slicing: null, slice: first }, DEFAULT_SLICING);
      const next = slicingFor({ colours: [...choices] }, settings);
      expect(slicingAhead({ slicing: next, slice: first })).not.toBeNull();
      const made = sliceOf(next);
      expect(slicingAhead({ slicing: next, slice: made })).toBeNull();
    });
  }

  it("is not ahead once a coloured model's choice has reordered its filaments", () => {
    const first = colouredSliceOf({});
    const settings = modelSlicing({ slicing: null, slice: first }, DEFAULT_SLICING);
    for (const choices of [
      [{ from: "#6f3fa0", filament: { material: "PLA", colorHex: "#e4f01c", colorName: "Neon yellow" } }],
      [{ from: "#e4b200", filament: spool.filament }],
      [
        { from: "#e4b200", filament: spool.filament },
        { from: "#d2281e", filament: spool.filament },
      ],
    ]) {
      const next = slicingFor({ colours: choices }, settings);
      expect(slicingAhead({ slicing: next, slice: first })).not.toBeNull();
      expect(slicingAhead({ slicing: next, slice: colouredSliceOf(next) })).toBeNull();
    }
  });

  it("is not ahead once a one-filament model's palette colour or spool is sliced", () => {
    const one = (filament: SlicingSettings["filaments"][number]) => {
      const setup = sliceSetup(presets, { settings: { filaments: [filament] }, defaults: DEFAULT_SLICING });
      const recorded = normalizeSlicing(JSON.parse(JSON.stringify(setup.slicing)), DEFAULT_SLICING);
      return {
        slice: {
          status: "sliced",
          settings: { ...setup.settings, scale: 100, engine: "1", orca: "2.5", slicing: recorded },
          at: 1,
        } as FileSlice,
        chosen: slicingFor({ filaments: [filament] }),
      };
    };
    for (const filament of [{ material: "PLA", colorHex: "#e4f01c", colorName: "Neon yellow" }, spool.filament]) {
      const { slice, chosen } = one(filament);
      expect(slicingAhead({ slicing: chosen, slice })).toBeNull();
    }
  });

  it("says what a pick is while it slices", () => {
    const before = slicingFor({});
    const jade = { from: "f3", filament: { material: "PLA", colorHex: "#f4f1ea", colorName: "Jade white" } };
    const black = { from: "f2", filament: { material: "PLA", colorHex: "#1d1d1f", colorName: "Black" } };
    expect(changeWords(before, slicingFor({ colours: [jade] }, before))).toBe("Jade white");
    expect(changeWords(before, slicingFor({ colours: [jade, black] }, before))).toBe(
      "the colours printed in other filaments",
    );
    const had = slicingFor({ colours: [jade] }, before);
    expect(changeWords(had, slicingFor({ colours: [] }, had))).toBe("the nearest spools");
  });
});
