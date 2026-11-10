import { describe, expect, it } from "vitest";
import { DRYING_DAYS, dryingKey, dryingWindow, needsDrying } from "../../src/shared/drying.ts";

const DAY = 24 * 3_600_000;
const now = Date.UTC(2026, 10, 10, 12);

describe("drying windows", () => {
  it("is long for PLA and short for the thirsty ones", () => {
    expect(DRYING_DAYS.PLA).toBeGreaterThan(DRYING_DAYS.PETG ?? 0);
    expect(DRYING_DAYS.PETG).toBeGreaterThan(DRYING_DAYS.PA ?? 0);
    expect(DRYING_DAYS.PA).toBeGreaterThanOrEqual(DRYING_DAYS.PVA ?? 0);
  });

  it("finds the material however people write it", () => {
    expect(dryingKey("PLA")).toBe("PLA");
    expect(dryingKey("pla silk")).toBe("PLA");
    expect(dryingKey("PLA+")).toBe("PLA");
    expect(dryingKey("PETG-CF")).toBe("PETG");
    expect(dryingKey("PET-CF")).toBe("PET");
    expect(dryingKey("PA6-CF")).toBe("PA");
    expect(dryingKey("PAHT-CF")).toBeNull();
    expect(dryingKey("Wood")).toBeNull();
  });

  it("lets people's own numbers win", () => {
    expect(dryingWindow("PETG")).toBe(21);
    expect(dryingWindow("PETG", { PETG: 10 })).toBe(10);
    expect(dryingWindow("Nylon", { NYLON: 4 })).toBe(4);
    expect(dryingWindow("Wood")).toBeNull();
  });
});

describe("a spool past its window", () => {
  const spool = { material: "PETG", driedAt: now - 22 * DAY, createdAt: now - 100 * DAY };
  it("counts from the day it was dried", () => {
    expect(needsDrying(spool, now)).toBe(true);
    expect(needsDrying({ ...spool, driedAt: now - 20 * DAY }, now)).toBe(false);
  });
  it("counts from the day it was added when it was never dried", () => {
    expect(needsDrying({ ...spool, driedAt: null }, now)).toBe(true);
    expect(needsDrying({ ...spool, driedAt: null, createdAt: now - 2 * DAY }, now)).toBe(false);
  });
  it("leaves out empty spools and materials without a window", () => {
    expect(needsDrying({ ...spool, remaining: "empty" }, now)).toBe(false);
    expect(needsDrying({ ...spool, material: "Wood" }, now)).toBe(false);
  });
  it("follows the overrides", () => {
    expect(needsDrying({ ...spool, driedAt: now - 22 * DAY }, now, { PETG: 30 })).toBe(false);
  });
});
