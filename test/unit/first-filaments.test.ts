/**
 * The first twelve spools Carl Oscar and Marie ordered, entered the way a person describes them from the label: how
 * each reads, what colours it has and how it is drawn, how a colour match treats it, and which preset slices it.
 */
import { describe, expect, it } from "vitest";
import { PRODUCTS, productOf, spoolFieldsOf } from "../../src/shared/products.ts";
import { matchColour } from "../../src/shared/slicing/colours.ts";
import { sliceSetup } from "../../src/shared/slicing/configs.ts";
import { filamentOfSpool } from "../../src/shared/slicing/pantry.ts";
import {
  brandLabel,
  colourKind,
  matchSpool,
  type SpoolLike,
  spoolColors,
  spoolLabel,
  spoolName,
} from "../../src/shared/spools.ts";
import { presets } from "./slicing/presets.ts";

const hex = {
  black: "#1a1a1a",
  purple: "#7b2fbe",
  blue: "#1e5bd8",
  pink: "#f29bc0",
  gold: "#d4af37",
};

interface Entered {
  spool: SpoolLike;
  label: string;
  kind: "single" | "dual" | "tri";
  preset: string;
  /** The maker's printing range in °C. */
  nozzle: readonly [number, number];
}

let n = 0;
const spool = (fields: Omit<SpoolLike, "id">): SpoolLike => ({ id: `s${++n}`, remaining: "full", ...fields });
const on = (name: string) => `${name} @BBL X2D 0.4 nozzle`;

const twelve: Entered[] = [
  {
    spool: spool({
      brand: "Anycubic",
      material: "PLA",
      finish: "silk",
      colorName: "Black/Purple",
      colorHex: null,
      colors: [hex.black, hex.purple],
    }),
    label: "Anycubic PLA Silk · Black/Purple dual colour",
    kind: "dual",
    preset: on("Generic PLA Silk"),
    nozzle: [210, 240],
  },
  {
    spool: spool({
      brand: "Anycubic",
      material: "PLA",
      finish: "silk",
      colorName: "Black/Blue",
      colorHex: null,
      colors: [hex.black, hex.blue],
    }),
    label: "Anycubic PLA Silk · Black/Blue dual colour",
    kind: "dual",
    preset: on("Generic PLA Silk"),
    nozzle: [210, 240],
  },
  {
    spool: spool({
      brand: "Anycubic",
      material: "PLA",
      finish: "silk",
      colorName: "Pink/Gold",
      colorHex: null,
      colors: [hex.pink, hex.gold],
    }),
    label: "Anycubic PLA Silk · Pink/Gold dual colour",
    kind: "dual",
    preset: on("Generic PLA Silk"),
    nozzle: [210, 240],
  },
  {
    spool: spool({ brand: "Elegoo", material: "PLA", colorName: "Sea Green", colorHex: "#2e8b6e" }),
    label: "Elegoo PLA · Sea Green",
    kind: "single",
    preset: on("Generic PLA"),
    nozzle: [190, 230],
  },
  {
    spool: spool({
      brand: "Polymaker",
      line: "Panchroma",
      material: "PLA",
      finish: "matte",
      colorName: "Arctic Teal",
      colorHex: "#3fa6a0",
    }),
    label: "Polymaker Panchroma PLA Matte · Arctic Teal",
    kind: "single",
    // Orca has no X2D preset for Polymaker: its matte PLA slices as generic PLA, not as Bambu's matte.
    preset: on("Generic PLA"),
    nozzle: [190, 230],
  },
  {
    spool: spool({
      brand: "Polymaker",
      line: "PolyTerra",
      material: "PLA",
      colorName: "Forest Green",
      colorHex: "#2f6b3a",
    }),
    label: "Polymaker PolyTerra PLA · Forest Green",
    kind: "single",
    preset: on("Generic PLA"),
    nozzle: [190, 230],
  },
  {
    spool: spool({ brand: "Elegoo", material: "PLA", finish: "basic", colorName: "Magenta", colorHex: "#d4237a" }),
    label: "Elegoo PLA Basic · Magenta",
    kind: "single",
    preset: on("Generic PLA"),
    nozzle: [190, 230],
  },
  {
    spool: spool({ brand: "Bambu Lab", material: "PLA", finish: "matte", colorName: "Charcoal", colorHex: "#3a3a3c" }),
    label: "Bambu Lab PLA Matte · Charcoal",
    kind: "single",
    preset: on("Bambu PLA Matte"),
    nozzle: [190, 230],
  },
  {
    spool: spool({ brand: "Bambu Lab", material: "PLA", finish: "silk+", colorName: "Candy Red", colorHex: "#c8102e" }),
    label: "Bambu Lab PLA Silk+ · Candy Red",
    kind: "single",
    preset: on("Bambu PLA Silk+"),
    nozzle: [210, 240],
  },
  {
    spool: spool({
      brand: "SUNLU",
      material: "PLA+",
      finish: "silk",
      colorName: "Black/Gold/Purple",
      colorHex: null,
      colors: [hex.black, hex.gold, hex.purple],
    }),
    label: "SUNLU PLA+ Silk · Black/Gold/Purple tri-colour",
    kind: "tri",
    preset: on("Generic PLA Silk"),
    nozzle: [205, 235],
  },
  {
    spool: spool({ brand: "Bambu Lab", material: "PLA", finish: "pure", colorName: "Pure White", colorHex: "#f5f5f2" }),
    label: "Bambu Lab PLA Pure · Pure White",
    kind: "single",
    preset: on("Bambu PLA Pure"),
    nozzle: [190, 230],
  },
  {
    spool: spool({ brand: "Bambu Lab", material: "PLA", finish: "pure", colorName: "Apricot", colorHex: "#f4a460" }),
    label: "Bambu Lab PLA Pure · Apricot",
    kind: "single",
    preset: on("Bambu PLA Pure"),
    nozzle: [190, 230],
  },
];

describe("the twelve first spools", () => {
  it.each(twelve.map((entry) => [entry.label, entry] as const))("%s reads like its label", (label, entry) => {
    expect(spoolLabel(entry.spool)).toBe(label);
  });

  it("splits a label into a name and what it is, saying how many colours a silk has", () => {
    expect(spoolName(twelve[0]!.spool)).toEqual({ title: "Black/Purple", detail: "Anycubic PLA Silk · dual colour" });
    expect(spoolName(twelve[9]!.spool)).toEqual({
      title: "Black/Gold/Purple",
      detail: "SUNLU PLA+ Silk · tri-colour",
    });
    expect(spoolName(twelve[5]!.spool)).toEqual({ title: "Forest Green", detail: "Polymaker PolyTerra PLA" });
  });

  it("stores a multi-colour spool as its colours and no single colour, so nothing matches it as one", () => {
    for (const { spool: s, kind } of twelve) {
      expect(colourKind(s)).toBe(kind);
      expect(spoolColors(s)).toHaveLength(kind === "single" ? 1 : kind === "dual" ? 2 : 3);
      if (kind !== "single") expect(s.colorHex).toBeNull();
    }
  });

  it("never offers a multi-colour spool for a single model colour or a file's single filament", () => {
    const multi = twelve.filter((entry) => entry.kind !== "single").map((entry) => entry.spool);
    for (const s of multi) {
      for (const colour of spoolColors(s)) {
        expect(matchColour({ hex: colour, name: undefined }, [s]).inPantry).toBe(false);
        expect(matchSpool({ type: "PLA", colorHex: colour }, [s])).toBeNull();
      }
    }
    // The single-colour spools still match their own colour.
    const teal = twelve[4]!.spool;
    expect(matchColour({ hex: "#3fa6a0", name: undefined }, [teal]).inPantry).toBe(true);
  });

  it("slices each with the best preset the X2D has, in the colour of its first stripe", () => {
    for (const { spool: s, preset, label } of twelve) {
      const setup = sliceSetup(presets, { settings: { filaments: [filamentOfSpool(s)] } });
      expect(setup.settings.filaments, label).toEqual([preset]);
      expect(setup.colours[0], label).toBe(spoolColors(s)[0]?.toUpperCase());
    }
  });

  it("keeps each slice's nozzle temperature inside its maker's range", () => {
    for (const { spool: s, nozzle, label } of twelve) {
      const setup = sliceSetup(presets, { settings: { filaments: [filamentOfSpool(s)] } });
      const temps = (setup.filaments[0] as { nozzle_temperature: string[] }).nozzle_temperature;
      const temp = Number(temps[0]);
      expect(temp, label).toBeGreaterThanOrEqual(nozzle[0]);
      expect(temp, label).toBeLessThanOrEqual(nozzle[1]);
    }
  });

  it("moves a preset's temperature into the spool's own range where it falls outside", () => {
    const cool = filamentOfSpool(
      spool({ brand: "Elegoo", material: "PLA", colorHex: "#ffffff", nozzleTempMin: 190, nozzleTempMax: 200 }),
    );
    expect(sliceSetup(presets, { settings: { filaments: [cool] } }).filaments[0]?.nozzle_temperature).toEqual([
      "200",
      "200",
    ]);
  });

  it("falls back to the generic preset while the engine's release has none of Bambu's own", () => {
    const bare = {
      ...presets,
      filament: Object.fromEntries(
        Object.entries(presets.filament).filter(([name]) => !/Matte|Silk\+|Pure/.test(name)),
      ),
    };
    const matte = twelve[7]!.spool;
    expect(sliceSetup(bare, { settings: { filaments: [filamentOfSpool(matte)] } }).settings.filaments).toEqual([
      on("Bambu PLA Basic"),
    ]);
  });
});

describe("the ordered products, as the new-spool sheet offers them", () => {
  it("fills in what the label says, so each is one tap and a colour", () => {
    const fields = (id: string) => spoolFieldsOf(PRODUCTS.find((product) => product.id === id)!);
    expect(fields("polyterra")).toMatchObject({ brand: "Polymaker", line: "PolyTerra", material: "PLA", finish: null });
    expect(fields("sunlu-silk-tri")).toMatchObject({ brand: "SUNLU", material: "PLA+", finish: "silk" });
    expect(fields("bambu-silk-plus")).toMatchObject({ finish: "silk+", nozzleTempMin: 210, nozzleTempMax: 240 });
  });

  it("recognises a spool's product whatever the colour, and old spellings of the brand", () => {
    for (const { spool: s } of twelve) expect(productOf(s), spoolLabel(s)).toBeDefined();
    expect(productOf({ brand: "Bambu", material: "PLA", finish: "matte" })?.id).toBe("bambu-matte");
    expect(productOf({ brand: "Sunlu", material: "PLA+", finish: "silk" })?.id).toBe("sunlu-silk-tri");
  });

  it("gives every product's colours: two and three for the co-extruded silks", () => {
    expect(PRODUCTS.find((p) => p.id === "anycubic-silk-dual")?.colours).toBe(2);
    expect(PRODUCTS.find((p) => p.id === "sunlu-silk-tri")?.colours).toBe(3);
  });
});

describe("brands as makers spell them", () => {
  it("reads spools saved before as Bambu Lab and SUNLU", () => {
    expect(brandLabel("Bambu")).toBe("Bambu Lab");
    expect(brandLabel("Sunlu")).toBe("SUNLU");
    expect(brandLabel("bambu lab")).toBe("Bambu Lab");
    expect(brandLabel("Eryone")).toBe("Eryone");
    expect(spoolLabel({ brand: "Bambu", material: "PLA", finish: "matte", colorName: "Jade white" })).toBe(
      "Bambu Lab PLA Matte · Jade white",
    );
  });
});

describe("a spool picked by colour match", () => {
  it("is the same filament as one picked from the Pantry, with its line and range", () => {
    const teal = twelve[4]!.spool;
    const matched = matchColour({ hex: "#3fa6a0", name: undefined }, [teal]);
    expect(matched.filament).toEqual(filamentOfSpool(teal));
    expect(matched.filament).toMatchObject({ line: "Panchroma", nozzleTempMin: 190, nozzleTempMax: 230 });
  });
});
