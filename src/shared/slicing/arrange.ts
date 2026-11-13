/**
 * Puts a model's objects on the plate: each resting on the bed, laid out in rows around the plate's centre with a
 * gap between them (a simple shelf packing; nothing is turned). Orca's own arrangement lives in its GUI, which the
 * engine doesn't have, so this is ours.
 */

export interface PlateArea {
  /** The printable area's corners, in mm (the machine's `printable_area`). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Most printable height, in mm. */
  height: number;
}

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

/** How far apart objects are put, in mm. */
export const ARRANGE_GAP = 6;

/** "0x0,256x0,256x256,0x256" or ["0x0", "256x0", …] and a height → the plate's area. */
export function plateArea(
  printableArea: string | string[] | undefined,
  printableHeight: string | undefined,
): PlateArea {
  const points = [printableArea ?? "0x0,256x0,256x256,0x256"]
    .flat()
    .join(",")
    .split(",")
    .map((point) => point.trim().split("x").map(Number))
    .filter((point) => point.length === 2 && point.every(Number.isFinite)) as [number, number][];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
    height: Number(printableHeight) || 250,
  };
}

export function boundsOf(positions: Float32Array): Box {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i] as number;
    const y = positions[i + 1] as number;
    const z = positions[i + 2] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function unionOf(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  return {
    min: [
      Math.min(...boxes.map((box) => box.min[0])),
      Math.min(...boxes.map((box) => box.min[1])),
      Math.min(...boxes.map((box) => box.min[2])),
    ],
    max: [
      Math.max(...boxes.map((box) => box.max[0])),
      Math.max(...boxes.map((box) => box.max[1])),
      Math.max(...boxes.map((box) => box.max[2])),
    ],
  };
}

export function translate(positions: Float32Array, dx: number, dy: number, dz: number): void {
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i] as number) + dx;
    positions[i + 1] = (positions[i + 1] as number) + dy;
    positions[i + 2] = (positions[i + 2] as number) + dz;
  }
}

export type ArrangeProblem = "too-big" | "too-tall" | "too-many";

/** Whether every object already sits inside the plate's area (a project laid out by its slicer). */
export function fitsAsPlaced(boxes: Box[], plate: PlateArea): boolean {
  return boxes.every(
    (box) =>
      box.min[0] >= plate.minX - 0.01 &&
      box.max[0] <= plate.maxX + 0.01 &&
      box.min[1] >= plate.minY - 0.01 &&
      box.max[1] <= plate.maxY + 0.01 &&
      box.max[2] - box.min[2] <= plate.height,
  );
}

/**
 * Moves each object (its positions, in place) onto the plate: on the bed, in rows from the back, centred. Returns
 * why it can't when an object is too big for the plate, too tall, or they don't all fit together.
 */
export function arrangeOnPlate(objects: { positions: Float32Array }[], plate: PlateArea): ArrangeProblem | null {
  const width = plate.maxX - plate.minX;
  const depth = plate.maxY - plate.minY;
  const items = objects.map((object) => ({ object, box: boundsOf(object.positions) }));
  for (const { box } of items) {
    const w = box.max[0] - box.min[0];
    const d = box.max[1] - box.min[1];
    if (w > width || d > depth) return "too-big";
    if (box.max[2] - box.min[2] > plate.height) return "too-tall";
  }
  // Deepest first, so each row is as shallow as it can be.
  const sorted = [...items].sort((a, b) => b.box.max[1] - b.box.min[1] - (a.box.max[1] - a.box.min[1]));
  const rows: { items: typeof items; width: number; depth: number }[] = [];
  let row: (typeof rows)[number] = { items: [], width: 0, depth: 0 };
  for (const item of sorted) {
    const w = item.box.max[0] - item.box.min[0];
    const d = item.box.max[1] - item.box.min[1];
    const grown = row.width + (row.items.length ? ARRANGE_GAP : 0) + w;
    if (row.items.length && grown > width) {
      rows.push(row);
      row = { items: [], width: 0, depth: 0 };
    }
    row.width += (row.items.length ? ARRANGE_GAP : 0) + w;
    row.depth = Math.max(row.depth, d);
    row.items.push(item);
  }
  rows.push(row);
  const total = rows.reduce((sum, r) => sum + r.depth, 0) + ARRANGE_GAP * (rows.length - 1);
  if (total > depth) return "too-many";
  const centreX = (plate.minX + plate.maxX) / 2;
  const centreY = (plate.minY + plate.maxY) / 2;
  // Rows go from the back of the plate (high y) to the front, each centred across.
  let top = centreY + total / 2;
  for (const r of rows) {
    let x = centreX - r.width / 2;
    for (const { object, box } of r.items) {
      const w = box.max[0] - box.min[0];
      const d = box.max[1] - box.min[1];
      translate(object.positions, x - box.min[0], top - (r.depth + d) / 2 - box.min[1], -box.min[2]);
      x += w + ARRANGE_GAP;
    }
    top -= r.depth + ARRANGE_GAP;
  }
  return null;
}
