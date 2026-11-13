/**
 * Reads an STL (binary or ASCII) into a triangle soup: nine floats a triangle, in the file's own units (taken as
 * millimetres, as slicers do). Never throws: a file that isn't an STL gives `null`.
 */

export interface StlMesh {
  /** x y z of each corner, three corners a triangle. */
  positions: Float32Array;
  triangles: number;
}

const BINARY_HEADER = 84;
const BINARY_TRIANGLE = 50;

export function readStl(input: Uint8Array): StlMesh | null {
  if (input.byteLength < 15) return null;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const count = input.byteLength >= BINARY_HEADER ? view.getUint32(80, true) : -1;
  const binarySize = BINARY_HEADER + count * BINARY_TRIANGLE;
  // A binary file whose header starts with "solid" (some exporters write that) still has the exact size.
  if (count > 0 && binarySize === input.byteLength) return readBinary(view, count);
  if (startsWithSolid(input)) {
    const ascii = readAscii(input);
    if (ascii) return ascii;
  }
  // Some binary writers leave a few bytes after the last triangle.
  if (count > 0 && binarySize < input.byteLength && binarySize > BINARY_HEADER) return readBinary(view, count);
  return null;
}

function startsWithSolid(input: Uint8Array): boolean {
  let at = 0;
  while (at < input.length && (input[at] === 0x20 || input[at] === 0x09 || input[at] === 0x0a || input[at] === 0x0d))
    at++;
  return new TextDecoder().decode(input.subarray(at, at + 5)).toLowerCase() === "solid";
}

function readBinary(view: DataView, count: number): StlMesh | null {
  const positions = new Float32Array(count * 9);
  let kept = 0;
  for (let t = 0; t < count; t++) {
    const at = BINARY_HEADER + t * BINARY_TRIANGLE + 12;
    let finite = true;
    for (let k = 0; k < 9; k++) {
      const value = view.getFloat32(at + k * 4, true);
      if (!Number.isFinite(value)) finite = false;
      positions[kept * 9 + k] = value;
    }
    if (finite) kept++;
  }
  if (kept === 0) return null;
  return { positions: kept === count ? positions : positions.slice(0, kept * 9), triangles: kept };
}

function readAscii(input: Uint8Array): StlMesh | null {
  const text = new TextDecoder().decode(input);
  const values: number[] = [];
  let at = 0;
  for (;;) {
    at = text.indexOf("vertex", at);
    if (at < 0) break;
    at += 6;
    for (let k = 0; k < 3; k++) {
      while (at < text.length && isSpace(text.charCodeAt(at))) at++;
      let end = at;
      while (end < text.length && !isSpace(text.charCodeAt(end))) end++;
      values.push(Number(text.slice(at, end)));
      at = end;
    }
  }
  const triangles = Math.floor(values.length / 9);
  if (triangles === 0) return null;
  const positions = new Float32Array(triangles * 9);
  let kept = 0;
  for (let t = 0; t < triangles; t++) {
    let finite = true;
    for (let k = 0; k < 9; k++) {
      const value = values[t * 9 + k] as number;
      if (!Number.isFinite(value)) finite = false;
      positions[kept * 9 + k] = value;
    }
    if (finite) kept++;
  }
  if (kept === 0) return null;
  return { positions: kept === triangles ? positions : positions.slice(0, kept * 9), triangles: kept };
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}
