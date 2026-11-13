/**
 * Changes to a model's mesh before it is sliced: pure functions, mesh in and mesh out (a triangle soup of nine
 * floats a triangle, in mm), so slicing and Twists ("fit to 120 mm") share them. Nothing here changes its input.
 */
import { type Box, boundsOf } from "./arrange.ts";

/** A copy of `positions` scaled by `factor` (1 is as is) about the mesh's centre on the plate: it stays where it stands. */
export function scaleMesh(positions: Float32Array, factor: number): Float32Array {
  const out = new Float32Array(positions.length);
  if (!positions.length) return out;
  const box = boundsOf(positions);
  const cx = (box.min[0] + box.max[0]) / 2;
  const cy = (box.min[1] + box.max[1]) / 2;
  const bottom = box.min[2];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    out[i] = cx + ((positions[i] as number) - cx) * factor;
    out[i + 1] = cy + ((positions[i + 1] as number) - cy) * factor;
    out[i + 2] = bottom + ((positions[i + 2] as number) - bottom) * factor;
  }
  return out;
}

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

/** A copy scaled so its longest side is `millimetres` long (Twists' "fit to 120 mm"), larger or smaller. */
export function fitToLength(positions: Float32Array, millimetres: number): Float32Array {
  const longest = Math.max(...sizeOf(boundsOf(positions)));
  if (!(longest > 0) || !(millimetres > 0)) return positions.slice();
  return scaleMesh(positions, millimetres / longest);
}
