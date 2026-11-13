/**
 * Whether a model fits the printer, and how much smaller it must be to: "Scale to 80 % and slice". The scaling itself
 * is shared/mesh.ts's `scaleMesh`, mesh in and mesh out, the same function Twists adapts a model with.
 */
import type { Box } from "./arrange.ts";

/** Width, depth and height of a box, in mm. */
export const sizeOf = (box: Box): [number, number, number] => [
  box.max[0] - box.min[0],
  box.max[1] - box.min[1],
  box.max[2] - box.min[2],
];

/**
 * The largest uniform scale, in whole percent and at most 100, at which a model of `size` (mm, x y z) fits a volume
 * of `volume` with `margin` mm to spare on every side of the plate (and above). 0 when nothing would fit.
 */
export function fitPercent(size: [number, number, number], volume: [number, number, number], margin = 5): number {
  let factor = 1;
  for (let axis = 0; axis < 3; axis++) {
    const room = (volume[axis] as number) - (axis < 2 ? 2 * margin : margin);
    const length = size[axis] as number;
    if (length > 0) factor = Math.min(factor, room / length);
  }
  return Math.max(0, Math.min(100, Math.floor(factor * 100 + 1e-9)));
}

/** A triangle soup without the triangles that have a corner that isn't a number (a broken file's). */
export function finiteTriangles(positions: Float32Array): Float32Array {
  let kept = 0;
  const out = new Float32Array(positions.length);
  for (let t = 0; t + 8 < positions.length; t += 9) {
    let finite = true;
    for (let k = 0; k < 9; k++) if (!Number.isFinite(positions[t + k])) finite = false;
    if (!finite) continue;
    out.set(positions.subarray(t, t + 9), kept * 9);
    kept++;
  }
  return kept * 9 === positions.length ? positions : out.slice(0, kept * 9);
}
