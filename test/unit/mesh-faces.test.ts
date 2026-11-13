import { describe, expect, it } from "vitest";
import { boxesStl, boxStl, fusilliStl } from "../../e2e/fixtures/model-stl.ts";
import { boundsOf, centreOfMass, layMeshDown, type Mesh, parseStl, restingFaces } from "../../src/shared/mesh.ts";

const mesh = (bytes: Uint8Array): Mesh => {
  const parsed = parseStl(bytes);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.mesh;
};

/** A solid from its corners and outward-facing triangles (indices into the corners). */
function solid(corners: number[][], triangles: number[][]): Mesh {
  return { positions: Float32Array.from(triangles.flatMap((t) => t.flatMap((i) => corners[i] as number[]))) };
}

/** A right wedge: a 40 × 10 mm base under a slope that rises to 20 mm at the back, 30 mm wide. */
const wedge = solid(
  [
    [0, 0, 0],
    [40, 0, 0],
    [40, 30, 0],
    [0, 30, 0],
    [40, 0, 20],
    [40, 30, 20],
  ],
  [
    [0, 2, 1],
    [0, 3, 2], // bottom
    [1, 2, 5],
    [1, 5, 4], // back
    [0, 1, 4], // front triangle
    [3, 5, 2], // back triangle
    [0, 4, 5],
    [0, 5, 3], // slope
  ],
);

/** A box leaning over: its top is shifted 30 mm sideways, so it stands on only some of its faces. */
const leaning = solid(
  [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
    [0, 10, 0],
    [30, 0, 10],
    [40, 0, 10],
    [40, 10, 10],
    [30, 10, 10],
  ],
  [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [3, 6, 2],
    [3, 7, 6],
    [0, 4, 7],
    [0, 7, 3],
    [1, 2, 6],
    [1, 6, 5],
  ],
);

const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - (b[i] as number)) < 1e-3);

describe("restingFaces", () => {
  it("finds the six faces of a box, the big ones first", () => {
    const faces = restingFaces(mesh(boxStl(20, 30, 40)));
    expect(faces).toHaveLength(6);
    expect(faces[0]?.area).toBeCloseTo(1200);
    expect(faces.at(-1)?.area).toBeCloseTo(600);
    const normals = faces.map((face) => face.down.map(Math.abs));
    expect(normals.filter((n) => near(n, [0, 0, 1]))).toHaveLength(2);
  });

  it("finds the faces of a wedge that its centre of mass sits over", () => {
    const faces = restingFaces(wedge);
    // Bottom, back, slope and its two triangular sides all balance.
    expect(faces.length).toBeGreaterThanOrEqual(3);
    expect(faces.some((face) => near(face.down, [0, 0, -1]))).toBe(true);
    expect(faces.some((face) => near(face.down, [1, 0, 0]))).toBe(true);
    const slope = Math.hypot(40, 20);
    expect(faces.some((face) => near(face.down, [-20 / slope, 0, 40 / slope]))).toBe(true);
  });

  it("leaves out faces it would tip over from", () => {
    const faces = restingFaces(leaning);
    // Its footprint (x 0–10) is nowhere near its centre of mass (x 20): it would tip off its bottom and its top.
    expect(faces.some((face) => near(face.down, [0, 0, -1]))).toBe(false);
    expect(faces.some((face) => near(face.down, [0, 0, 1]))).toBe(false);
    // The leaning sides and the two parallelogram faces hold it.
    expect(faces).toHaveLength(4);
  });

  it("leaves out a hull face across a hollow that the model only touches at its edges", () => {
    // An L: the hull has a slanted face from the foot's tip to the wall's top, over nothing.
    const l = mesh(
      boxesStl([
        { at: [0, 0, 0], size: [60, 30, 6] },
        { at: [0, 0, 6], size: [6, 30, 40] },
      ]),
    );
    const faces = restingFaces(l);
    expect(faces.length).toBeGreaterThanOrEqual(2);
    expect(faces.some((face) => near(face.down, [0, 0, -1]))).toBe(true);
    expect(faces.some((face) => face.down[0] > 0.3 && face.down[2] > 0.3)).toBe(false);
    // Its underside is what it rests on there: the whole 60 × 30 foot.
    expect(faces.find((face) => near(face.down, [0, 0, -1]))?.area).toBeCloseTo(1800);
  });

  it("finds the two ends of a twisted pasta, and not its rounded sides", () => {
    const faces = restingFaces(mesh(fusilliStl()));
    expect(faces).toHaveLength(2);
    expect(faces.map((face) => Math.abs(face.down[2]))).toEqual([1, 1].map((v) => expect.closeTo(v, 2)));
  });

  it("finds the hull of a smooth, finely meshed model quickly, and no flat face on it", () => {
    const rings = 80;
    const around = 120;
    const at = (i: number, j: number) => {
      const theta = (Math.PI * i) / rings;
      const phi = (2 * Math.PI * j) / around;
      return [30 * Math.sin(theta) * Math.cos(phi), 30 * Math.sin(theta) * Math.sin(phi), 30 * Math.cos(theta)];
    };
    const out: number[] = [];
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < around; j++) {
        out.push(...at(i, j), ...at(i + 1, j), ...at(i + 1, j + 1), ...at(i, j), ...at(i + 1, j + 1), ...at(i, j + 1));
      }
    }
    const started = Date.now();
    expect(restingFaces({ positions: Float32Array.from(out) })).toEqual([]);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("finds none in a mesh without volume", () => {
    expect(restingFaces({ positions: new Float32Array(0) })).toEqual([]);
    expect(restingFaces({ positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]) })).toEqual([]);
  });
});

describe("layMeshDown", () => {
  it("turns a face to the plate and sets the model on it", () => {
    const box = mesh(boxStl(20, 30, 40));
    for (const down of [
      [1, 0, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as Array<[number, number, number]>) {
      const turned = layMeshDown(box, down);
      const size = boundsOf(turned).size;
      expect(boundsOf(turned).min[2]).toBeCloseTo(0);
      const flat = down.findIndex((v) => v !== 0);
      // The side that pointed down is now the height's other two: the box's own height lies along another axis.
      expect(size[2]).toBeCloseTo([20, 30, 40][flat] as number);
    }
  });

  it("lays a slope flat, with the slope's face on the plate", () => {
    const slope = Math.hypot(40, 20);
    const turned = layMeshDown(wedge, [-20 / slope, 0, 40 / slope]);
    expect(boundsOf(turned).min[2]).toBeCloseTo(0);
    // The slope is 30 mm wide and 44.7 long: it covers the plate there, so the lowest points are many.
    const p = turned.positions;
    let onPlate = 0;
    for (let i = 2; i < p.length; i += 3) if (Math.abs(p[i] as number) < 1e-3) onPlate++;
    expect(onPlate).toBeGreaterThanOrEqual(4);
  });

  it("keeps the centre of mass the same distance from the plate whatever the turn", () => {
    const box = mesh(boxStl(20, 30, 40));
    expect(centreOfMass(layMeshDown(box, [1, 0, 0]))[2]).toBeCloseTo(10);
    expect(centreOfMass(layMeshDown(box, [0, 0, 1]))[2]).toBeCloseTo(20);
  });
});
