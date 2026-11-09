import { describe, expect, it } from "vitest";
import {
  colorDistance,
  DEFAULT_PRINTER,
  filamentFromSpool,
  matchFilaments,
  matchSpool,
  materialKey,
  nearestColorName,
  type PrinterSetup,
  printerHints,
  type SpoolLike,
  slotIds,
  spoolFromFilament,
  spoolName,
} from "../../src/shared/spools.ts";

const spool = (id: string, material: string, colorHex: string | null, extra: Partial<SpoolLike> = {}): SpoolLike => ({
  id,
  material,
  colorHex,
  ...extra,
});

const shelf: SpoolLike[] = [
  spool("bambu-white", "PLA", "#f4f1ea", { brand: "Bambu", colorName: "Jade white", slot: "A1" }),
  spool("cheap-white", "PLA", "#ffffff", { brand: "Sunlu", colorName: "White" }),
  spool("green", "PLA", "#00ae42", { brand: "Bambu", colorName: "Bambu green", slot: "A2" }),
  spool("red-petg", "PETG", "#c12e1f", { brand: "Bambu", colorName: "Red" }),
  spool("black-petg", "PETG HF", "#1d1d1f", { colorName: "Black" }),
  spool("tpu", "TPU", "#3a3a3a"),
];

describe("matching a file's filaments to spools", () => {
  it("compares materials loosely", () => {
    expect(materialKey(" petg hf ")).toBe("PETG");
    expect(materialKey("PLA Basic")).toBe("PLA");
    expect(materialKey("PLA Matte")).toBe("PLA");
    expect(materialKey("pa6-cf")).toBe("PA6-CF");
    expect(materialKey("PLA-CF")).toBe("PLA-CF");
    expect(materialKey(undefined)).toBe("");
  });

  it("measures colors so near whites are close and green is far", () => {
    expect(colorDistance("#ffffff", "#ffffff")).toBe(0);
    expect(colorDistance("#f4f1ea", "#ffffff")).toBeLessThan(60);
    expect(colorDistance("#00ae42", "#ffffff")).toBeGreaterThan(300);
    expect(colorDistance("#zzzzzz", "#ffffff")).toBe(Number.POSITIVE_INFINITY);
  });

  it("finds the same material in the closest color, preferring a loaded spool", () => {
    // Pure white is closer to Sunlu's, but Bambu's is loaded and near enough.
    expect(matchSpool({ type: "PLA", colorHex: "#ffffff" }, shelf)?.id).toBe("bambu-white");
    expect(matchSpool({ type: "PLA", colorHex: "#00ae42" }, shelf)?.id).toBe("green");
    expect(matchSpool({ type: "PETG", colorHex: "#c42f20" }, shelf)?.id).toBe("red-petg");
    // PETG HF on the shelf is PETG in the file.
    expect(matchSpool({ type: "PETG", colorHex: "#000000" }, shelf)?.id).toBe("black-petg");
  });

  it("finds nothing for another material or a color too far off", () => {
    expect(matchSpool({ type: "ABS", colorHex: "#ffffff" }, shelf)).toBeNull();
    expect(matchSpool({ type: "PLA", colorHex: "#0a2989" }, shelf)).toBeNull();
    expect(matchSpool({ type: "PETG", colorHex: "#00ae42" }, shelf)).toBeNull();
    expect(matchSpool({ colorHex: "#ffffff" }, shelf)).toBeNull();
  });

  it("without a color, takes a spool only when it is the only one of that material", () => {
    expect(matchSpool({ type: "TPU" }, shelf)?.id).toBe("tpu");
    expect(matchSpool({ type: "PLA" }, shelf)).toBeNull();
  });

  it("passes over an empty spool when another is close", () => {
    const withEmpty = [
      spool("empty-white", "PLA", "#ffffff", { remaining: "empty" }),
      spool("half-white", "PLA", "#f6f6f6", { remaining: "half" }),
    ];
    expect(matchSpool({ type: "PLA", colorHex: "#ffffff" }, withEmpty)?.id).toBe("half-white");
  });

  it("gives each filament its own spool", () => {
    const matches = matchFilaments(
      [
        { type: "PLA", colorHex: "#ffffff" },
        { type: "PLA", colorHex: "#fefefe" },
        { type: "PLA", colorHex: "#fdfdfd" },
        { type: "PETG", colorHex: "#c12e1f" },
      ],
      shelf,
    );
    expect(matches.map((m) => m?.id ?? null)).toEqual(["bambu-white", "cheap-white", null, "red-petg"]);
  });

  it("turns a spool into an attempt filament with its plain values", () => {
    const green = shelf[2] as SpoolLike;
    expect(filamentFromSpool(green, { profile: "Bambu PLA Basic", brand: "Other", colorName: "Old" })).toEqual({
      profile: "Bambu PLA Basic",
      spoolId: "green",
      type: "PLA",
      brand: "Bambu",
      colorHex: "#00ae42",
      colorName: "Bambu green",
      amsSlot: "A2",
    });
    expect(filamentFromSpool(spool("plain", "PETG", null), { colorHex: "#123456" })).toEqual({
      spoolId: "plain",
      type: "PETG",
    });
  });

  it("guesses a new spool from a file's filament", () => {
    expect(spoolFromFilament({ type: "PLA", colorHex: "#00ae42", profile: "Bambu PLA Matte" })).toEqual({
      material: "PLA",
      brand: "Bambu",
      colorHex: "#00ae42",
      colorName: "Green",
      finish: "matte",
    });
    expect(spoolFromFilament({ type: "PETG", colorHex: "#ffffff", profile: "Generic PETG @BBL X2D" })).toEqual({
      material: "PETG",
      colorHex: "#ffffff",
      colorName: "White",
    });
    expect(spoolFromFilament({ type: "PLA", profile: "PLA Silk" })).toEqual({ material: "PLA", finish: "silk" });
    expect(nearestColorName("#0b2a8a")).toBe("Blue");
  });

  it("names a spool in two lines", () => {
    expect(spoolName({ colorName: "Jade white", brand: "Bambu", material: "PLA", finish: "matte" })).toEqual({
      title: "Jade white",
      detail: "Bambu PLA Matte",
    });
    expect(spoolName({ material: "PETG", finish: "basic" })).toEqual({ title: "PETG", detail: "" });
  });

  it("lists the slots that exist", () => {
    expect(slotIds(1)).toEqual(["A1", "A2", "A3", "A4", "Ext"]);
    expect(slotIds(0)).toEqual(["Ext"]);
    expect(slotIds(9)).toHaveLength(17);
  });
});

describe("gentle printer checks", () => {
  const texts = (settings: Parameters<typeof printerHints>[0], setup?: PrinterSetup) =>
    printerHints(settings, setup).map((hint) => `${hint.field}${hint.filament ?? ""}: ${hint.text}`);

  it("says nothing about an ordinary print", () => {
    expect(
      texts({
        filaments: [{ type: "PLA", amsSlot: "A1" }],
        nozzleTemperature: 220,
        bedTemperature: 60,
        nozzleDiameter: 0.4,
      }),
    ).toEqual([]);
  });

  it("notes temperatures past the printer's limits", () => {
    expect(texts({ nozzleTemperature: 320, bedTemperature: 130 })).toEqual([
      "nozzleTemperature: The X2D's nozzles top out at 300 °C.",
      "bedTemperature: The bed tops out at 120 °C.",
    ]);
    expect(texts({ nozzleTemperature: 300, bedTemperature: 120 })).toEqual([]);
  });

  it("notes TPU on the auxiliary nozzle or through the AMS", () => {
    expect(texts({ nozzle: "auxiliary", filaments: [{ type: "TPU 95A", amsSlot: "Ext" }] })).toEqual([
      "nozzle: TPU 95A prints from the main nozzle: the auxiliary's Bowden path struggles with it.",
    ]);
    expect(texts({ filaments: [{ type: "PLA" }, { type: "TPU", amsSlot: "A3" }] })).toEqual([
      "filament1: TPU doesn't feed well through the AMS: the external spool is safer.",
    ]);
    expect(texts({ filaments: [{ type: "TPU", amsSlot: "A3", profile: "Bambu TPU for AMS" }] })).toEqual([]);
  });

  it("notes materials the AMS or the printer can't take", () => {
    expect(texts({ filaments: [{ type: "PVA", amsSlot: "B2" }] })).toEqual([
      "filament0: Only dry PVA feeds through the AMS: damp jams it.",
    ]);
    expect(texts({ filaments: [{ type: "PPS" }] })).toEqual(["filament0: The X2D doesn't print PPS."]);
    expect(texts({ nozzle: "auxiliary", filaments: [{ type: "PPA-CF" }] })).toEqual([
      "nozzle: PPA-CF prints from the main nozzle only.",
    ]);
  });

  it("knows the nozzles fitted here", () => {
    const soft: PrinterSetup = {
      ...DEFAULT_PRINTER,
      nozzles: { main: { diameter: 0.6, hardened: false }, auxiliary: { diameter: 0.4, hardened: true } },
    };
    expect(texts({ filaments: [{ type: "PLA-CF" }], nozzleDiameter: 0.4 }, soft)).toEqual([
      "nozzleDiameter: The main nozzle fitted is 0.6 mm.",
      "filament0: PLA-CF wears a nozzle that isn't hardened.",
    ]);
    expect(texts({ nozzle: "auxiliary", filaments: [{ type: "PLA-CF" }], nozzleDiameter: 0.4 }, soft)).toEqual([]);
  });
});
