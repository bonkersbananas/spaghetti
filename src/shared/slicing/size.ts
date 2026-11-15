/**
 * A sliced model's size: the width (X), depth (Y) and height (Z) of what it prints, for one copy, as slicers report an
 * object's size: its mesh's extents as it stands on the plate (after any turn or scaling), without the brim, skirt,
 * prime tower, supports or purge, which are toolpaths and not part of the mesh. Both slicers' `.gcode.3mf` carry the
 * mesh in `3D/3dmodel.model`, so the size is read from there, or taken from the placed objects when the slice is made.
 */
import type { Box } from "./arrange.ts";

/** Width, depth, height in mm. */
export type Size = [number, number, number];

/** The extents of boxes together (everything on the plate, if there are several objects). */
export function sizeOfBoxes(boxes: readonly Box[]): Size | null {
  if (!boxes.length) return null;
  const size: Size = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const low = Math.min(...boxes.map((box) => box.min[axis] as number));
    const high = Math.max(...boxes.map((box) => box.max[axis] as number));
    if (!Number.isFinite(low + high)) return null;
    size[axis] = rounded(high - low);
  }
  return size[0] > 0 || size[1] > 0 || size[2] > 0 ? size : null;
}

const rounded = (mm: number) => Math.round(mm * 100) / 100;

/** "29.96", "11.5", "11.35": up to two decimals, trailing zeros trimmed. */
export const mmWords = (mm: number) => String(rounded(mm));

/** "29.96 × 11.5 × 11.35 mm". */
export const sizeWords = (size: Size) => `${size.map(mmWords).join(" × ")} mm`;

/** "Width 29.96 mm, depth 11.5 mm, height 11.35 mm", for screen readers. */
export const sizeSpoken = (size: Size) =>
  `Width ${mmWords(size[0])} mm, depth ${mmWords(size[1])} mm, height ${mmWords(size[2])} mm`;

/** Only a size that is three finite, non-negative numbers. */
export function readSize(value: unknown): Size | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  return value.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) ? (value as Size) : undefined;
}

type Matrix = number[]; // 3MF's 12 numbers: m00 m01 m02 m10 m11 m12 m20 m21 m22 tx ty tz (row vectors)

const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

function matrixOf(attribute: string | undefined): Matrix {
  const values = (attribute ?? "").trim().split(/\s+/).map(Number);
  return values.length === 12 && values.every(Number.isFinite) ? values : IDENTITY;
}

/** `a` first, then `b` (3MF's row-vector convention). */
function after(a: Matrix, b: Matrix): Matrix {
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out.push(
        (a[row * 3] as number) * (b[col] as number) +
          (a[row * 3 + 1] as number) * (b[3 + col] as number) +
          (a[row * 3 + 2] as number) * (b[6 + col] as number),
      );
    }
  }
  for (let col = 0; col < 3; col++) {
    out.push(
      (a[9] as number) * (b[col] as number) +
        (a[10] as number) * (b[3 + col] as number) +
        (a[11] as number) * (b[6 + col] as number) +
        (b[9 + col] as number),
    );
  }
  return out;
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

interface ModelObject {
  vertices: number[];
  components: { id: string; matrix: Matrix }[];
}

/**
 * The size of the first copy of what a `3D/3dmodel.model` puts on the plate: every build item with its transform
 * (and its components'), the first `1 / copies` of them (copies are appended after the originals, in order). Null
 * when the file has no mesh.
 */
export function sizeFromModelXml(xml: string, copies = 1): Size | null {
  const objects = new Map<string, ModelObject>();
  for (const match of xml.matchAll(/<object\b([^>]*?)(?:\/>|>([\s\S]*?)<\/object>)/g)) {
    const id = attr(match[1] ?? "", "id");
    if (!id) continue;
    const body = match[2] ?? "";
    const vertices: number[] = [];
    for (const v of body.matchAll(/<vertex\b[^>]*>/g)) {
      const tag = v[0];
      vertices.push(Number(attr(tag, "x")), Number(attr(tag, "y")), Number(attr(tag, "z")));
    }
    const components = [...body.matchAll(/<component\b[^>]*>/g)].flatMap((c) => {
      const objectid = attr(c[0], "objectid");
      return objectid ? [{ id: objectid, matrix: matrixOf(attr(c[0], "transform")) }] : [];
    });
    objects.set(id, { vertices, components });
  }
  const items = [...xml.matchAll(/<item\b[^>]*>/g)].flatMap((item) => {
    const objectid = attr(item[0], "objectid");
    return objectid ? [{ id: objectid, matrix: matrixOf(attr(item[0], "transform")) }] : [];
  });
  if (!items.length) return null;
  const one = copies > 1 && items.length % copies === 0 ? items.length / copies : items.length;

  const boxes: Box[] = [];
  const add = (id: string, matrix: Matrix, depth: number) => {
    const object = objects.get(id);
    if (!object || depth > 8) return;
    const v = object.vertices;
    if (v.length >= 3) {
      const box: Box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (let i = 0; i + 2 < v.length; i += 3) {
        const x = v[i] as number;
        const y = v[i + 1] as number;
        const z = v[i + 2] as number;
        for (let axis = 0; axis < 3; axis++) {
          const at =
            x * (matrix[axis] as number) +
            y * (matrix[3 + axis] as number) +
            z * (matrix[6 + axis] as number) +
            (matrix[9 + axis] as number);
          if (at < (box.min[axis] as number)) box.min[axis] = at;
          if (at > (box.max[axis] as number)) box.max[axis] = at;
        }
      }
      boxes.push(box);
    }
    for (const component of object.components) add(component.id, after(component.matrix, matrix), depth + 1);
  };
  for (const item of items.slice(0, one)) add(item.id, item.matrix, 0);
  return sizeOfBoxes(boxes);
}
