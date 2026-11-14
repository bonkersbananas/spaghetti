// The 3D view's orbit limit and how the plate looks from above and below. Pure, so tests can reach it.

/** How far the orbit may go: nearly straight under the plate (not quite, where the camera's up flips). */
export const MAX_POLAR = Math.PI - 0.05;

/**
 * How solid the plate is for a camera at `height` above its plane, `distance` from the target: 1 from above, 0 from
 * below, easing through the horizon with no jump at the plate's level.
 */
export function plateSolidity(height: number, distance: number): number {
  const t = Math.min(1, Math.max(0, (height / Math.max(1, distance) + 0.12) / 0.2));
  return t * t * (3 - 2 * t);
}

/** Opacity of the plate's see-through grid: the other way round, and quiet. */
export function gridOpacity(solidity: number): number {
  return (1 - solidity) * 0.55;
}
