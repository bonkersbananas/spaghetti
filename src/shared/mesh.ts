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
  const binary = (): ParseResult => {
    const positions = new Float32Array(declared * 9);
    for (let t = 0; t < declared; t++) {
      const at = 84 + t * 50 + 12; // skip the normal
      for (let k = 0; k < 9; k++) positions[t * 9 + k] = view.getFloat32(at + k * 4, true);
    }
    return declared > 0
      ? { ok: true, mesh: { positions }, format: "binary" }
      : { ok: false, reason: "That STL is empty." };
  };
  // A binary file is exactly 84 bytes and 50 per triangle, even when its header happens to start with "solid".
  if (declared >= 0 && bytes.byteLength === 84 + declared * 50) return binary();
  const text = new TextDecoder().decode(bytes);
  const solid = /^\s*solid/i.test(text);
  if (solid) {
    const numbers: number[] = [];
    const vertex = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
    for (let m = vertex.exec(text); m; m = vertex.exec(text)) {
      numbers.push(Number(m[1]), Number(m[2]), Number(m[3]));
    }
    if (numbers.length > 0 && numbers.length % 9 === 0 && numbers.every((n) => Number.isFinite(n))) {
      return { ok: true, mesh: { positions: Float32Array.from(numbers) }, format: "ascii" };
    }
  }
  // Some binary writers leave a few bytes after the last triangle (fewer than another triangle would take).
  const stray = bytes.byteLength - (84 + declared * 50);
  if (declared > 0 && stray > 0 && stray < 50) return binary();
  return { ok: false, reason: solid ? "That STL couldn't be read." : "That isn't an STL file." };
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

/* Lying on a face ------------------------------------------------------------------------------------------- */

type Vec3 = [number, number, number];

/** A face a model can rest on. */
export interface RestingFace {
  /** The face's outward normal, a unit vector in the mesh's own axes: the way the model points when it rests on it. */
  down: Vec3;
  /** mm² of the model's convex hull that lies on this face (its coplanar neighbours counted in). */
  area: number;
}

/** Hull faces whose normals differ by less than this are one face. */
const COPLANAR_DEGREES = 4;
/** A face the model touches over less than this part of the hull's surface is a rounded edge, not somewhere to rest. */
const MIN_FACE_SHARE = 0.04;
/** Above this many points the hull is built from the extreme ones in many directions: the same hull, much quicker. */
/** Faces whose contact is measured, the biggest hull faces first: more is more than anyone is offered. */
const MOST_CANDIDATES = 24;
const HULL_POINT_LIMIT = 60_000;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The mesh's distinct corners as one flat array, thinned to the extreme ones when there are very many. */
function hullPoints(mesh: Mesh): Float64Array {
  const p = mesh.positions;
  const count = p.length / 3;
  if (count <= HULL_POINT_LIMIT) return Float64Array.from(p);
  // The corner furthest along each of ~2000 evenly spread directions: every face of the hull that matters has one.
  const directions = 2000;
  const best = new Int32Array(directions).fill(-1);
  const bestValue = new Float64Array(directions).fill(-Infinity);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const dirs = new Float64Array(directions * 3);
  for (let d = 0; d < directions; d++) {
    const z = 1 - (2 * (d + 0.5)) / directions;
    const r = Math.sqrt(1 - z * z);
    dirs[d * 3] = Math.cos(d * golden) * r;
    dirs[d * 3 + 1] = Math.sin(d * golden) * r;
    dirs[d * 3 + 2] = z;
  }
  for (let i = 0; i < count; i++) {
    const x = p[i * 3] as number;
    const y = p[i * 3 + 1] as number;
    const z = p[i * 3 + 2] as number;
    for (let d = 0; d < directions; d++) {
      const value = x * (dirs[d * 3] as number) + y * (dirs[d * 3 + 1] as number) + z * (dirs[d * 3 + 2] as number);
      if (value > (bestValue[d] as number)) {
        bestValue[d] = value;
        best[d] = i;
      }
    }
  }
  const picked = [...new Set(best)].filter((i) => i >= 0);
  const out = new Float64Array(picked.length * 3);
  for (const [k, i] of picked.entries()) {
    out[k * 3] = p[i * 3] as number;
    out[k * 3 + 1] = p[i * 3 + 1] as number;
    out[k * 3 + 2] = p[i * 3 + 2] as number;
  }
  return out;
}

interface HullFace {
  a: number;
  b: number;
  c: number;
  normal: Vec3;
  offset: number;
}

/** The triangles of the convex hull of the points (quickhull, outward-facing), or [] when they are flat or fewer than four. */
function convexHull(points: Float64Array, tolerance: number): HullFace[] {
  const n = points.length / 3;
  if (n < 4) return [];
  const at = (i: number): Vec3 => [points[i * 3] as number, points[i * 3 + 1] as number, points[i * 3 + 2] as number];
  // A first tetrahedron from points far apart.
  let lo = 0;
  let hi = 0;
  for (let i = 1; i < n; i++) {
    if ((points[i * 3] as number) < (points[lo * 3] as number)) lo = i;
    if ((points[i * 3] as number) > (points[hi * 3] as number)) hi = i;
  }
  let far = 0;
  let farValue = -1;
  for (let i = 0; i < n; i++) {
    const d = sub(at(i), at(lo));
    const value = dot(d, d);
    if (value > farValue) {
      farValue = value;
      far = i;
    }
  }
  const p0 = lo;
  const p1 = far;
  if (farValue < tolerance * tolerance) return [];
  const axis = sub(at(p1), at(p0));
  let p2 = -1;
  let best = -1;
  for (let i = 0; i < n; i++) {
    const c = cross(axis, sub(at(i), at(p0)));
    const value = dot(c, c);
    if (value > best) {
      best = value;
      p2 = i;
    }
  }
  const base = cross(axis, sub(at(p2), at(p0)));
  const baseLength = Math.hypot(...base);
  if (baseLength < tolerance * Math.hypot(...axis)) return [];
  let p3 = -1;
  let height = 0;
  for (let i = 0; i < n; i++) {
    const value = Math.abs(dot(base, sub(at(i), at(p0)))) / baseLength;
    if (value > height) {
      height = value;
      p3 = i;
    }
  }
  if (p3 < 0 || height < tolerance) return [];

  const faceOf = (a: number, b: number, c: number, inside: Vec3): HullFace => {
    const pa = at(a);
    let normal = cross(sub(at(b), pa), sub(at(c), pa));
    const length = Math.hypot(...normal) || 1;
    normal = [normal[0] / length, normal[1] / length, normal[2] / length];
    const face: HullFace = { a, b, c, normal, offset: dot(normal, pa) };
    // Wound so that it faces away from a point inside the hull.
    if (dot(normal, inside) - face.offset > 0) {
      return { a, b: c, c: b, normal: [-normal[0], -normal[1], -normal[2]], offset: -face.offset };
    }
    return face;
  };
  const inside: Vec3 = [0, 1, 2, 3].reduce(
    (sum, k) => {
      const q = at([p0, p1, p2, p3][k] as number);
      return [sum[0] + q[0] / 4, sum[1] + q[1] / 4, sum[2] + q[2] / 4] as Vec3;
    },
    [0, 0, 0] as Vec3,
  );
  let faces: HullFace[] = [
    faceOf(p0, p1, p2, inside),
    faceOf(p0, p1, p3, inside),
    faceOf(p0, p2, p3, inside),
    faceOf(p1, p2, p3, inside),
  ];
  const used = new Set([p0, p1, p2, p3]);
  // Each pass takes the point furthest outside any face and wraps the hull round it.
  for (let guard = 0; guard < n + 8; guard++) {
    let next = -1;
    let reach = tolerance;
    for (let i = 0; i < n; i++) {
      if (used.has(i)) continue;
      const q = at(i);
      for (const face of faces) {
        const out = dot(face.normal, q) - face.offset;
        if (out > reach) {
          reach = out;
          next = i;
        }
      }
    }
    if (next < 0) break;
    used.add(next);
    const q = at(next);
    const visible = faces.filter((face) => dot(face.normal, q) - face.offset > tolerance);
    const kept = faces.filter((face) => !visible.includes(face));
    // The horizon: edges of the visible faces that no other visible face walks the other way.
    const edges = new Map<string, [number, number]>();
    for (const face of visible) {
      for (const [from, to] of [
        [face.a, face.b],
        [face.b, face.c],
        [face.c, face.a],
      ] as const) {
        const back = `${to}:${from}`;
        if (edges.has(back)) edges.delete(back);
        else edges.set(`${from}:${to}`, [from, to]);
      }
    }
    for (const [from, to] of edges.values()) kept.push(faceOf(from, to, next, inside));
    faces = kept;
  }
  return faces;
}

/** The mesh's centre of mass (even density): by volume when the mesh is closed, else by surface. */
export function centreOfMass(mesh: Mesh): Vec3 {
  const p = mesh.positions;
  let volume = 0;
  const weighted: Vec3 = [0, 0, 0];
  let area = 0;
  const surface: Vec3 = [0, 0, 0];
  for (let t = 0; t < p.length; t += 9) {
    const a: Vec3 = [p[t] as number, p[t + 1] as number, p[t + 2] as number];
    const b: Vec3 = [p[t + 3] as number, p[t + 4] as number, p[t + 5] as number];
    const c: Vec3 = [p[t + 6] as number, p[t + 7] as number, p[t + 8] as number];
    const v = dot(a, cross(b, c)) / 6;
    volume += v;
    const sa = Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
    area += sa;
    for (let k = 0; k < 3; k++) {
      weighted[k] = (weighted[k] as number) + (v * ((a[k] as number) + (b[k] as number) + (c[k] as number))) / 4;
      surface[k] = (surface[k] as number) + (sa * ((a[k] as number) + (b[k] as number) + (c[k] as number))) / 3;
    }
  }
  if (Math.abs(volume) > 1e-9) return [weighted[0] / volume, weighted[1] / volume, weighted[2] / volume];
  return area > 0 ? [surface[0] / area, surface[1] / area, surface[2] / area] : [0, 0, 0];
}

/**
 * The faces a model can rest on, largest first: the faces of its convex hull (the model lying on a table, wrapped in
 * cling film) that its centre of mass sits over, with nearly coplanar ones merged into one and rounded-off slivers
 * left out. A box has six, and a cylinder its two ends. At most `max`; none for a mesh with no volume.
 */
export function restingFaces(mesh: Mesh, max = 6): RestingFace[] {
  if (mesh.positions.length < 36) return [];
  const size = boundsOf(mesh).size;
  const extent = Math.max(...size);
  if (!(extent > 0)) return [];
  const hullPointsFlat = hullPoints(mesh);
  const faces = convexHull(hullPointsFlat, extent * 1e-6);
  if (!faces.length) return [];

  // Hull triangles with their areas, their corners looked up in the hull's own points.
  const triangles = faces.map((face) => {
    const corner = (i: number): Vec3 => [
      hullPointsFlat[i * 3] as number,
      hullPointsFlat[i * 3 + 1] as number,
      hullPointsFlat[i * 3 + 2] as number,
    ];
    const a = corner(face.a);
    const b = corner(face.b);
    const c = corner(face.c);
    return { a, b, c, normal: face.normal, area: Math.hypot(...cross(sub(b, a), sub(c, a))) / 2 };
  });
  const total = triangles.reduce((sum, triangle) => sum + triangle.area, 0);
  if (!(total > 0)) return [];

  // Merge by normal, the biggest triangle first.
  const order = triangles.map((_, i) => i).sort((x, y) => (triangles[y]?.area ?? 0) - (triangles[x]?.area ?? 0));
  const limit = Math.cos((COPLANAR_DEGREES * Math.PI) / 180);
  const taken = new Set<number>();
  const centre = centreOfMass(mesh);
  const found: Array<RestingFace & { members: typeof triangles }> = [];
  for (const seed of order) {
    if (taken.has(seed)) continue;
    const base = (triangles[seed] as (typeof triangles)[number]).normal;
    const members: typeof triangles = [];
    const sum: Vec3 = [0, 0, 0];
    let area = 0;
    for (const other of order) {
      if (taken.has(other)) continue;
      const triangle = triangles[other] as (typeof triangles)[number];
      if (dot(triangle.normal, base) < limit) continue;
      taken.add(other);
      members.push(triangle);
      area += triangle.area;
      for (let k = 0; k < 3; k++) sum[k] = (sum[k] as number) + (triangle.normal[k] as number) * triangle.area;
    }
    const length = Math.hypot(...sum) || 1;
    found.push({ down: [sum[0] / length, sum[1] / length, sum[2] / length], area, members });
  }

  const stable = found.filter((face) => {
    if (face.area < total * MIN_FACE_SHARE) return false;
    // The centre of mass, dropped straight onto the face, has to land on it (or this tips over onto a neighbour).
    const n = face.down;
    const margin = extent * 1e-4;
    return face.members.some((t) => {
      // Test in the plane: the point is inside when it is on the inner side of all three edges.
      const height = dot(n, sub(centre, t.a));
      const q = sub(centre, [n[0] * height, n[1] * height, n[2] * height]);
      const sides = [
        dot(cross(sub(t.b, t.a), sub(q, t.a)), n),
        dot(cross(sub(t.c, t.b), sub(q, t.b)), n),
        dot(cross(sub(t.a, t.c), sub(q, t.c)), n),
      ];
      return sides.every((s) => s >= -margin * extent);
    });
  });
  // It has to touch the plate: the model's own flat triangles lie in the face's plane (a bracket's hull has a face
  // across the hollow of its L, which only its two edges touch). Its area is what the model rests on.
  const p = mesh.positions;
  const tolerance = extent * 2e-3;
  const resting = stable
    .sort((x, y) => y.area - x.area)
    .slice(0, MOST_CANDIDATES)
    .map((face) => {
      const n = face.down;
      let top = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        top = Math.max(top, n[0] * (p[i] as number) + n[1] * (p[i + 1] as number) + n[2] * (p[i + 2] as number));
      }
      let contact = 0;
      for (let t = 0; t < p.length; t += 9) {
        const at = (k: number) =>
          n[0] * (p[t + k] as number) + n[1] * (p[t + k + 1] as number) + n[2] * (p[t + k + 2] as number);
        if (top - at(0) > tolerance || top - at(3) > tolerance || top - at(6) > tolerance) continue;
        const a: Vec3 = [p[t] as number, p[t + 1] as number, p[t + 2] as number];
        const b: Vec3 = [p[t + 3] as number, p[t + 4] as number, p[t + 5] as number];
        const c: Vec3 = [p[t + 6] as number, p[t + 7] as number, p[t + 8] as number];
        contact += Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
      }
      return { down: face.down, area: contact };
    })
    .filter((face) => face.area >= total * MIN_FACE_SHARE);
  return resting
    .sort((x, y) => y.area - x.area)
    .slice(0, max)
    .map(({ down, area }) => ({ down: down.map((v) => Math.round(v * 1e4) / 1e4) as Vec3, area }));
}

/**
 * The mesh turned so that the direction `down` (a unit vector in its own axes) points straight down, then set on
 * the plate (its lowest point at z 0), with the existing turns about z and y. The mesh keeps its x and y position
 * only roughly: a slicer places it after.
 */
export function layMeshDown(mesh: Mesh, down: Vec3): Mesh {
  const length = Math.hypot(...down);
  if (!(length > 0)) return mesh;
  const [dx, dy, dz] = [down[0] / length, down[1] / length, down[2] / length];
  const toDegrees = (radians: number) => (radians * 180) / Math.PI;
  // First about z, so the direction lies in the x–z plane with x ≥ 0; then about y until it points to −z.
  const flat = Math.hypot(dx, dy);
  let out = flat > 1e-9 ? rotateMesh(mesh, "z", toDegrees(-Math.atan2(dy, dx))) : mesh;
  out = rotateMesh(out, "y", toDegrees(Math.atan2(flat, -dz)));
  const low = boundsOf(out).min[2];
  if (low === 0) return out;
  const positions = new Float32Array(out.positions);
  for (let i = 2; i < positions.length; i += 3) positions[i] = (positions[i] as number) - low;
  return { positions };
}
