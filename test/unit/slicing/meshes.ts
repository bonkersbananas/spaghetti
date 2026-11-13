/** Small meshes for the slicing tests: boxes as triangle soups (nine floats a triangle), in mm. */

/** An axis-aligned box from `min` to `max`, its 12 triangles counter-clockwise seen from outside. */
export function box(min: [number, number, number], max: [number, number, number]): Float32Array {
  const corner = (x: number, y: number, z: number) => [x ? max[0] : min[0], y ? max[1] : min[1], z ? max[2] : min[2]];
  const faces = [
    [corner(0, 0, 0), corner(0, 1, 0), corner(1, 1, 0)],
    [corner(0, 0, 0), corner(1, 1, 0), corner(1, 0, 0)],
    [corner(0, 0, 1), corner(1, 0, 1), corner(1, 1, 1)],
    [corner(0, 0, 1), corner(1, 1, 1), corner(0, 1, 1)],
    [corner(0, 0, 0), corner(1, 0, 0), corner(1, 0, 1)],
    [corner(0, 0, 0), corner(1, 0, 1), corner(0, 0, 1)],
    [corner(0, 1, 0), corner(0, 1, 1), corner(1, 1, 1)],
    [corner(0, 1, 0), corner(1, 1, 1), corner(1, 1, 0)],
    [corner(0, 0, 0), corner(0, 0, 1), corner(0, 1, 1)],
    [corner(0, 0, 0), corner(0, 1, 1), corner(0, 1, 0)],
    [corner(1, 0, 0), corner(1, 1, 0), corner(1, 1, 1)],
    [corner(1, 0, 0), corner(1, 1, 1), corner(1, 0, 1)],
  ];
  return Float32Array.from(faces.flat(2));
}
