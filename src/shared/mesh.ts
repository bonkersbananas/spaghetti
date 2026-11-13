/**
 * A triangle mesh and the changes people make to one before printing it: scale, mirror, turn, "fit to N mm". Pure
 * functions, mesh in and mesh out, with no DOM or three.js, so the app's editor, the tests and anything that slices
 * a model in the browser can all take them. Units are the file's own (millimetres in every slicer's STL).
 */

/** Every triangle is nine numbers: x y z for each of its three corners, as the file lists them. */
export interface Mesh {
  positions: Float32Array;
}

export type Axis = "x" | "y" | "z";
export const AXES: readonly Axis[] = ["x", "y", "z"];
const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

export const triangleCount = (mesh: Mesh) => mesh.positions.length / 9;

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
  /** max − min on each axis: how big it is. */
  size: [number, number, number];
}

export function boundsOf(mesh: Mesh): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = p[i + a] as number;
      if (v < (min[a] as number)) min[a] = v;
      if (v > (max[a] as number)) max[a] = v;
    }
  }
  if (!p.length) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** The scale that makes `axis` (or the longest side) exactly `targetMm` long; null when it has no length to scale. */
export function fitScale(mesh: Mesh, targetMm: number, axis: Axis | "longest" = "longest"): number | null {
  if (!(targetMm > 0)) return null;
  const size = boundsOf(mesh).size;
  const length = axis === "longest" ? Math.max(...size) : (size[AXIS_INDEX[axis]] as number);
  return length > 0 ? targetMm / length : null;
}

const MAX_FILE_BYTES = 200 * 1024 * 1024;

export type ParseResult = { ok: true; mesh: Mesh; format: "binary" | "ascii" } | { ok: false; reason: string };

/** Reads an STL, binary or ASCII. Never throws: a file that isn't one says why. */
export function parseStl(input: ArrayBuffer | Uint8Array): ParseResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_FILE_BYTES) return { ok: false, reason: "That file is too big to adapt here." };
  if (bytes.byteLength < 15) return { ok: false, reason: "That isn't an STL file." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = bytes.byteLength >= 84 ? view.getUint32(80, true) : -1;
  // A binary file is exactly 84 bytes and 50 per triangle, even when its header happens to start with "solid".
  if (declared >= 0 && bytes.byteLength === 84 + declared * 50) {
    const positions = new Float32Array(declared * 9);
    for (let t = 0; t < declared; t++) {
      const at = 84 + t * 50 + 12; // skip the normal
      for (let k = 0; k < 9; k++) positions[t * 9 + k] = view.getFloat32(at + k * 4, true);
    }
    return declared > 0
      ? { ok: true, mesh: { positions }, format: "binary" }
      : { ok: false, reason: "That STL is empty." };
  }
  const text = new TextDecoder().decode(bytes);
  if (!/^\s*solid/i.test(text)) return { ok: false, reason: "That isn't an STL file." };
  const numbers: number[] = [];
  const vertex = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  for (let m = vertex.exec(text); m; m = vertex.exec(text)) {
    numbers.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if (numbers.length === 0 || numbers.length % 9 !== 0 || numbers.some((n) => !Number.isFinite(n))) {
    return { ok: false, reason: "That STL couldn't be read." };
  }
  return { ok: true, mesh: { positions: Float32Array.from(numbers) }, format: "ascii" };
}

/** A binary STL of the mesh, with each triangle's normal worked out from its corners. */
export function writeStl(mesh: Mesh, header = "Spaghetti"): Uint8Array {
  const count = triangleCount(mesh);
  const out = new Uint8Array(84 + count * 50);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(header.slice(0, 80)), 0);
  view.setUint32(80, count, true);
  const p = mesh.positions;
  for (let t = 0; t < count; t++) {
    const i = t * 9;
    const ux = (p[i + 3] as number) - (p[i] as number);
    const uy = (p[i + 4] as number) - (p[i + 1] as number);
    const uz = (p[i + 5] as number) - (p[i + 2] as number);
    const vx = (p[i + 6] as number) - (p[i] as number);
    const vy = (p[i + 7] as number) - (p[i + 1] as number);
    const vz = (p[i + 8] as number) - (p[i + 2] as number);
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    const at = 84 + t * 50;
    view.setFloat32(at, nx, true);
    view.setFloat32(at + 4, ny, true);
    view.setFloat32(at + 8, nz, true);
    for (let k = 0; k < 9; k++) view.setFloat32(at + 12 + k * 4, p[i + k] as number, true);
  }
  return out;
}

/** Scales about the origin: one factor for all three axes, or one for each. */
export function scaleMesh(mesh: Mesh, factor: number | [number, number, number]): Mesh {
  const [sx, sy, sz] = typeof factor === "number" ? [factor, factor, factor] : factor;
  const from = mesh.positions;
  const positions = new Float32Array(from.length);
  for (let i = 0; i < from.length; i += 3) {
    positions[i] = (from[i] as number) * sx;
    positions[i + 1] = (from[i + 1] as number) * sy;
    positions[i + 2] = (from[i + 2] as number) * sz;
  }
  return { positions };
}

/** Mirrors across the plane through the origin that is square to `axis`. Triangles keep facing outwards. */
export function mirrorMesh(mesh: Mesh, axis: Axis): Mesh {
  const a = AXIS_INDEX[axis];
  const from = mesh.positions;
  const positions = new Float32Array(from.length);
  for (let t = 0; t < from.length; t += 9) {
    // Mirroring turns a triangle inside out: swap two corners to turn it back.
    for (let corner = 0; corner < 3; corner++) {
      const source = t + (corner === 1 ? 6 : corner === 2 ? 3 : 0);
      for (let k = 0; k < 3; k++) {
        const value = from[source + k] as number;
        positions[t + corner * 3 + k] = k === a ? -value : value;
      }
    }
  }
  return { positions };
}

/** Turns about `axis` by `degrees` (counter-clockwise looking down the axis towards the origin). */
export function rotateMesh(mesh: Mesh, axis: Axis, degrees: number): Mesh {
  // Quarter turns are exact: sin and cos of 90° are not quite 0 and 1 in floating point.
  const turns = ((degrees % 360) + 360) % 360;
  const exact: Record<number, [number, number]> = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };
  const [cos, sin] = exact[turns] ?? [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
  const [i, j] = axis === "x" ? [1, 2] : axis === "y" ? [2, 0] : [0, 1];
  const from = mesh.positions;
  const positions = new Float32Array(from.length);
  for (let v = 0; v < from.length; v += 3) {
    const a = from[v + i] as number;
    const b = from[v + j] as number;
    positions[v + i] = a * cos - b * sin;
    positions[v + j] = a * sin + b * cos;
    positions[v + (3 - i - j)] = from[v + (3 - i - j)] as number;
  }
  return { positions };
}

/** What to do to a mesh, in the order people think of it: scale, mirror, turn. */
export interface Adaptation {
  /** One factor for every axis (1 leaves it). */
  scale: number;
  mirror: Partial<Record<Axis, boolean>>;
  /** Quarter turns about each axis, any whole number (negative turns the other way). */
  turns: Partial<Record<Axis, number>>;
}

export const NO_ADAPTATION: Adaptation = { scale: 1, mirror: {}, turns: {} };

export const isUnchanged = (a: Adaptation) =>
  Math.abs(a.scale - 1) < 1e-9 && AXES.every((axis) => !a.mirror[axis] && (((a.turns[axis] ?? 0) % 4) + 4) % 4 === 0);

export function adaptMesh(mesh: Mesh, adaptation: Adaptation): Mesh {
  let out = Math.abs(adaptation.scale - 1) < 1e-9 ? mesh : scaleMesh(mesh, adaptation.scale);
  for (const axis of AXES) if (adaptation.mirror[axis]) out = mirrorMesh(out, axis);
  for (const axis of AXES) {
    const quarter = (((adaptation.turns[axis] ?? 0) % 4) + 4) % 4;
    if (quarter) out = rotateMesh(out, axis, quarter * 90);
  }
  return out;
}

/** The adaptation in the words of a twist's changes: [kind, value, words]. */
export function describeAdaptation(a: Adaptation): Array<{ kind: "scale" | "other"; label: string; value: string }> {
  const lines: Array<{ kind: "scale" | "other"; label: string; value: string }> = [];
  if (Math.abs(a.scale - 1) >= 1e-9) {
    lines.push({ kind: "scale", label: "", value: `${Number((a.scale * 100).toFixed(2))} %` });
  }
  const mirrored = AXES.filter((axis) => a.mirror[axis]);
  if (mirrored.length) lines.push({ kind: "other", label: "Mirrored", value: mirrored.join(", ").toUpperCase() });
  const turned = AXES.flatMap((axis) => {
    const quarter = (((a.turns[axis] ?? 0) % 4) + 4) % 4;
    return quarter ? [`${quarter * 90}° about ${axis.toUpperCase()}`] : [];
  });
  if (turned.length) lines.push({ kind: "other", label: "Turned", value: turned.join(", ") });
  return lines;
}
