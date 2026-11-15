import { describe, expect, it } from "vitest";
import {
  hasState,
  paintBetween,
  paintBytes,
  paintCode,
  paintCodeStates,
  paintLeaves,
  paintParts,
  paintUnpaintedAs,
  paintWithin,
} from "../../../src/shared/slicing/paint.ts";

type Vec = [number, number, number];
const A: Vec = [0, 0, 0];
const B: Vec = [8, 0, 0];
const C: Vec = [0, 8, 0];
const mid = (p: Vec, q: Vec): Vec => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];

/** A code's leaves, corners and state, in the order they are read. */
function leaves(code: string, corners: [Vec, Vec, Vec] = [A, B, C]) {
  const out: { corners: Vec[]; state: number }[] = [];
  const ok = paintLeaves(code, 0, code.length, corners, (a, b, c, state) => out.push({ corners: [a, b, c], state }));
  return ok ? out : null;
}

const states = (code: string) => {
  const mask = paintCodeStates(code);
  return mask === null ? null : Array.from({ length: 34 }, (_, n) => n).filter((n) => hasState(mask, n));
};

describe("paint codes", () => {
  it("reads a leaf's state, in one digit up to 2, two up to 17 and three up to 32", () => {
    expect(states("0")).toEqual([0]);
    expect(states("4")).toEqual([1]);
    expect(states("8")).toEqual([2]);
    // Read from the last digit: C (a leaf of state 3 and up), then the state less 3.
    expect(states("0C")).toEqual([3]);
    expect(states("EC")).toEqual([17]);
    // F after C: one digit more, the state less 18.
    expect(states("0FC")).toEqual([18]);
    expect(states("EFC")).toEqual([32]);
  });

  it("refuses what OrcaSlicer's engine refuses", () => {
    // Past 32 filaments, a digit that isn't one, a tree that ends early, text after it, a split from a fourth corner.
    for (const code of ["FFC", "8g", "81", "48", "08D", ""]) expect(paintCodeStates(code)).toBeNull();
  });

  it("splits one side, opposite the corner it starts from, the second child read first", () => {
    // 1: a split of one side from corner 0; then the children's codes, the last child's first (8: state 2).
    expect(leaves("081")).toEqual([
      { corners: [mid(B, C), C, A], state: 2 },
      { corners: [A, B, mid(B, C)], state: 0 },
    ]);
    // 5: from corner 1, so B, C, A, halving C to A.
    expect(leaves("485")).toEqual([
      { corners: [mid(A, C), A, B], state: 2 },
      { corners: [B, C, mid(A, C)], state: 1 },
    ]);
  });

  it("splits two sides at the corner it starts from, and three into four", () => {
    expect(leaves("4082")).toEqual([
      { corners: [B, C, mid(A, C)], state: 2 },
      { corners: [mid(A, B), B, mid(A, C)], state: 0 },
      { corners: [A, mid(A, B), mid(A, C)], state: 1 },
    ]);
    expect(leaves("40883")?.map((leaf) => leaf.state)).toEqual([2, 2, 0, 1]);
    expect(leaves("40883")?.[0]?.corners).toEqual([mid(A, B), mid(B, C), mid(A, C)]);
  });

  it("reads a split inside a split depth first, and its leaves cover the triangle", () => {
    // Read from the end: three sides (3); the last child (the middle one) split in two (1), its own children's
    // states 2 and 1 (8, 4); then the other children's, the last first (0, 8, 4).
    const read = leaves("4804813");
    expect(read?.map((leaf) => leaf.state)).toEqual([2, 1, 0, 2, 1]);
    expect(paintCodeStates("4804813")).not.toBeNull();
    const area = (corners: Vec[]) => {
      const [p, q, r] = corners as [Vec, Vec, Vec];
      return Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2;
    };
    expect(read?.reduce((sum, leaf) => sum + area(leaf.corners), 0)).toBe(area([A, B, C]));
  });

  it("keeps the triangles painted in the filaments there are, and the highest", () => {
    const paint = {
      triangles: Uint32Array.from([2, 5, 9]),
      codes: `8${"0C"}4`,
      ends: Uint32Array.from([1, 3, 4]),
    };
    // With two filaments, state 3 is past them: its triangle prints as the object's own.
    const two = paintWithin(paint, 2);
    expect([...(two?.paint.triangles ?? [])]).toEqual([2, 9]);
    expect(two?.paint.codes).toBe("84");
    expect([...(two?.paint.ends ?? [])]).toEqual([1, 2]);
    expect(two?.highest).toBe(2);
    expect(paintWithin(paint, 4)?.highest).toBe(3);
    expect(paintWithin({ triangles: Uint32Array.from([0]), codes: "0C", ends: Uint32Array.from([2]) }, 2)).toBeNull();
  });

  it("gives a part the paint of its triangles, each by its place in the part", () => {
    const paint = {
      triangles: Uint32Array.from([1, 4, 5, 8]),
      codes: `8${"0C"}48`,
      ends: Uint32Array.from([1, 3, 4, 5]),
    };
    const part = paintBetween(paint, 4, 8);
    expect([...(part?.triangles ?? [])]).toEqual([0, 1]);
    expect(part?.codes).toBe("0C4");
    expect([...(part?.ends ?? [])]).toEqual([2, 3]);
    expect(paintBetween(paint, 2, 4)).toBeNull();
  });

  it("writes paint as our own slicer's module reads it", () => {
    const bytes = paintBytes({ triangles: Uint32Array.from([3, 260]), codes: "80C", ends: Uint32Array.from([1, 3]) });
    const view = new DataView(bytes.buffer);
    expect(bytes).toHaveLength(4 + 2 * 8 + 3);
    expect([0, 4, 8, 12, 16].map((at) => view.getUint32(at, true))).toEqual([2, 3, 260, 1, 3]);
    expect(new TextDecoder().decode(bytes.subarray(20))).toBe("80C");
  });
});

describe("an object's parts as paint, for OrcaSlicer's engine", () => {
  it("writes a whole triangle in a filament as Orca does", () => {
    expect([1, 2, 3, 17, 18, 32].map(paintCode)).toEqual(["4", "8", "0C", "EC", "0FC", "EFC"]);
    for (const state of [0, 1, 2, 3, 9, 17, 18, 25, 32]) expect(states(paintCode(state))).toEqual([state]);
  });

  it("paints a painted triangle's unpainted leaves in the part's filament, and keeps its painted ones", () => {
    // Split in two from corner 0: one half in filament 2, the other unpainted, now in filament 3 (read: 1, 8, C 0).
    expect(paintUnpaintedAs("081", 3)).toBe("0C81");
    expect(leaves("0C81")?.map((leaf) => leaf.state)).toEqual([2, 3]);
    expect(leaves("0C81")?.map((leaf) => leaf.corners)).toEqual(leaves("081")?.map((leaf) => leaf.corners));
    expect(paintUnpaintedAs("081", 1)).toBe("481");
    expect(paintUnpaintedAs("40883", 18)).toBe("40FC883");
    expect(states("40FC883")).toEqual([1, 2, 18]);
    // A leaf of state 3 keeps its second digit (a 0 that is no leaf), and a code that isn't one stays as it is.
    expect(paintUnpaintedAs("0C81", 1)).toBe("0C81");
    expect(paintUnpaintedAs("8g", 2)).toBe("8g");
    expect(paintUnpaintedAs("081", 0)).toBe("081");
  });

  it("paints the parts in other filaments than the object's, over the paint it has", () => {
    // Ten triangles: 0-3 in the object's filament 1, 4-6 in filament 2, 7-9 in filament 3. Painted: triangle 2 in
    // filament 2, triangle 5 half in filament 2, triangle 8 in filament 3.
    const paint = { triangles: Uint32Array.from([2, 5, 8]), codes: `8081${"0C"}`, ends: Uint32Array.from([1, 4, 6]) };
    const parts = [
      { from: 7, to: 10, extruder: 3 },
      { from: 0, to: 4, extruder: 1 },
      { from: 4, to: 7, extruder: 2 },
    ];
    const painted = paintParts(paint, parts, 1);
    expect([...(painted?.triangles ?? [])]).toEqual([2, 4, 5, 6, 7, 8, 9]);
    const codes = [...(painted?.ends ?? [])].map((end, k, ends) => painted?.codes.slice(ends[k - 1] ?? 0, end));
    expect(codes).toEqual(["8", "8", "881", "8", "0C", "0C", "0C"]);
    for (const code of codes) expect(paintCodeStates(code ?? "")).not.toBeNull();
    // Without paint of its own (a model whose colours were matched to filaments): its parts' triangles, whole.
    expect(paintParts(undefined, parts, 1)?.codes).toBe(`888${"0C0C0C"}`);
    // Triangles past the parts (fins, in the object's filament) keep only their own paint.
    const fins = paintParts({ triangles: Uint32Array.from([11]), codes: "8", ends: Uint32Array.from([1]) }, parts, 1);
    expect([...(fins?.triangles ?? [])]).toEqual([4, 5, 6, 7, 8, 9, 11]);
    expect(paintParts(undefined, [{ from: 0, to: 4, extruder: 1 }], 1)).toBeNull();
  });
});
