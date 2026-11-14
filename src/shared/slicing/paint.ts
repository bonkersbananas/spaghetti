/**
 * Painted colours of a Bambu Studio or OrcaSlicer project. Each painted triangle of a mesh carries a code
 * (`paint_color` in its 3MF) that Orca's TriangleSelector writes: the triangle split into smaller ones, each in a
 * state, the filament it prints in (1 the first; 0 unpainted, the object's own). A code is hex digits read from the
 * last one: each node of a triangle's split tree is a digit, its two low bits how many sides it splits (0: a leaf)
 * and its two high bits the leaf's state, or the corner a split starts from. A leaf's state of 3 and up takes one
 * more digit (state − 3), or F and one more (state − 18). A split node's children follow, depth first, the last one
 * first. OrcaSlicer's engine takes an object's codes as they are (`paint.filaments`).
 */

/** An object's painted triangles: each one's index (ascending), and its code, the codes one after another. */
export interface ModelPaint {
  triangles: Uint32Array;
  codes: string;
  /** Where each triangle's code ends in `codes`. */
  ends: Uint32Array;
}

type Vec = [number, number, number];

/** The highest state the engine takes for filament paint: Orca's 32 filaments. */
export const MAX_PAINT_STATE = 32;

function digit(c: number): number {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  return -1;
}

/**
 * The states a code paints with (2^n for state n, summed), or null where it isn't a code OrcaSlicer's engine takes:
 * digits other than 0-9 and A-F, a split from a corner past the third, a tree that ends early or text after it,
 * a state past 32. Orca itself drops such a triangle's paint.
 */
export function paintCodeStates(codes: string, from = 0, to = codes.length): number | null {
  let pos = to;
  let open = 1;
  let states = 0;
  const next = () => (pos > from ? digit(codes.charCodeAt(--pos)) : -1);
  while (open > 0) {
    const head = next();
    if (head < 0) return null;
    open--;
    const split = head & 3;
    const x = head >> 2;
    if (split !== 0) {
      if (x > 2) return null;
      open += split + 1;
      continue;
    }
    let state = x;
    if (x === 3) {
      const e = next();
      if (e < 0) return null;
      if (e < 15) state = e + 3;
      else {
        const f = next();
        if (f < 0) return null;
        state = f + 18;
      }
    }
    if (state > MAX_PAINT_STATE) return null;
    // Sums, not `|`: JavaScript's bitwise operators stop at 31 bits.
    if (!hasState(states, state)) states += 2 ** state;
  }
  return pos === from ? states : null;
}

/** Whether `states` (from `paintCodeStates`) holds `state`. */
export function hasState(states: number, state: number): boolean {
  return Math.floor(states / 2 ** state) % 2 === 1;
}

/**
 * Each leaf of a painted triangle, its corners and state, as Orca's TriangleSelector splits the triangle `corners`
 * by its code (`deserialize`, `perform_split`): a split of one side halves the side opposite the corner it starts
 * from, of two sides the two sides at that corner, of three every side. False where the code isn't one.
 */
export function paintLeaves(
  codes: string,
  from: number,
  to: number,
  corners: [Vec, Vec, Vec],
  leaf: (a: Vec, b: Vec, c: Vec, state: number) => void,
): boolean {
  let pos = to;
  const next = () => (pos > from ? digit(codes.charCodeAt(--pos)) : -1);
  // Depth first: the next triangle to read is the last one pushed, a split's last child first.
  const pending: [Vec, Vec, Vec][] = [corners];
  while (pending.length) {
    const [a, b, c] = pending.pop() as [Vec, Vec, Vec];
    const head = next();
    if (head < 0) return false;
    const split = head & 3;
    const x = head >> 2;
    if (split === 0) {
      let state = x;
      if (x === 3) {
        const e = next();
        if (e < 0) return false;
        if (e < 15) state = e + 3;
        else {
          const f = next();
          if (f < 0) return false;
          state = f + 18;
        }
      }
      leaf(a, b, c, state);
      continue;
    }
    if (split !== 3 && x > 2) return false;
    // The corners from the one the split starts from (always the first for three sides).
    const start = split === 3 ? 0 : x;
    const turned = [a, b, c];
    const v0 = turned[start] as Vec;
    const v1 = turned[(start + 1) % 3] as Vec;
    const v2 = turned[(start + 2) % 3] as Vec;
    const children: [Vec, Vec, Vec][] = [];
    if (split === 1) {
      const m12 = mid(v2, v1);
      children.push([v0, v1, m12], [m12, v2, v0]);
    } else if (split === 2) {
      const m01 = mid(v1, v0);
      const m02 = mid(v0, v2);
      children.push([v0, m01, m02], [m01, v1, m02], [v1, v2, m02]);
    } else {
      const m01 = mid(v1, v0);
      const m12 = mid(v2, v1);
      const m02 = mid(v0, v2);
      children.push([v0, m01, m02], [m01, v1, m12], [m12, v2, m02], [m01, m12, m02]);
    }
    // Pushed in order, so the last child is read first, as Orca reads them.
    pending.push(...children);
  }
  return pos === from;
}

function mid(a: Vec, b: Vec): Vec {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

/**
 * `paint` with only the triangles painted in a filament up to `filaments`, and the highest one they use; null when
 * none is. A state past them prints as the object's own, as Orca prints it with fewer filaments than that.
 */
export function paintWithin(paint: ModelPaint, filaments: number): { paint: ModelPaint; highest: number } | null {
  const triangles: number[] = [];
  const ends: number[] = [];
  let codes = "";
  let highest = 0;
  let from = 0;
  for (const [index, triangle] of paint.triangles.entries()) {
    const to = paint.ends[index] as number;
    const states = paintCodeStates(paint.codes, from, to);
    let top = 0;
    if (states !== null) for (let state = 1; state <= filaments; state++) if (hasState(states, state)) top = state;
    if (top > 0) {
      triangles.push(triangle);
      codes += paint.codes.slice(from, to);
      ends.push(codes.length);
      highest = Math.max(highest, top);
    }
    from = to;
  }
  if (!triangles.length) return null;
  return { paint: { triangles: Uint32Array.from(triangles), codes, ends: Uint32Array.from(ends) }, highest };
}

/**
 * The paint of an object's triangles `from` to `to` (past the last), each by its place among them: a part's, which
 * our own slicer takes part by part. Null when none of them is painted.
 */
export function paintBetween(paint: ModelPaint, from: number, to: number): ModelPaint | null {
  const triangles: number[] = [];
  const ends: number[] = [];
  let codes = "";
  let start = 0;
  for (const [index, triangle] of paint.triangles.entries()) {
    const end = paint.ends[index] as number;
    if (triangle >= from && triangle < to) {
      triangles.push(triangle - from);
      codes += paint.codes.slice(start, end);
      ends.push(codes.length);
    }
    start = end;
  }
  if (!triangles.length) return null;
  return { triangles: Uint32Array.from(triangles), codes, ends: Uint32Array.from(ends) };
}

/**
 * Paint as our own slicer's module takes it (`paint`, slicer-rs's `Paint::from_bytes`): the number of painted
 * triangles n, the n triangles, the n ends of their codes (each a little-endian u32), then the codes, in ASCII.
 */
export function paintBytes(paint: ModelPaint): Uint8Array {
  const n = paint.triangles.length;
  const at = 4 + n * 8;
  const bytes = new Uint8Array(at + paint.codes.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, n, true);
  for (let k = 0; k < n; k++) {
    view.setUint32(4 + k * 4, paint.triangles[k] as number, true);
    view.setUint32(4 + (n + k) * 4, paint.ends[k] as number, true);
  }
  // The codes are hex digits, one byte each.
  for (let k = 0; k < paint.codes.length; k++) bytes[at + k] = paint.codes.charCodeAt(k);
  return bytes;
}
