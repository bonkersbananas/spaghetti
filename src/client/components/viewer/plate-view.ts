// The 3D view's orbit limit and how the plate looks from above and below. Pure, so tests can reach it.

/** How far the orbit may go: nearly straight under the plate (not quite, where the camera's up flips). */
export const MAX_POLAR = Math.PI - 0.05;

/** Where the plate is fully see-through: a hair above its top (as a share of the camera's distance), so a grazing
 * look along the plate never shows its solid edge or underside in front of the print. */
export const SEE_THROUGH_AT = 0.01;
/** Where the plate is solid again: about 4° above it. The fade between follows the tilt, so it never flickers. */
export const SOLID_AT = 0.07;

/**
 * How solid the plate is for a camera at `height` above its top, `distance` from the target: 1 from above, 0 from
 * level with it and below, easing over the last few degrees above it, where the plate is only a sliver.
 */
export function plateSolidity(height: number, distance: number, reducedMotion = false): number {
  const rise = height / Math.max(1, distance);
  // With reduced motion there is no easing: the plate switches a hair above its own level.
  if (reducedMotion) return rise > SEE_THROUGH_AT ? 1 : 0;
  const t = Math.min(1, Math.max(0, (rise - SEE_THROUGH_AT) / (SOLID_AT - SEE_THROUGH_AT)));
  return t * t * (3 - 2 * t);
}

/** What the plate shows, for tests: solid, fading, or see-through. */
export function plateLook(solidity: number): "solid" | "fading" | "see-through" {
  return solidity >= 0.99 ? "solid" : solidity <= 0.01 ? "see-through" : "fading";
}

/** Opacity of the plate's see-through grid: the other way round, and quiet. */
export function gridOpacity(solidity: number): number {
  return (1 - solidity) * 0.85;
}

/** The grid's lines: the plate's outline is heavier than the lines across it. Widths in CSS pixels. */
export const GRID_OUTLINE_PX = 2.2;
export const GRID_LINE_PX = 1.1;
/** Mm between the lines across the plate. */
export const GRID_STEP = 32;
