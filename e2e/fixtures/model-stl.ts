type Vec = [number, number, number];

/** A box's twelve triangles, two a face, corners counter-clockwise seen from outside. Sizes in mm. */
function boxFaces([x0, y0, z0]: Vec, [width, depth, height]: Vec): number[][][] {
  const corners = (x: number, y: number, z: number) => [x0 + x * width, y0 + y * depth, z0 + z * height];
  return [
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
}

/** Triangles as a binary STL. */
function binaryStl(faces: number[][][], header: string): Uint8Array {
  const out = new Uint8Array(84 + faces.length * 50);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(header), 0);
  view.setUint32(80, faces.length, true);
  for (const [index, face] of faces.entries()) {
    const at = 84 + index * 50 + 12;
    for (const [k, value] of face.flat().entries()) view.setFloat32(at + k * 4, value, true);
  }
  return out;
}

/** A box as a binary STL: a model to slice, as small as a model gets (12 triangles). Sizes in mm. */
export function boxStl(width: number, depth = width, height = width): Uint8Array {
  return binaryStl(boxFaces([0, 0, 0], [width, depth, height]), "box");
}

/**
 * Boxes in one binary STL, each where it is (mm): one mesh, so a box that starts above the others floats in the air
 * once the lowest stands on the bed, and the slicer asks for supports.
 */
export function boxesStl(boxes: Array<{ at: Vec; size: Vec }>): Uint8Array {
  return binaryStl(
    boxes.flatMap((box) => boxFaces(box.at, box.size)),
    "boxes",
  );
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
  for (const [index, triangle] of triangles.entries()) {
    const at = 84 + index * 50 + 12;
    for (const [k, value] of triangle.flat().entries()) view.setFloat32(at + k * 4, value, true);
  }
  return out;
}
