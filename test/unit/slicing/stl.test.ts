import { describe, expect, it } from "vitest";
import { readStl } from "../../../src/shared/slicing/stl.ts";
import { asciiStl, binaryStl, box } from "./meshes.ts";

describe("readStl", () => {
  const cube = box([0, 0, 0], [20, 20, 20]);

  it("reads a binary STL, even one whose header says solid, and one with stray bytes after it", () => {
    for (const bytes of [binaryStl(cube), binaryStl(cube, "solid cube"), binaryStl(cube, "x", 3)]) {
      const mesh = readStl(bytes);
      expect(mesh?.triangles).toBe(12);
      expect([...(mesh?.positions ?? [])]).toEqual([...cube]);
    }
  });

  it("reads an ASCII STL, numbers in any notation", () => {
    const mesh = readStl(asciiStl(cube));
    expect(mesh?.triangles).toBe(12);
    expect([...(mesh?.positions ?? [])]).toEqual([...cube]);
    const exponent = new TextEncoder().encode(
      "solid e\nfacet normal 0 0 1\nouter loop\nvertex 1e1 0 0\nvertex 0 2.5E1 0\nvertex -1.5 0 0\nendloop\nendfacet\nendsolid e\n",
    );
    expect([...(readStl(exponent)?.positions ?? [])]).toEqual([10, 0, 0, 0, 25, 0, -1.5, 0, 0]);
  });

  it("drops triangles with corners that aren't numbers, and gives null for what isn't an STL", () => {
    const broken = cube.slice();
    broken[4] = Number.NaN;
    expect(readStl(binaryStl(broken))?.triangles).toBe(11);
    expect(readStl(new TextEncoder().encode("hello, this is not a model at all"))).toBeNull();
    expect(readStl(new Uint8Array(10))).toBeNull();
    expect(readStl(binaryStl(new Float32Array(0)))).toBeNull();
  });
});
