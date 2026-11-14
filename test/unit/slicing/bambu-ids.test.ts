import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BAMBU_PRINTER_MODEL_IDS, bambuFilamentId } from "../../../src/shared/slicing/bambu-ids.ts";

describe("Bambu's ids", () => {
  it("name the filament Bambu Studio's AMS mapping matches by, whatever the nozzle", () => {
    expect(bambuFilamentId("Bambu PLA Basic @BBL X2D 0.4 nozzle")).toBe("GFA00");
    expect(bambuFilamentId("Bambu PLA Basic @BBL X2D 0.2 nozzle")).toBe("GFA00");
    expect(bambuFilamentId("Bambu PLA Silk+ @BBL X2D")).toBe("GFA06");
    expect(bambuFilamentId("Generic PETG @BBL X2D 0.4 nozzle")).toBe("GFG99");
    expect(bambuFilamentId("Something of my own")).toBe("");
    expect(BAMBU_PRINTER_MODEL_IDS["Bambu Lab X2D"]).toBe("N6");
  });

  it("are the same in our own slicer's packer (slicer-rs/src/pack.rs)", () => {
    const rust = readFileSync(new URL("../../../slicer-rs/src/pack.rs", import.meta.url), "utf8");
    const rows = [...rust.matchAll(/^\s+\("([^"]+)", "(GF[A-Z]\d\d)"\),$/gm)].map((m) => [m[1], m[2]]);
    expect(rows.length).toBeGreaterThan(60);
    for (const [family, id] of rows) expect(bambuFilamentId(`${family} @BBL X2D 0.4 nozzle`)).toBe(id);
    expect(rust).toContain('"Bambu Lab X2D" => "N6"');
  });
});
