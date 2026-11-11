import { describe, expect, it } from "vitest";
import { assignShards, readTimings, specFiles } from "../../scripts/e2e-shard.ts";

describe("e2e shards", () => {
  const files = specFiles();
  const timings = readTimings();
  const shards = assignShards(files, timings, 2);

  it("run every spec file in exactly one shard, and leave the timing tests to their own job", () => {
    expect(shards.flat().sort()).toEqual(files);
    expect(files).not.toContain("performance.spec.ts");
  });

  it("are balanced by time, and a new spec without a timing still gets a shard", () => {
    const load = (shard: string[]) => shard.reduce((sum, file) => sum + (timings[file] ?? 60), 0);
    const loads = shards.map(load);
    expect(Math.max(...loads) / Math.min(...loads)).toBeLessThan(1.2);
    expect(assignShards([...files, "brand-new.spec.ts"], timings, 2).flat()).toContain("brand-new.spec.ts");
  });
});
