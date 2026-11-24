import { describe, expect, it } from "vitest";
import { bedOrderKey, type PrintProgressState } from "../../src/shared/print-progress.ts";

const MIN = 60_000;

interface Print {
  id: string;
  endedAt: number | null;
  printedAt: number;
  state: PrintProgressState;
  outcome?: string | null;
}

/** The order a screen lists the prints in: rank ascending, then recency descending. */
const order = (prints: Print[]) =>
  prints
    .filter((print) => (print.outcome ?? null) === null)
    .map((print) => ({ id: print.id, ...bedOrderKey({ outcome: null, ...print }, print.state) }))
    .sort((a, b) => a.rank - b.rank || b.recency - a.recency)
    .map((print) => print.id);

describe("the order of prints on the bed", () => {
  it("puts a print off the bed and waiting before prints still printing", () => {
    expect(
      order([
        { id: "printing", endedAt: null, printedAt: 100 * MIN, state: "running" },
        { id: "off", endedAt: 95 * MIN, printedAt: 10 * MIN, state: "running" },
      ]),
    ).toEqual(["off", "printing"]);
  });

  it("puts the print that ended last first among several off the bed", () => {
    expect(
      order([
        { id: "older", endedAt: 20 * MIN, printedAt: 1 * MIN, state: "running" },
        { id: "printing", endedAt: null, printedAt: 500 * MIN, state: "running" },
        { id: "newer", endedAt: 90 * MIN, printedAt: 80 * MIN, state: "running" },
      ]),
    ).toEqual(["newer", "older", "printing"]);
  });

  it("keeps a print that should be done by now before one that just started", () => {
    expect(
      order([
        { id: "fresh", endedAt: null, printedAt: 500 * MIN, state: "running" },
        { id: "late", endedAt: null, printedAt: 10 * MIN, state: "due" },
      ]),
    ).toEqual(["late", "fresh"]);
  });

  it("leaves answered prints out", () => {
    expect(order([{ id: "done", endedAt: MIN, printedAt: MIN, state: "unknown", outcome: "success" }])).toEqual([]);
  });
});
