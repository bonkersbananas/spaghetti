import { describe, expect, it } from "vitest";
import { findSpool, planAmsSync, remainingFrom, type Tray, traysOf } from "../../bridge/ams.ts";
import { emptyState, foldReport } from "../../bridge/printer-state.ts";
import type { Spool } from "../../src/shared/api.ts";
import { fullReport } from "./fixtures.ts";

let counter = 0;
const spool = (fields: Partial<Spool>): Spool => ({
  id: `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  material: "PLA",
  brand: null,
  colorName: null,
  colorHex: null,
  finish: null,
  remaining: "full",
  netGrams: null,
  tareGrams: null,
  gramsLeft: null,
  gramsApproximate: false,
  weighedAt: null,
  note: "",
  driedAt: null,
  photo: null,
  slot: null,
  trayUuid: null,
  createdBy: "u",
  createdAt: 0,
  updatedAt: 0,
  ...fields,
});

const tray = (fields: Partial<Tray>): Tray => ({
  slot: "A1",
  material: "PLA",
  colorHex: "#00ae42",
  subBrand: "PLA Basic",
  trayUuid: "AAAA0000AAAA0000AAAA0000AAAA0001",
  remain: 80,
  ...fields,
});

describe("reading trays", () => {
  it("names the slots, drops empty trays, keeps only real tags and levels", () => {
    const trays = traysOf(foldReport(emptyState(), fullReport({ state: "IDLE" })).print);
    expect(trays.map((t) => t.slot)).toEqual(["A1", "A2", "A3"]);
    expect(trays[0]).toMatchObject({ colorHex: "#00ae42", subBrand: "PLA Basic", remain: 82 });
    expect(trays[2]).toMatchObject({ trayUuid: null, remain: null, colorHex: "#c12e1f" });
  });

  it("maps a percentage to the app's four levels", () => {
    expect([100, 70, 69, 30, 29, 8, 7, 0].map(remainingFrom)).toEqual([
      "full",
      "full",
      "half",
      "half",
      "low",
      "low",
      "empty",
      "empty",
    ]);
  });
});

describe("matching a tray to a spool", () => {
  it("finds the spool by its stored tray UUID before anything else", () => {
    const byUuid = spool({ material: "PETG", colorHex: "#000000", trayUuid: "AAAA0000AAAA0000AAAA0000AAAA0001" });
    const byColor = spool({ colorHex: "#00ae42", brand: "Bambu Lab" });
    expect(findSpool(tray({}), [byColor, byUuid], new Set())).toBe(byUuid);
  });

  it("falls back to brand, material and colour", () => {
    const bambu = spool({ colorHex: "#02af43", brand: "Bambu Lab" });
    const other = spool({ colorHex: "#00ae42", brand: "Eryone" });
    expect(findSpool(tray({}), [other, bambu], new Set())).toBe(bambu);
    expect(findSpool(tray({}), [spool({ material: "PETG", colorHex: "#00ae42" })], new Set())).toBeNull();
    expect(findSpool(tray({}), [spool({ colorHex: "#ff0000", brand: "Bambu Lab" })], new Set())).toBeNull();
  });

  it("prefers the spool already in that slot, then one with filament left", () => {
    const empty = spool({ colorHex: "#00ae42", brand: "Bambu Lab", remaining: "empty" });
    const full = spool({ colorHex: "#00ae42", brand: "Bambu Lab" });
    expect(findSpool(tray({ trayUuid: null }), [empty, full], new Set())).toBe(full);
    const inSlot = spool({ colorHex: "#00ae42", brand: "Bambu Lab", slot: "A1", remaining: "empty" });
    expect(findSpool(tray({ trayUuid: null }), [full, inSlot], new Set())).toBe(inSlot);
  });

  it("doesn't give one spool to two trays, or a tagged spool to a different tag", () => {
    const only = spool({ colorHex: "#00ae42", brand: "Bambu Lab" });
    expect(findSpool(tray({}), [only], new Set([only.id]))).toBeNull();
    const tagged = spool({ colorHex: "#00ae42", brand: "Bambu Lab", trayUuid: "FFFF0000FFFF0000FFFF0000FFFF0000" });
    expect(findSpool(tray({}), [tagged], new Set())).toBeNull();
  });
});

describe("the AMS sync plan", () => {
  it("loads a matched spool, sets its level and remembers the tag", () => {
    const found = spool({ colorHex: "#00ae42", brand: "Bambu Lab", remaining: "full" });
    const plan = planAmsSync([tray({ remain: 40 })], [found], "printer");
    expect(plan.actions).toEqual([
      { type: "load", slot: "A1", spoolId: found.id },
      { type: "setTrayUuid", spoolId: found.id, trayUuid: "AAAA0000AAAA0000AAAA0000AAAA0001" },
      { type: "setLevel", spoolId: found.id, remaining: "half" },
    ]);
    expect(plan.unknown).toEqual([]);
  });

  it("does nothing when the app already matches", () => {
    const found = spool({
      slot: "A1",
      trayUuid: "AAAA0000AAAA0000AAAA0000AAAA0001",
      remaining: "full",
      brand: "Bambu Lab",
      colorHex: "#00ae42",
    });
    expect(planAmsSync([tray({ remain: 90 })], [found], "printer")).toEqual({ actions: [], unknown: [] });
  });

  it("makes a new spool for an RFID Bambu spool nobody has, with the same id every time", () => {
    const first = planAmsSync([tray({ subBrand: "PLA Silk+", remain: 100 })], [], "printer");
    const again = planAmsSync([tray({ subBrand: "PLA Silk+", remain: 100 })], [], "printer");
    expect(first).toEqual(again);
    expect(first.actions[0]).toMatchObject({
      type: "createSpool",
      spool: {
        material: "PLA",
        brand: "Bambu Lab",
        finish: "silk",
        colorHex: "#00ae42",
        remaining: "full",
        trayUuid: "AAAA0000AAAA0000AAAA0000AAAA0001",
      },
    });
    expect(first.actions[1]).toMatchObject({ type: "load", slot: "A1" });
  });

  it("leaves the slot alone for a tray without a tag and no match, and reports it unknown", () => {
    const plan = planAmsSync([tray({ slot: "A3", trayUuid: null, remain: null, subBrand: null })], [], "printer");
    expect(plan.actions).toEqual([]);
    expect(plan.unknown).toEqual([{ slot: "A3", material: "PLA", colorHex: "#00ae42", brand: null }]);
  });

  it("doesn't keep asking when a person already put a spool of that material in the slot", () => {
    const picked = spool({ slot: "A3", colorHex: "#123456" });
    expect(planAmsSync([tray({ slot: "A3", trayUuid: null, subBrand: null })], [picked], "p").unknown).toEqual([]);
  });

  it("leaves a level alone where the printer doesn't know it", () => {
    const found = spool({ slot: "A3", colorHex: "#00ae42", remaining: "low" });
    expect(planAmsSync([tray({ slot: "A3", trayUuid: null, remain: null })], [found], "p").actions).toEqual([]);
  });
});
