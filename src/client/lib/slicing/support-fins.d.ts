/** The part of Support Fins' plugin entry (vendor/support-fins) that Spaghetti calls. */
declare module "@support-fins/plugins/shared/engine/fins_entry.js" {
  export function computeFins(
    positions: Float32Array,
    options?: Record<string, unknown>,
  ): {
    /** Nine numbers a triangle: the fins, the sway braces, then the bed pad, in the seated frame. */
    triangles: Float32Array;
    /** seated = input + offset. */
    offset: { x: number; y: number; z: number };
    stats: Record<string, number>;
  };
}
