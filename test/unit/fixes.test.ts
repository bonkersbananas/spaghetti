import { describe, expect, it } from "vitest";
import { type FixableAttempt, findFixes, pickFix } from "../../src/shared/fixes.ts";
import type { Outcome } from "../../src/shared/outcomes.ts";

type Try = FixableAttempt & { tags: string[] };

/** An attempt printed on day `day`, with these failure tags. */
const attempt = (id: string, day: number, outcome: Outcome | null, tags: string[] = []): Try => ({
  id,
  outcome,
  printedAt: day * 86_400_000,
  createdAt: day * 86_400_000,
  tags,
});

const warps = (a: Try) => a.tags.includes("warping");

describe("pickFix", () => {
  it("is the next attempt on the build that went better", () => {
    const build = [attempt("1", 1, "failed", ["warping"]), attempt("2", 2, "success")];
    expect(pickFix(build, build[0] as Try, warps)?.id).toBe("2");
  });

  it("takes partly after spaghetti when the problem is gone", () => {
    const build = [attempt("1", 1, "failed", ["warping"]), attempt("2", 2, "partial", ["stringing"])];
    expect(pickFix(build, build[0] as Try, warps)?.id).toBe("2");
  });

  it("skips a better attempt that had the same problem again, for the one after it", () => {
    // The swatch box: spaghetti and warping, then partly and still warping, then flat with the filament dried.
    const build = [
      attempt("1", 1, "failed", ["warping", "bed-adhesion"]),
      attempt("2", 2, "partial", ["warping"]),
      attempt("3", 3, "success"),
    ];
    expect(pickFix(build, build[0] as Try, warps)?.id).toBe("3");
    expect(pickFix(build, build[1] as Try, warps)?.id).toBe("3");
  });

  it("counts an attempt that worked as a fix whatever it says", () => {
    const build = [attempt("1", 1, "partial", ["warping"]), attempt("2", 2, "success", ["warping"])];
    expect(pickFix(build, build[0] as Try, warps)?.id).toBe("2");
  });

  it("is none when nothing after it went better", () => {
    const failed = attempt("1", 1, "failed", ["warping"]);
    expect(pickFix([failed], failed, warps)).toBeNull();
    expect(pickFix([failed, attempt("2", 2, "failed")], failed, warps)).toBeNull();
    // Still printing, or off the bed without an answer.
    expect(pickFix([failed, attempt("2", 2, null)], failed, warps)).toBeNull();
    const partly = attempt("1", 1, "partial", ["warping"]);
    expect(pickFix([partly, attempt("2", 2, "partial", ["stringing"])], partly, warps)).toBeNull();
    expect(pickFix([partly, attempt("2", 2, "failed")], partly, warps)).toBeNull();
  });

  it("never looks back: an attempt that worked before the failure is not its fix", () => {
    const build = [attempt("1", 1, "success"), attempt("2", 2, "failed", ["warping"])];
    expect(pickFix(build, build[1] as Try, warps)).toBeNull();
  });

  it("follows print order, not the order it was given in", () => {
    const build = [attempt("3", 3, "success"), attempt("2", 2, "success"), attempt("1", 1, "failed", ["warping"])];
    expect(pickFix(build, build[2] as Try, warps)?.id).toBe("2");
  });

  it("is none for an attempt that is not a failure", () => {
    const build = [attempt("1", 1, "success"), attempt("2", 2, "success")];
    expect(pickFix(build, build[0] as Try)).toBeNull();
    const printing = attempt("1", 1, null);
    expect(pickFix([printing, attempt("2", 2, "success")], printing)).toBeNull();
  });
});

describe("findFixes", () => {
  const swatch = [
    attempt("s1", 1, "failed", ["warping"]),
    attempt("s2", 2, "partial", ["warping"]),
    attempt("s3", 3, "success"),
  ];
  const chain = [attempt("c1", 5, "failed", ["warping"])];
  const steamer = [attempt("p1", 4, "failed", ["warping"]), attempt("p2", 6, "partial", ["layer-lines"])];
  const builds = [swatch, chain, steamer];
  const attemptsOf = (failure: Try) => builds.find((build) => build.includes(failure)) ?? [];

  it("gives one fix per fixing attempt, with every failure it came after in print order", () => {
    const failures = [swatch[1], chain[0], steamer[0], swatch[0]] as Try[];
    const fixes = findFixes(failures, attemptsOf, warps);
    expect(fixes.map((fix) => fix.fix.id)).toEqual(["s3", "p2"]);
    expect(fixes[0]?.after.map((a) => a.id)).toEqual(["s1", "s2"]);
    expect(fixes[1]?.after.map((a) => a.id)).toEqual(["p1"]);
  });

  it("is empty when no failure got better", () => {
    expect(findFixes([chain[0] as Try], attemptsOf, warps)).toEqual([]);
  });
});
