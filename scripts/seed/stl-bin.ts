import { type Mesh, writeStl } from "../../src/shared/mesh.ts";

/** A rounded square's outline, counter-clockwise, `half` from the centre to a side, corners `radius` round. */
function outline(half: number, radius: number, steps = 6): [number, number][] {
  const points: [number, number][] = [];
  const corners: [number, number, number][] = [
    [1, 1, 0],
    [-1, 1, 90],
    [-1, -1, 180],
    [1, -1, 270],
  ];
  for (const [sx, sy, from] of corners) {
    for (let i = 0; i <= steps; i++) {
      const angle = ((from + (90 * i) / steps) * Math.PI) / 180;
      points.push([sx * (half - radius) + Math.cos(angle) * radius, sy * (half - radius) + Math.sin(angle) * radius]);
    }
  }
  return points;
}

/**
 * A small real model for the screenshots and tests: a gridfinity-style bin, one 42 mm cell wide, 25.2 mm tall, with a
 * chamfered foot, a hollow inside and rounded corners. A few hundred triangles, binary STL, in the printer's frame.
 */
export function gridfinityBin(): Buffer {
  const triangles: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => triangles.push(...a, ...b, ...c);
  const ring = (inset: number, z: number) => outline(20.75 - inset, 3.75 - inset * 0.6).map(([x, y]) => [x, y, z]);
  const quads = (lower: number[][], upper: number[][], outward: boolean) => {
    for (let i = 0; i < lower.length; i++) {
      const j = (i + 1) % lower.length;
      const [a, b, c, d] = [lower[i], lower[j], upper[j], upper[i]] as number[][] as [
        number[],
        number[],
        number[],
        number[],
      ];
      if (outward) {
        tri(a, b, c);
        tri(a, c, d);
      } else {
        tri(a, c, b);
        tri(a, d, c);
      }
    }
  };
  const fan = (points: number[][], up: boolean) => {
    const first = points[0] as number[];
    const z = first[2] as number;
    const centre = [0, 0, z];
    for (let i = 0; i < points.length; i++) {
      const a = points[i] as number[];
      const b = points[(i + 1) % points.length] as number[];
      if (up) tri(centre, a, b);
      else tri(centre, b, a);
    }
  };
  const foot = ring(2.6, 0);
  const shoulder = ring(0, 2.6);
  const top = ring(0, 25.2);
  const lip = ring(1.8, 25.2);
  const wall = ring(1.8, 4);
  quads(foot, shoulder, true);
  quads(shoulder, top, true);
  fan(foot, false);
  // The rim, then the inside wall down to the floor.
  for (let i = 0; i < top.length; i++) {
    const j = (i + 1) % top.length;
    const [o1, o2, i1, i2] = [top[i], top[j], lip[i], lip[j]] as [number[], number[], number[], number[]];
    tri(o1, o2, i2);
    tri(o1, i2, i1);
  }
  quads(wall, lip, false);
  fan(wall, true);
  const mesh: Mesh = { positions: new Float32Array(triangles) };
  return Buffer.from(writeStl(mesh, "gridfinity-bin"));
}
