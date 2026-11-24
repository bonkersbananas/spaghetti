import { describe, expect, it } from "vitest";
import { printingAttempts } from "../../src/client/lib/builds.ts";

const NOW = 1_000_000_000_000;
const MIN = 60_000;

function build(id: string, printedAgo: number, opts: { endedAgo?: number; minutes?: number; outcome?: string } = {}) {
  return {
    id,
    stage: "building",
    attempts: [
      {
        id: `${id}-a`,
        outcome: opts.outcome ?? null,
        printedAt: NOW - printedAgo,
        endedAt: opts.endedAgo === undefined ? null : NOW - opts.endedAgo,
        settings: { estimatedMinutes: opts.minutes ?? 600 },
      },
    ],
  } as never;
}

const order = (items: never[]) =>
  printingAttempts(items, NOW).map(({ item }) => (item as unknown as { id: string }).id);

describe("printingAttempts order", () => {
  it("puts a print off the bed and waiting before prints still printing", () => {
    expect(order([build("printing", 10 * MIN), build("off", 90 * MIN, { endedAgo: 5 * MIN })])).toEqual([
      "off",
      "printing",
    ]);
  });

  it("puts the print that ended last first among several off the bed", () => {
    expect(
      order([
        build("older", 300 * MIN, { endedAgo: 120 * MIN }),
        build("newer", 100 * MIN, { endedAgo: 5 * MIN }),
        build("printing", 10 * MIN),
      ]),
    ).toEqual(["newer", "older", "printing"]);
  });

  it("keeps a print that should be done by now before one that just started", () => {
    expect(order([build("fresh", 5 * MIN), build("late", 300 * MIN, { minutes: 60 })])).toEqual(["late", "fresh"]);
  });

  it("leaves answered prints out", () => {
    expect(order([build("done", 90 * MIN, { endedAgo: MIN, outcome: "success" })])).toEqual([]);
  });
});
