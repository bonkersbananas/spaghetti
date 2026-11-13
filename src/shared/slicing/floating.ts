/**
 * Whether a model as it lies on the plate has a part that starts in the air: a lowest point (or a flat underside)
 * above the plate with nothing under it, which prints onto nothing without supports. OrcaSlicer's engine warns of such
 * parts ("sharp tails"; the card's "Parts of it float in the air"); Spaghetti's own slicer doesn't yet, so the slice
 * worker asks this before ours slices a model without supports, and lets OrcaSlicer's engine slice it when it says yes
 * (decision 0055). Orca's other reason to warn, an arm reaching out more than 12 mm from what holds it (a
 * cantilever), isn't looked for here.
 *
 * On the mesh, not on slices: the corners of the triangles, welded where they meet, are grouped into flat patches
 * (corners joined by an edge at one height); a patch none of whose edges lead lower, facing down and above the first
 * layer, may be where a part starts. It is, if its surface doesn't lead lower within a layer's height above it either
 * (a dimple in a curved overhang does, and Orca's slices see it as part of the overhang's island), and it floats
 * unless it rests on another part of the model: a point just under it is inside the model (an odd number of the
 * model's surfaces below it), as a post standing on a base made of another shell is. Pure, so the tests and the worker
 * share it.
 */

/** Two corners closer in height than this (mm) are level. */
const LEVEL = 0.002;
/** Corners are welded on a grid this fine (mm), or finer than the model's size over 2^17 allows. */
const WELD = 0.001;
/** A point this far under a patch (mm) is what holds it up, or isn't. */
const PROBE = 0.05;
/** The points of a patch tried, at most. */
const PROBES = 8;

/**
 * Whether any of the objects (triangle soups in mm, as placed on the plate, z = 0 on the plate) has a part that
 * starts in the air: above `above` (where the first layer is cut, half its height: lower than that, it prints on the
 * plate), and standing alone for at least `layer` (a layer's height).
 */
export function hasFloatingPart(
  objects: readonly Float32Array[],
  { above, layer }: { above: number; layer: number },
): boolean {
  const mesh = weld(objects);
  if (!mesh) return false;
  const { z, corners, triangles } = mesh;
  const count = z.length;

  // Flat patches: corners joined by a level edge are one.
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (i: number) => {
    let root = i;
    while (parent[root] !== root) root = parent[root] as number;
    while (parent[i] !== root) {
      const next = parent[i] as number;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const edges = (visit: (a: number, b: number) => void) => {
    for (let t = 0; t < triangles; t++) {
      const a = corners[t * 3] as number;
      const b = corners[t * 3 + 1] as number;
      const c = corners[t * 3 + 2] as number;
      visit(a, b);
      visit(b, c);
      visit(c, a);
    }
  };
  edges((a, b) => {
    if (Math.abs((z[a] as number) - (z[b] as number)) <= LEVEL) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
  });
  // A patch with an edge that leads lower isn't where a part starts.
  const lower = new Uint8Array(count);
  edges((a, b) => {
    const za = z[a] as number;
    const zb = z[b] as number;
    if (zb < za - LEVEL) lower[find(a)] = 1;
    else if (za < zb - LEVEL) lower[find(b)] = 1;
  });
  // Which way a patch faces: the triangles at its corners, weighted by their area (down is negative). A triangle
  // wholly in a patch (a flat underside's) is kept for the points to probe under it.
  const facing = new Float64Array(count);
  const own = new Map<number, number[]>();
  const { positions } = mesh;
  for (let t = 0; t < triangles; t++) {
    const i = t * 9;
    const ux = (positions[i + 3] as number) - (positions[i] as number);
    const uy = (positions[i + 4] as number) - (positions[i + 1] as number);
    const vx = (positions[i + 6] as number) - (positions[i] as number);
    const vy = (positions[i + 7] as number) - (positions[i + 1] as number);
    const nz = ux * vy - uy * vx;
    const roots = [0, 1, 2].map((k) => find(corners[t * 3 + k] as number));
    for (const root of roots) facing[root] = (facing[root] as number) + nz;
    if (roots[0] === roots[1] && roots[1] === roots[2]) {
      const list = own.get(roots[0] as number);
      if (!list) own.set(roots[0] as number, [t]);
      else if (list.length < PROBES) list.push(t);
    }
  }

  // The patches where a part starts, with their corners.
  const starts = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const root = find(i);
    if (lower[root] || (facing[root] as number) >= 0 || (z[i] as number) <= above + LEVEL) continue;
    const list = starts.get(root);
    if (list) list.push(i);
    else starts.set(root, [i]);
  }
  if (!starts.size) return false;

  const alone = aloneTest(mesh, layer);
  const inside = insideTest(mesh);
  for (const [root, members] of starts) {
    if (!alone(members)) continue;
    const floor = z[members[0] as number] as number;
    // Points under it: its middle, the middles of its own triangles, its corners nudged towards its middle (off the
    // edges other parts may share). It rests on something if any of them is inside the model.
    let cx = 0;
    let cy = 0;
    for (const i of members) {
      cx += mesh.x[i] as number;
      cy += mesh.y[i] as number;
    }
    cx /= members.length;
    cy /= members.length;
    const probes: [number, number][] = [[cx, cy]];
    for (const t of own.get(root) ?? []) {
      const i = t * 9;
      probes.push([
        ((positions[i] as number) + (positions[i + 3] as number) + (positions[i + 6] as number)) / 3,
        ((positions[i + 1] as number) + (positions[i + 4] as number) + (positions[i + 7] as number)) / 3,
      ]);
    }
    const step = Math.max(1, Math.floor(members.length / PROBES));
    for (let k = 0; k < members.length; k += step) {
      const i = members[k] as number;
      probes.push([(mesh.x[i] as number) * 0.9 + cx * 0.1, (mesh.y[i] as number) * 0.9 + cy * 0.1]);
    }
    if (!probes.some(([x, y]) => inside(x, y, floor - PROBE))) return true;
  }
  return false;
}

/**
 * Whether a patch stands alone for a layer's height: the surface above it, up to that height, never leads lower than
 * it (a cone's tip does; a dimple in a curved overhang soon reaches the overhang's lower parts).
 */
function aloneTest({ z, corners, triangles }: Welded, layer: number): (patch: number[]) => boolean {
  const count = z.length;
  // Each corner's neighbours, packed: first how many, then which.
  const start = new Int32Array(count + 1);
  for (let r = 0; r < triangles * 3; r++) {
    const corner = corners[r] as number;
    start[corner + 1] = (start[corner + 1] as number) + 2;
  }
  for (let i = 1; i <= count; i++) start[i] = (start[i] as number) + (start[i - 1] as number);
  const next = start.slice(0, count);
  const around = new Int32Array(start[count] as number);
  for (let t = 0; t < triangles; t++) {
    for (let k = 0; k < 3; k++) {
      const a = corners[t * 3 + k] as number;
      around[next[a] as number] = corners[t * 3 + ((k + 1) % 3)] as number;
      around[(next[a] as number) + 1] = corners[t * 3 + ((k + 2) % 3)] as number;
      next[a] = (next[a] as number) + 2;
    }
  }
  const seen = new Int32Array(count);
  let visit = 0;
  return (patch) => {
    visit++;
    const floor = z[patch[0] as number] as number;
    const queue = [...patch];
    for (const i of patch) seen[i] = visit;
    while (queue.length) {
      const i = queue.pop() as number;
      for (let k = start[i] as number; k < (start[i + 1] as number); k++) {
        const j = around[k] as number;
        const height = z[j] as number;
        if (height < floor - LEVEL) return false;
        if (seen[j] === visit || height > floor + layer) continue;
        seen[j] = visit;
        queue.push(j);
      }
    }
    return true;
  };
}

interface Welded {
  /** Every triangle's corners, 9 numbers each. */
  positions: Float32Array;
  /** Each welded corner's place. */
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** Each triangle's three welded corners. */
  corners: Int32Array;
  triangles: number;
}

/** The objects' triangles in one soup, their corners welded where they meet (a hash on a fine grid). */
function weld(objects: readonly Float32Array[]): Welded | null {
  const total = objects.reduce((sum, object) => sum + Math.floor(object.length / 9) * 9, 0);
  if (!total) return null;
  const positions = new Float32Array(total);
  let at = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const object of objects) {
    const length = Math.floor(object.length / 9) * 9;
    positions.set(object.subarray(0, length), at);
    at += length;
  }
  for (let i = 0; i < total; i++) {
    const axis = i % 3;
    const value = positions[i] as number;
    if (value < (min[axis] as number)) min[axis] = value;
    if (value > (max[axis] as number)) max[axis] = value;
  }
  if (![...min, ...max].every(Number.isFinite)) return null;
  const [minX = 0, minY = 0, minZ = 0] = min;
  const size = min.map((low, axis) => Math.max(WELD, ((max[axis] as number) - low) / 131000));
  const [sizeX = WELD, sizeY = WELD, sizeZ = WELD] = size;
  const refs = total / 3;
  const triangles = refs / 3;
  // Open addressing: keys are the grid cell (x, y, z each under 2^17, so the key is an exact double), values the corner.
  let capacity = 1024;
  while (capacity < refs) capacity *= 2;
  let keys = new Float64Array(capacity).fill(-1);
  let values = new Int32Array(capacity);
  let used = 0;
  const x = new Float32Array(refs);
  const y = new Float32Array(refs);
  const z = new Float32Array(refs);
  const corners = new Int32Array(refs);
  const slot = (key: number, mask: number, table: Float64Array) => {
    // A multiplicative hash of the key's two halves.
    let h = (Math.imul((key / 4294967296) | 0, 0x9e3779b1) ^ Math.imul(key >>> 0, 0x85ebca77)) & mask;
    while (table[h] !== -1 && table[h] !== key) h = (h + 1) & mask;
    return h;
  };
  const cell = (value: number, low: number, step: number) =>
    Math.min(131071, Math.max(0, Math.round((value - low) / step)));
  for (let r = 0; r < refs; r++) {
    const px = positions[r * 3] as number;
    const py = positions[r * 3 + 1] as number;
    const pz = positions[r * 3 + 2] as number;
    const key = (cell(px, minX, sizeX) * 131072 + cell(py, minY, sizeY)) * 131072 + cell(pz, minZ, sizeZ);
    if (used * 2 > capacity) {
      // Grow: every corner again into a table twice the size.
      const bigger = new Float64Array(capacity * 2).fill(-1);
      const moved = new Int32Array(capacity * 2);
      for (let s = 0; s < capacity; s++) {
        const k = keys[s] as number;
        if (k === -1) continue;
        const h = slot(k, capacity * 2 - 1, bigger);
        bigger[h] = k;
        moved[h] = values[s] as number;
      }
      keys = bigger;
      values = moved;
      capacity *= 2;
    }
    const h = slot(key, capacity - 1, keys);
    if (keys[h] === -1) {
      keys[h] = key;
      values[h] = used;
      x[used] = px;
      y[used] = py;
      z[used] = pz;
      used++;
    }
    corners[r] = values[h] as number;
  }
  return { positions, x: x.subarray(0, used), y: y.subarray(0, used), z: z.subarray(0, used), corners, triangles };
}

/**
 * Whether a point is inside the model: a ray straight down from it crosses an odd number of its surfaces. The
 * triangles are binned on a grid of the plate's area so a ray looks at those under it only.
 */
function insideTest({ positions, triangles }: Welded): (x: number, y: number, z: number) => boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i] as number);
    maxX = Math.max(maxX, positions[i] as number);
    minY = Math.min(minY, positions[i + 1] as number);
    maxY = Math.max(maxY, positions[i + 1] as number);
  }
  const side = 64;
  const width = Math.max(1e-6, (maxX - minX) / side);
  const depth = Math.max(1e-6, (maxY - minY) / side);
  const column = (value: number, min: number, size: number) =>
    Math.min(side - 1, Math.max(0, Math.floor((value - min) / size)));
  // Two passes: how many triangles each cell has, then which.
  const counts = new Int32Array(side * side + 1);
  const span = (t: number, visit: (cell: number) => void) => {
    const i = t * 9;
    const xs = [positions[i] as number, positions[i + 3] as number, positions[i + 6] as number];
    const ys = [positions[i + 1] as number, positions[i + 4] as number, positions[i + 7] as number];
    const x0 = column(Math.min(...xs), minX, width);
    const x1 = column(Math.max(...xs), minX, width);
    const y0 = column(Math.min(...ys), minY, depth);
    const y1 = column(Math.max(...ys), minY, depth);
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) visit(gy * side + gx);
  };
  for (let t = 0; t < triangles; t++) {
    span(t, (cell) => {
      counts[cell + 1] = (counts[cell + 1] as number) + 1;
    });
  }
  for (let c = 1; c <= side * side; c++) counts[c] = (counts[c] as number) + (counts[c - 1] as number);
  const filled = counts.slice(0, side * side);
  const binned = new Int32Array(counts[side * side] as number);
  for (let t = 0; t < triangles; t++) {
    span(t, (cell) => {
      binned[filled[cell] as number] = t;
      filled[cell] = (filled[cell] as number) + 1;
    });
  }
  return (px, py, pz) => {
    // Off any edge the model's own grid would put a ray on.
    const x = px + 1.23457e-4;
    const y = py + 2.71828e-4;
    if (x < minX || x > maxX || y < minY || y > maxY) return false;
    const cell = column(y, minY, depth) * side + column(x, minX, width);
    let crossings = 0;
    for (let k = counts[cell] as number; k < (counts[cell + 1] as number); k++) {
      const i = (binned[k] as number) * 9;
      const ax = positions[i] as number;
      const ay = positions[i + 1] as number;
      const bx = positions[i + 3] as number;
      const by = positions[i + 4] as number;
      const cx = positions[i + 6] as number;
      const cy = positions[i + 7] as number;
      // Where the point lies against the triangle seen from above (barycentric); an edge-on triangle has no area.
      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (Math.abs(area) < 1e-12) continue;
      const u = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area;
      const v = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area;
      const w = 1 - u - v;
      if (u < 0 || v < 0 || w < 0) continue;
      const height =
        u * (positions[i + 2] as number) + v * (positions[i + 5] as number) + w * (positions[i + 8] as number);
      if (height < pz) crossings++;
    }
    return crossings % 2 === 1;
  };
}
