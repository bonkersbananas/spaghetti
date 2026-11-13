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

/** A binary STL of a triangle soup, with `extra` stray bytes after the last triangle. */
export function binaryStl(positions: Float32Array, header = "binary", extra = 0): Uint8Array {
  const count = positions.length / 9;
  const out = new Uint8Array(84 + count * 50 + extra);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(header), 0);
  view.setUint32(80, count, true);
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 9; k++) view.setFloat32(84 + t * 50 + 12 + k * 4, positions[t * 9 + k] as number, true);
  }
  return out;
}

/** An ASCII STL of a triangle soup. */
export function asciiStl(positions: Float32Array, name = "part"): Uint8Array {
  const lines = [`solid ${name}`];
  for (let t = 0; t < positions.length; t += 9) {
    lines.push("  facet normal 0 0 0", "    outer loop");
    for (let v = 0; v < 9; v += 3) {
      lines.push(`      vertex ${positions[t + v]} ${positions[t + v + 1]} ${positions[t + v + 2]}`);
    }
    lines.push("    endloop", "  endfacet");
  }
  lines.push(`endsolid ${name}`, "");
  return new TextEncoder().encode(lines.join("\n"));
}
