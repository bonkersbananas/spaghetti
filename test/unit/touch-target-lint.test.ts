import { describe, expect, it } from "vitest";
import { unpositionedTouchTargets } from "../../scripts/lib/touch-target.ts";

describe("design lint: touch-target needs a position", () => {
  it("passes a class string that positions the control", () => {
    expect(unpositionedTouchTargets(`<a className="focus-ring touch-target relative flex">`)).toEqual([]);
    expect(unpositionedTouchTargets(`<a className="touch-target absolute top-1 right-1">`)).toEqual([]);
  });

  it("flags one that doesn't, and a responsive position that leaves phones out", () => {
    expect(unpositionedTouchTargets(`<a className="focus-ring touch-target flex">`)).toEqual([1]);
    expect(unpositionedTouchTargets(`<a className="touch-target md:relative">`)).toEqual([1]);
    expect(unpositionedTouchTargets(`<a className="touch-target relative-ish">`)).toEqual([1]);
  });

  it("reads the whole cn() call", () => {
    const ok = `className={cn(\n  "touch-target flex",\n  big && "relative size-8",\n)}`;
    expect(unpositionedTouchTargets(ok)).toEqual([]);
    const bad = `className={cn(\n  "touch-target flex",\n  big && "size-8",\n)}\n<b className="relative">`;
    expect(unpositionedTouchTargets(bad)).toEqual([2]);
  });

  it("skips comments and ignored lines", () => {
    expect(unpositionedTouchTargets(`// a touch-target overlay\n* touch-target`)).toEqual([]);
    expect(
      unpositionedTouchTargets(`<a className="touch-target"> // design-lint-ignore: placed by its parent`),
    ).toEqual([]);
  });

  it("would have caught the build page's recipe link in PR 609's parent", () => {
    expect(unpositionedTouchTargets(`className="focus-ring touch-target rounded-xs font-semibold underline"`)).toEqual([
      1,
    ]);
  });
});
