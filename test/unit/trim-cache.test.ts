import { describe, expect, it } from "vitest";
import { trimCache } from "../../src/shared/trim-cache.ts";

const query = (key: unknown[], hash: string, at: number, data = "x") => ({
  queryKey: key,
  queryHash: hash,
  state: { dataUpdatedAt: at, data },
});
const client = (queries: ReturnType<typeof query>[]) => ({ clientState: { queries } });
const hashes = (c: { clientState: { queries: { queryHash: string }[] } } | null) =>
  c?.clientState.queries.map((q) => q.queryHash);

describe("trimCache", () => {
  const lists = [query(["items", "list", "ideas"], "ideas", 1), query(["items", "list", "builds"], "builds", 1)];
  const details = [1, 2, 3, 4].map((n) => query(["items", "detail", `d${n}`], `d${n}`, n * 10));

  it("keeps everything that fits", () => {
    const trimmed = trimCache(client([...lists, ...details]), new Map(), { maxDetails: 10, maxBytes: 100_000 });
    expect(hashes(trimmed)).toEqual(["ideas", "builds", "d1", "d2", "d3", "d4"]);
  });

  it("keeps only the most recently fetched item pages", () => {
    const trimmed = trimCache(client([...lists, ...details]), new Map([["d1", 999]]), {
      maxDetails: 2,
      maxBytes: 100_000,
    });
    expect(hashes(trimmed)).toEqual(["ideas", "builds", "d1", "d4"]);
  });

  it("drops the oldest item pages first when over the size ceiling", () => {
    const big = details.map((d) => ({ ...d, state: { ...d.state, data: "y".repeat(1000) } }));
    const trimmed = trimCache(client([...lists, ...big]), new Map(), { maxDetails: 10, maxBytes: 2500 });
    expect(hashes(trimmed)).toEqual(["ideas", "builds", "d3", "d4"]);
  });

  it("gives up when the lists alone are too big", () => {
    expect(trimCache(client(lists), new Map(), { maxDetails: 10, maxBytes: 10 })).toBeNull();
  });
});
