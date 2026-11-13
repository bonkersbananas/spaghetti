import { describe, expect, it } from "vitest";
import {
  adaptMesh,
  boundsOf,
  describeAdaptation,
  fitScale,
  isUnchanged,
  type Mesh,
  mirrorMesh,
  parseStl,
  rotateMesh,
  scaleMesh,
  triangleCount,
  writeStl,
} from "../../src/shared/mesh.ts";

/** A tetrahedron with a corner at the origin: 4 triangles, 10 × 20 × 30 mm. */
const tetra: Mesh = (() => {
  const o = [0, 0, 0];
  const x = [10, 0, 0];
  const y = [0, 20, 0];
  const z = [0, 0, 30];
  // Outward-facing winding.
  return { positions: Float32Array.from([...o, ...y, ...x, ...o, ...x, ...z, ...o, ...z, ...y, ...x, ...y, ...z]) };
})();

/** Six times the signed volume: positive when the triangles face outwards. */
function volume(mesh: Mesh) {
  let total = 0;
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from(p.slice(i, i + 9));
    total += (ax as number) * ((by as number) * (cz as number) - (bz as number) * (cy as number));
    total -= (ay as number) * ((bx as number) * (cz as number) - (bz as number) * (cx as number));
    total += (az as number) * ((bx as number) * (cy as number) - (by as number) * (cx as number));
  }
  return total;
}

describe("STL files", () => {
  it("reads back what it writes, as binary", () => {
    const parsed = parseStl(writeStl(tetra));
    expect(parsed.ok && parsed.format).toBe("binary");
    expect(parsed.ok && Array.from(parsed.mesh.positions)).toEqual(Array.from(tetra.positions));
  });

  it("reads an ASCII STL", () => {
    const text = `solid t
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1.5 0 0
  vertex 0 2e0 0
 endloop
endfacet
endsolid t`;
    const parsed = parseStl(new TextEncoder().encode(text));
    expect(parsed.ok && parsed.format).toBe("ascii");
    expect(parsed.ok && Array.from(parsed.mesh.positions)).toEqual([0, 0, 0, 1.5, 0, 0, 0, 2, 0]);
  });

  it("takes a binary file whose header starts with 'solid' for binary", () => {
    const bytes = writeStl(tetra, "solid from a slicer");
    expect(parseStl(bytes).ok && (parseStl(bytes) as { format: string }).format).toBe("binary");
  });

  it("takes a binary file with a few stray bytes after its last triangle, but not a file that only claims to be one", () => {
    const written = writeStl({ positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]) });
    const padded = new Uint8Array(written.length + 3);
    padded.set(written);
    const read = parseStl(padded);
    expect(read.ok && [...read.mesh.positions]).toEqual([0, 0, 0, 10, 0, 0, 0, 10, 0]);
    const photo = new Uint8Array(4096);
    new DataView(photo.buffer).setUint32(80, 12, true);
    expect(parseStl(photo).ok).toBe(false);
  });

  it("says why a file isn't an STL, without throwing", () => {
    expect(parseStl(new TextEncoder().encode("hello, this is not a model at all")).ok).toBe(false);
    expect(parseStl(new Uint8Array(4)).ok).toBe(false);
    expect(parseStl(new TextEncoder().encode("solid empty\nendsolid empty")).ok).toBe(false);
  });
});

describe("adapting a mesh", () => {
  it("measures it", () => {
    expect(boundsOf(tetra).size).toEqual([10, 20, 30]);
    expect(triangleCount(tetra)).toBe(4);
  });

  it("scales, and finds the scale that fits N mm", () => {
    expect(boundsOf(scaleMesh(tetra, 0.5)).size).toEqual([5, 10, 15]);
    expect(boundsOf(scaleMesh(tetra, [1, 2, 3])).size).toEqual([10, 40, 90]);
    expect(fitScale(tetra, 42, "longest")).toBeCloseTo(1.4);
    expect(fitScale(tetra, 42, "x")).toBeCloseTo(4.2);
    expect(fitScale(tetra, 0)).toBeNull();
    expect(fitScale({ positions: new Float32Array(0) }, 10)).toBeNull();
  });

  it("mirrors without turning the model inside out", () => {
    expect(volume(tetra)).toBeGreaterThan(0);
    const mirrored = mirrorMesh(tetra, "x");
    expect(boundsOf(mirrored).min[0]).toBe(-10);
    expect(boundsOf(mirrored).size).toEqual([10, 20, 30]);
    expect(volume(mirrored)).toBeCloseTo(volume(tetra));
  });

  it("turns by exact quarter turns, and by any angle", () => {
    const turned = rotateMesh(tetra, "z", 90);
    expect(boundsOf(turned).size).toEqual([20, 10, 30]);
    expect(Array.from(turned.positions).every((n) => Number.isInteger(n) || Object.is(n, -0))).toBe(true);
    expect(boundsOf(rotateMesh(tetra, "x", 90)).size).toEqual([10, 30, 20]);
    expect(boundsOf(rotateMesh(tetra, "y", -90)).size).toEqual([30, 20, 10]);
    expect(boundsOf(rotateMesh(tetra, "z", 360)).size).toEqual([10, 20, 30]);
    expect(volume(rotateMesh(tetra, "z", 37))).toBeCloseTo(volume(tetra), 3);
  });

  it("applies an adaptation in order and says what it did", () => {
    const adaptation = { scale: 0.84, mirror: { x: true }, turns: { z: 1 } };
    const out = adaptMesh(tetra, adaptation);
    expect(boundsOf(out).size[0]).toBeCloseTo(20 * 0.84);
    expect(volume(out)).toBeCloseTo(volume(tetra) * 0.84 ** 3);
    expect(describeAdaptation(adaptation)).toEqual([
      { kind: "scale", label: "", value: "84 %" },
      { kind: "other", label: "Mirrored", value: "X" },
      { kind: "other", label: "Turned", value: "90° about Z" },
    ]);
    expect(isUnchanged({ scale: 1, mirror: {}, turns: { x: 4 } })).toBe(true);
    expect(isUnchanged(adaptation)).toBe(false);
  });
});
