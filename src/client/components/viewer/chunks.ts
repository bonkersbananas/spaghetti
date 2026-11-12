import {
  BufferAttribute,
  type BufferGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
} from "three";

/** One unit box: x along the move (0–1), y across (±0.5), z from the layer's top down (−1–0), with its normals. */
export function boxGeometry(): InstancedBufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const face = (n: [number, number, number], corners: [number, number, number][]) => {
    const base = positions.length / 3;
    for (const c of corners) {
      positions.push(...c);
      normals.push(...n);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  face(
    [0, 0, 1],
    [
      [0, -0.5, 0],
      [1, -0.5, 0],
      [1, 0.5, 0],
      [0, 0.5, 0],
    ],
  );
  face(
    [0, 0, -1],
    [
      [0, -0.5, -1],
      [0, 0.5, -1],
      [1, 0.5, -1],
      [1, -0.5, -1],
    ],
  );
  face(
    [0, 1, 0],
    [
      [0, 0.5, 0],
      [1, 0.5, 0],
      [1, 0.5, -1],
      [0, 0.5, -1],
    ],
  );
  face(
    [0, -1, 0],
    [
      [0, -0.5, 0],
      [0, -0.5, -1],
      [1, -0.5, -1],
      [1, -0.5, 0],
    ],
  );
  face(
    [1, 0, 0],
    [
      [1, -0.5, 0],
      [1, -0.5, -1],
      [1, 0.5, -1],
      [1, 0.5, 0],
    ],
  );
  face(
    [-1, 0, 0],
    [
      [0, -0.5, 0],
      [0, 0.5, 0],
      [0, 0.5, -1],
      [0, -0.5, -1],
    ],
  );
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * The instanced geometry of one batch of layers: the box every segment is drawn from, and the batch's own buffers.
 * The box's attributes are copied into a table of the chunk's own: sharing the box's object let each later chunk's
 * setAttribute replace the earlier chunks' buffers, so a print that came in more than one batch (40 000 segments)
 * drew its first layers from the last batch's data (the hull of a Benchy vanished, with stray lines).
 */
export function chunkGeometry(box: BufferGeometry, pos: Float32Array, info: Float32Array, segments: number) {
  const geometry = new InstancedBufferGeometry();
  geometry.index = box.index;
  for (const [name, attribute] of Object.entries(box.attributes)) geometry.setAttribute(name, attribute);
  const buffer = new InstancedInterleavedBuffer(pos, 6, 1);
  geometry.setAttribute("aStart", new InterleavedBufferAttribute(buffer, 3, 0));
  geometry.setAttribute("aEnd", new InterleavedBufferAttribute(buffer, 3, 3));
  geometry.setAttribute("aInfo", new InstancedBufferAttribute(info, 2));
  geometry.instanceCount = segments;
  return geometry;
}
