import { describe, expect, it } from "vitest";
import { assignShards, BUILT_SPECS, readTimings, specFiles } from "../../scripts/e2e-shard.ts";

describe("e2e shards", () => {
  const files = specFiles();
  const timings = readTimings();
  const shards = assignShards(files, timings, 5);

  it("run every spec file in exactly one shard", () => {
    expect(shards.flat().sort()).toEqual(files);
  });

  it("keep the specs that need the production build together, in the last shard", () => {
    const built = files.filter((file) => BUILT_SPECS.test(file));
    expect(built.length).toBeGreaterThan(0);
    expect(shards[4]).toEqual(expect.arrayContaining(built));
    for (const shard of shards.slice(0, 4)) expect(shard.some((file) => BUILT_SPECS.test(file))).toBe(false);
  });

  it("are balanced by time, and a new spec without a timing still gets a shard", () => {
    const load = (shard: string[]) => shard.reduce((sum, file) => sum + (timings[file] ?? 60), 0);
    const loads = shards.map(load);
    expect(Math.max(...loads) / Math.min(...loads)).toBeLessThan(1.2);
    expect(assignShards([...files, "brand-new.spec.ts"], timings, 5).flat()).toContain("brand-new.spec.ts");
  });
});
