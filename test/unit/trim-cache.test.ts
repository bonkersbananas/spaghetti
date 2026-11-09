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
    const trimmed = trimCache(client([...lists, ...details]), new Map(), {
      limits: { "items-detail": 10 },
      maxBytes: 100_000,
    });
    expect(hashes(trimmed)).toEqual(["ideas", "builds", "d1", "d2", "d3", "d4"]);
  });

  it("keeps only the most recently fetched item pages", () => {
    const trimmed = trimCache(client([...lists, ...details]), new Map([["d1", 999]]), {
      limits: { "items-detail": 2 },
      maxBytes: 100_000,
    });
    expect(hashes(trimmed)).toEqual(["ideas", "builds", "d1", "d4"]);
  });

  it("drops the oldest item pages first when over the size ceiling", () => {
    const big = details.map((d) => ({ ...d, state: { ...d.state, data: "y".repeat(1000) } }));
    const trimmed = trimCache(client([...lists, ...big]), new Map(), {
      limits: { "items-detail": 10 },
      maxBytes: 2500,
    });
    expect(hashes(trimmed)).toEqual(["ideas", "builds", "d3", "d4"]);
  });

  it("gives up when the lists alone are too big", () => {
    expect(trimCache(client(lists), new Map(), { limits: { "items-detail": 10 }, maxBytes: 10 })).toBeNull();
  });

  it("caps other groups too, such as saved searches, and leaves unlisted ones alone", () => {
    const searches = [1, 2, 3].map((n) => query(["search", `q${n}`], `s${n}`, n));
    const facets = [query(["facets"], "facets", 1)];
    const trimmed = trimCache(client([...lists, ...searches, ...facets]), new Map(), {
      limits: { search: 2 },
      maxBytes: 100_000,
    });
    expect(hashes(trimmed)).toEqual(["ideas", "builds", "s2", "s3", "facets"]);
  });
});
