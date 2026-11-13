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

/**
 * A fusilli as a binary STL: a three-lobed section that twists as it rises, standing on the bed. A model with some
 * shape to it (about 23 000 triangles), for the screenshots and the 3D view. Sizes in mm.
 */
export function fusilliStl({ radius = 14, height = 60, turns = 1.25, around = 96, rings = 120 } = {}): Uint8Array {
  const point = (ring: number, step: number): [number, number, number] => {
    const theta = (step / around) * 2 * Math.PI;
    const twist = (ring / rings) * turns * 2 * Math.PI;
    const r = radius * (0.62 + 0.38 * Math.cos(3 * theta));
    return [Math.cos(theta + twist) * r, Math.sin(theta + twist) * r, (ring / rings) * height];
  };
  const triangles: [number, number, number][][] = [];
  for (let ring = 0; ring < rings; ring++) {
    for (let step = 0; step < around; step++) {
      const a = point(ring, step);
      const b = point(ring, step + 1);
      const c = point(ring + 1, step + 1);
      const d = point(ring + 1, step);
      triangles.push([a, b, c], [a, c, d]);
    }
  }
  // The section is star-shaped round its centre, so a fan closes each end.
  for (let step = 0; step < around; step++) {
    triangles.push([[0, 0, 0], point(0, step + 1), point(0, step)]);
    triangles.push([[0, 0, height], point(rings, step), point(rings, step + 1)]);
  }
  const out = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("fusilli"), 0);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, index) => {
    const at = 84 + index * 50 + 12;
    triangle.flat().forEach((value, k) => view.setFloat32(at + k * 4, value, true));
  });
  return out;
}
