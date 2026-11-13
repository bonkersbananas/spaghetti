/**
 * Draws the plate picture of a sliced model: the objects as they sit on the plate, seen from the front and above,
 * in the filament's colour, on a clear background, like the pictures Bambu Studio and Orca put in their files
 * (their command line has no renderer). A small software rasterizer (z-buffer, flat Lambert shading, 2×
 * supersampling), so it runs in any worker, with no WebGL. Returns RGBA pixels for an `ImageData`.
 */

export interface RenderOptions {
  /** Width and height of the picture, in pixels. */
  size: number;
  /** "#rrggbb" */
  colour: string;
  /** Each object's own colour, by index, where it has one (a project's filaments). */
  colours?: (string | undefined)[];
  /** Degrees round the vertical from the front (negative looks from the left). */
  azimuth?: number;
  /** Degrees above the plate. */
  elevation?: number;
}

/** The view Orca's plate pictures use, more or less: from the front left, looking down at 35°. */
const AZIMUTH = -30;
const ELEVATION = 35;
const SUPERSAMPLE = 2;
const MARGIN = 0.1;

export function renderPlate(objects: Float32Array[], options: RenderOptions): Uint8ClampedArray {
  const size = options.size;
  const big = size * SUPERSAMPLE;
  const az = ((options.azimuth ?? AZIMUTH) * Math.PI) / 180;
  const el = ((options.elevation ?? ELEVATION) * Math.PI) / 180;
  // Camera basis: forward looks from the viewer into the scene; x right and y up on screen.
  const forward: [number, number, number] = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), -Math.sin(el)];
  const right: [number, number, number] = [Math.cos(az), -Math.sin(az), 0];
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ] as [number, number, number];
  // A key light from the upper left front, a fill from the right, and some light from everywhere.
  const key = normalize([-0.45, -0.6, 0.75]);
  const fill = normalize([0.7, -0.2, 0.3]);
  const base = rgb(options.colour);

  // Screen extent of everything, to fit it in the frame.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const positions of objects) {
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] as number;
      const y = positions[i + 1] as number;
      const z = positions[i + 2] as number;
      const sx = x * right[0] + y * right[1];
      const sy = x * up[0] + y * up[1] + z * up[2];
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }
  }
  const out = new Uint8ClampedArray(size * size * 4);
  if (!Number.isFinite(minX)) return out;
  const extent = Math.max(maxX - minX, maxY - minY, 1e-3);
  const scale = (big * (1 - 2 * MARGIN)) / extent;
  const offsetX = big / 2 - ((minX + maxX) / 2) * scale;
  const offsetY = big / 2 + ((minY + maxY) / 2) * scale;

  const depth = new Float32Array(big * big).fill(Infinity);
  const colour = new Uint32Array(big * big);
  for (const [index, positions] of objects.entries()) {
    const own = options.colours?.[index];
    const [r0, g0, b0] = own ? rgb(own) : base;
    for (let t = 0; t + 8 < positions.length; t += 9) {
      const ax = positions[t] as number;
      const ay = positions[t + 1] as number;
      const az0 = positions[t + 2] as number;
      const bx = positions[t + 3] as number;
      const by = positions[t + 4] as number;
      const bz = positions[t + 5] as number;
      const cx = positions[t + 6] as number;
      const cy = positions[t + 7] as number;
      const cz = positions[t + 8] as number;
      // Face normal (corners in STL order are counter-clockwise from outside).
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az0;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az0;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (length === 0) continue;
      nx /= length;
      ny /= length;
      nz /= length;
      // Faces turned away still draw (a model with flipped faces stays whole), lit as if they faced us.
      if (nx * forward[0] + ny * forward[1] + nz * forward[2] > 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const lambert =
        0.38 +
        0.55 * Math.max(0, nx * key[0] + ny * key[1] + nz * key[2]) +
        0.2 * Math.max(0, nx * fill[0] + ny * fill[1] + nz * fill[2]);
      const shade = Math.min(1.08, lambert);
      const packed =
        (Math.min(255, Math.round(r0 * shade)) << 16) |
        (Math.min(255, Math.round(g0 * shade)) << 8) |
        Math.min(255, Math.round(b0 * shade));

      // To the screen: x right, y down; depth along forward.
      const p0x = offsetX + (ax * right[0] + ay * right[1]) * scale;
      const p0y = offsetY - (ax * up[0] + ay * up[1] + az0 * up[2]) * scale;
      const p0z = ax * forward[0] + ay * forward[1] + az0 * forward[2];
      const p1x = offsetX + (bx * right[0] + by * right[1]) * scale;
      const p1y = offsetY - (bx * up[0] + by * up[1] + bz * up[2]) * scale;
      const p1z = bx * forward[0] + by * forward[1] + bz * forward[2];
      const p2x = offsetX + (cx * right[0] + cy * right[1]) * scale;
      const p2y = offsetY - (cx * up[0] + cy * up[1] + cz * up[2]) * scale;
      const p2z = cx * forward[0] + cy * forward[1] + cz * forward[2];
      const area = (p1x - p0x) * (p2y - p0y) - (p1y - p0y) * (p2x - p0x);
      if (area === 0) continue;
      const x0 = Math.max(0, Math.floor(Math.min(p0x, p1x, p2x)));
      const x1 = Math.min(big - 1, Math.ceil(Math.max(p0x, p1x, p2x)));
      const y0 = Math.max(0, Math.floor(Math.min(p0y, p1y, p2y)));
      const y1 = Math.min(big - 1, Math.ceil(Math.max(p0y, p1y, p2y)));
      for (let py = y0; py <= y1; py++) {
        const sy = py + 0.5;
        for (let px = x0; px <= x1; px++) {
          const sx = px + 0.5;
          const w0 = ((p1x - sx) * (p2y - sy) - (p1y - sy) * (p2x - sx)) / area;
          const w1 = ((p2x - sx) * (p0y - sy) - (p2y - sy) * (p0x - sx)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * p0z + w1 * p1z + w2 * p2z;
          const at = py * big + px;
          if (z < (depth[at] as number)) {
            depth[at] = z;
            colour[at] = packed;
          }
        }
      }
    }
  }

  // Down to the picture's size: each pixel averages its block, and how much of it was covered becomes alpha.
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let dy = 0; dy < SUPERSAMPLE; dy++) {
        for (let dx = 0; dx < SUPERSAMPLE; dx++) {
          const at = (y * SUPERSAMPLE + dy) * big + x * SUPERSAMPLE + dx;
          if (depth[at] === Infinity) continue;
          const c = colour[at] as number;
          r += (c >> 16) & 255;
          g += (c >> 8) & 255;
          b += c & 255;
          covered++;
        }
      }
      if (!covered) continue;
      const o = (y * size + x) * 4;
      out[o] = r / covered;
      out[o + 1] = g / covered;
      out[o + 2] = b / covered;
      out[o + 3] = (255 * covered) / samples;
    }
  }
  return out;
}

function normalize(v: [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  const value = m?.[1] ? Number.parseInt(m[1], 16) : 0xf2754e;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
