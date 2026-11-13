/** A box as a binary STL: a model to slice, as small as a model gets (12 triangles). Sizes in mm. */
export function boxStl(width: number, depth = width, height = width): Uint8Array {
  const corners = (x: number, y: number, z: number) => [x * width, y * depth, z * height];
  // Two triangles a face, corners counter-clockwise seen from outside.
  const faces: number[][][] = [
    [corners(0, 0, 0), corners(0, 1, 0), corners(1, 1, 0)],
    [corners(0, 0, 0), corners(1, 1, 0), corners(1, 0, 0)],
    [corners(0, 0, 1), corners(1, 0, 1), corners(1, 1, 1)],
    [corners(0, 0, 1), corners(1, 1, 1), corners(0, 1, 1)],
    [corners(0, 0, 0), corners(1, 0, 0), corners(1, 0, 1)],
    [corners(0, 0, 0), corners(1, 0, 1), corners(0, 0, 1)],
    [corners(0, 1, 0), corners(0, 1, 1), corners(1, 1, 1)],
    [corners(0, 1, 0), corners(1, 1, 1), corners(1, 1, 0)],
    [corners(0, 0, 0), corners(0, 0, 1), corners(0, 1, 1)],
    [corners(0, 0, 0), corners(0, 1, 1), corners(0, 1, 0)],
    [corners(1, 0, 0), corners(1, 1, 0), corners(1, 1, 1)],
    [corners(1, 0, 0), corners(1, 1, 1), corners(1, 0, 1)],
  ] as number[][][];
  const out = new Uint8Array(84 + faces.length * 50);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("box"), 0);
  view.setUint32(80, faces.length, true);
  faces.forEach((face, index) => {
    const at = 84 + index * 50 + 12;
    face.flat().forEach((value, k) => view.setFloat32(at + k * 4, value, true));
  });
  return out;
}
