import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { stlTo3mf } from "../../src/shared/threemf/stl-wrap.ts";

const streamOf = (bytes: Uint8Array, piece = 1000) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += piece) controller.enqueue(bytes.slice(at, at + piece));
      controller.close();
    },
  });

async function collect(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A binary STL of the triangles, each nine floats. */
function binaryStl(triangles: number[][]) {
  const bytes = new Uint8Array(84 + 50 * triangles.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles.length, true);
  for (const [i, t] of triangles.entries())
    for (const [k, v] of t.entries()) view.setFloat32(84 + 50 * i + 12 + 4 * k, v, true);
  return bytes;
}

const TRIANGLES = [
  [0, 0, 0, 10.5, 0, 0, 0, 0.1, 20],
  [10.5, 0, 0, 10.5, 0.1, 20, 0, 0.1, 20],
  [-3.25, 1e-3, 123456.78, 0, 0, 0, 1, 1, 1],
];

/** The vertices and triangles of a 3MF's model part. */
function mesh(zip: Uint8Array) {
  const files = unzipSync(zip);
  const xml = new TextDecoder().decode(files["3D/3dmodel.model"]);
  const vertices = [...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map((m) =>
    [m[1], m[2], m[3]].map(Number),
  );
  const triangles = [...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map((m) =>
    [m[1], m[2], m[3]].map(Number),
  );
  return { files, vertices, triangles };
}

describe("an STL wrapped in a 3MF", () => {
  it("makes a valid zip with the same triangles, from a binary STL read in small pieces", async () => {
    const stl = binaryStl(TRIANGLES);
    const out = await collect(stlTo3mf(streamOf(stl, 77), stl.length));
    const { files, vertices, triangles } = mesh(out);
    expect(Object.keys(files).sort()).toEqual(["3D/3dmodel.model", "[Content_Types].xml", "_rels/.rels"]);
    expect(triangles).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
    ]);
    // Each coordinate reads back as the very same float32.
    const flat = vertices.flat().map(Math.fround);
    expect(flat).toEqual(TRIANGLES.flat().map(Math.fround));
  });

  it("reads an ASCII STL and drops triangles that aren't numbers", async () => {
    const text = `solid t\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1.5 0\n  endloop\n endfacet\n facet normal 0 0 1\n  outer loop\n   vertex nan 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid t\n`;
    const bytes = new TextEncoder().encode(text);
    const { vertices, triangles } = mesh(await collect(stlTo3mf(streamOf(bytes, 40), bytes.length)));
    expect(vertices).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1.5, 0],
    ]);
    expect(triangles).toEqual([[0, 1, 2]]);
  });

  it("holds many triangles across pieces", async () => {
    const many = Array.from({ length: 5000 }, (_, i) => [i, 0, 0, i + 1, 0, 0, i, 1, 0]);
    const stl = binaryStl(many);
    const out = await collect(stlTo3mf(streamOf(stl, 4096), stl.length));
    expect(mesh(out).triangles).toHaveLength(5000);
  });
});
