/**
 * Fins: breakaway walls built into the model (Support Fins, vendor/support-fins, decision 0052). The engine is
 * plain mesh math: it takes a part's triangles as they sit on the plate and returns the fin triangles to add under
 * it, which the slicer prints with the part (it unions the overlapping closed solids). Loaded here with a dynamic
 * import, so it is its own chunk of the slice worker and nobody downloads it before a model is sliced with Fins.
 */

/** The model's triangles with its fins (and a pad, where it barely touches the plate) appended. */
export async function withFins(
  positions: Float32Array,
  options: { layerHeight: number; nozzle: number },
): Promise<{ positions: Float32Array; added: number }> {
  const { computeFins } = await import("@support-fins/plugins/shared/engine/fins_entry.js");
  const { triangles, offset } = computeFins(positions, { layerHeight: options.layerHeight, nozzle: options.nozzle });
  const joined = new Float32Array(positions.length + triangles.length);
  joined.set(positions, 0);
  // The fins come in the engine's seated frame (seated = part + offset): back to where the part is.
  const shift = [offset.x, offset.y, offset.z];
  for (let i = 0; i < triangles.length; i++) {
    joined[positions.length + i] = (triangles[i] as number) - (shift[i % 3] as number);
  }
  return { positions: joined, added: triangles.length / 9 };
}
