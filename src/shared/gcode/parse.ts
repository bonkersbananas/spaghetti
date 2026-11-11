import { FEATURES, type Layer, type ToolpathFilament, type Toolpaths } from "./types.ts";

/**
 * A streaming reader for Bambu Studio's (and Orca's) plate G-code. Feed it text in any chunking with `write`, call
 * `end` for the toolpaths. It keeps extrusion moves only, ignores everything before the first layer and after the
 * last (start and end G-code), follows the active filament through T, M620 and M621, and decimates very large files
 * so the result stays small enough for a phone.
 */

export interface ParseOptions {
  /** Size of the G-code in bytes, when known: decides how hard to decimate. */
  sourceBytes?: number;
  /** The slicer's estimate in seconds (slice_info's `prediction`), when the G-code header doesn't say. */
  totalSeconds?: number;
  /** The most segments to keep (default 2 million, about 50 MB of positions). */
  maxSegments?: number;
  /** Called with each layer as it is finished, before `end`. */
  onLayer?: (layer: Layer) => void;
}

const FEATURE_IDS = new Map<string, number>();
FEATURES.forEach((name, i) => {
  FEATURE_IDS.set(name.toLowerCase(), i);
});
for (const [alias, name] of [
  ["external perimeter", "Outer wall"],
  ["perimeter", "Inner wall"],
  ["overhang perimeter", "Overhang wall"],
  ["internal infill", "Sparse infill"],
  ["internal solid infill", "Solid infill"],
  ["solid infill", "Solid infill"],
  ["top solid infill", "Top surface"],
  ["bridge infill", "Bridge"],
  ["gap fill", "Gap infill"],
  ["support material", "Support"],
  ["support material interface", "Support interface"],
  ["skirt", "Skirt and brim"],
  ["skirt/brim", "Skirt and brim"],
  ["brim", "Skirt and brim"],
  ["wipe tower", "Prime tower"],
] as const) {
  FEATURE_IDS.set(alias, FEATURE_IDS.get(name.toLowerCase()) ?? 0);
}
/** Start and end G-code draw their purge lines as "Custom": never part of the print. */
const CUSTOM = -1;

const MAX_TOOL = 64;
const DEFAULT_MAX_SEGMENTS = 2_000_000;
/** What a decimated file's moves cost in bytes of G-code, roughly, to guess how many there are before reading them. */
const BYTES_PER_MOVE = 30;
const ARC_STEP = 0.35; // radians per arc piece

class Floats {
  a = new Float32Array(1024);
  n = 0;
  push6(a: number, b: number, c: number, d: number, e: number, f: number) {
    if (this.n + 6 > this.a.length) {
      const bigger = new Float32Array(this.a.length * 2);
      bigger.set(this.a);
      this.a = bigger;
    }
    const x = this.a;
    let n = this.n;
    x[n++] = a;
    x[n++] = b;
    x[n++] = c;
    x[n++] = d;
    x[n++] = e;
    x[n++] = f;
    this.n = n;
  }
}

class Bytes {
  a = new Uint8Array(256);
  n = 0;
  push(v: number) {
    if (this.n >= this.a.length) {
      const bigger = new Uint8Array(this.a.length * 2);
      bigger.set(this.a);
      this.a = bigger;
    }
    this.a[this.n++] = v;
  }
}

interface Building {
  z: number;
  height: number;
  remainingMinutes: number | null;
  pos: Floats;
  feature: Bytes;
  filament: Bytes;
}

/** "1h 12m 3s", "2d 1h", "45m 10s" → seconds. */
export function parseDuration(text: string): number | null {
  let total = 0;
  let found = false;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/g)) {
    found = true;
    const v = Number(m[1]);
    total += v * ({ d: 86400, h: 3600, m: 60, s: 1 }[m[2] as "d"] ?? 0);
  }
  return found ? Math.round(total) : null;
}

export class GcodeReader {
  private readonly opts: ParseOptions;
  private rest = "";
  private bytes = 0;

  // The machine.
  private x = 0;
  private y = 0;
  private z = 0;
  private e = 0;
  private relativeE = true;
  private relativeXYZ = false;
  private tool = 0;
  private feature = 0;
  private inBlock = true; // false after EXECUTABLE_BLOCK_END

  // The layer being built.
  private cur: Building | null = null;
  private readonly layers: Layer[] = [];
  private seconds = new Map<number, number | null>();

  // Merging consecutive collinear or very short segments.
  private hasPending = false;
  private px0 = 0;
  private py0 = 0;
  private pz0 = 0;
  private px1 = 0;
  private py1 = 0;
  private pz1 = 0;
  private pFeature = 0;
  private pTool = 0;

  // Decimation, decided from the file's size.
  private readonly minSegment: number;
  private readonly infillStride: number;
  private infillSeen = 0;
  private readonly maxSegments: number;

  private moves = 0;
  private kept = 0;
  private truncated = false;
  private totalSeconds: number | null;
  private announced: number | null = null;
  private readonly toolSegments: number[] = [];
  private bounds: [number, number, number, number, number, number] | null = null;
  private sawLayerComment = false;

  constructor(opts: ParseOptions = {}) {
    this.opts = opts;
    this.totalSeconds = opts.totalSeconds ?? null;
    this.maxSegments = opts.maxSegments ?? DEFAULT_MAX_SEGMENTS;
    const expected = (opts.sourceBytes ?? 0) / BYTES_PER_MOVE;
    const ratio = expected / this.maxSegments;
    this.minSegment = ratio > 1 ? Math.min(2, 0.15 * ratio) : 0.04;
    this.infillStride = ratio > 2 ? Math.min(8, Math.ceil(ratio / 2)) : 1;
  }

  write(text: string): void {
    this.bytes += text.length;
    const data = this.rest ? this.rest + text : text;
    let start = 0;
    for (;;) {
      const nl = data.indexOf("\n", start);
      if (nl < 0) break;
      this.line(data, start, nl);
      start = nl + 1;
    }
    this.rest = data.slice(start);
  }

  end(plate = 1): Toolpaths {
    if (this.rest) this.line(this.rest, 0, this.rest.length);
    this.rest = "";
    this.finishLayer();
    const warnings: string[] = [];
    if (this.layers.length === 0) {
      warnings.push(
        this.sawLayerComment
          ? "The G-code has no extrusion moves"
          : "The G-code has no layer markers (is it from Bambu Studio?)",
      );
    }
    const used = Math.max(this.toolSegments.length, 1);
    const filaments: ToolpathFilament[] = Array.from({ length: used }, (_, i) => ({
      color: null,
      segments: this.toolSegments[i] ?? 0,
    }));
    const decimated = this.minSegment > 0.04 || this.infillStride > 1;
    // Elapsed time per layer, from the remaining time at its start.
    const total = this.totalSeconds ?? firstRemaining(this.seconds);
    for (const layer of this.layers) {
      const remaining = this.seconds.get(layer.index);
      layer.seconds = remaining != null && total != null ? Math.max(0, Math.round(total - remaining * 60)) : null;
    }
    return {
      plate,
      layers: this.layers,
      filaments,
      bounds: this.bounds,
      totalSeconds: total,
      announcedLayers: this.announced,
      stats: {
        segments: this.kept,
        moves: this.moves,
        decimated,
        truncated: this.truncated,
        sourceBytes: this.opts.sourceBytes ?? this.bytes,
      },
      warnings,
    };
  }

  private line(s: string, from: number, to: number): void {
    // Trim a trailing \r and leading spaces.
    while (to > from && (s.charCodeAt(to - 1) === 13 || s.charCodeAt(to - 1) === 32)) to--;
    while (from < to && s.charCodeAt(from) === 32) from++;
    if (from >= to) return;
    const c = s.charCodeAt(from);
    if (c === 59) {
      this.comment(s, from, to);
      return;
    }
    if (c === 71) {
      // G
      const next = s.charCodeAt(from + 1);
      const after = s.charCodeAt(from + 2);
      const bare = after === 32 || after === 59 || Number.isNaN(after);
      if (next === 49 && bare) {
        this.move(s, from, to);
        return;
      }
      if (next === 48 && bare) {
        this.move(s, from, to);
        return;
      }
      if ((next === 50 || next === 51) && bare) {
        this.arc(s, from, to, next === 50);
        return;
      }
      if (next === 57 && after === 50) {
        this.g92(s, from, to);
        return;
      }
      if (next === 57 && (after === 48 || after === 49)) this.relativeXYZ = after === 49; // G90 / G91
      return;
    }
    if (c === 77) {
      // M
      const code = s.slice(from + 1, Math.min(to, from + 5));
      if (code.startsWith("73 ") || code === "73") {
        this.m73(s, from, to);
        return;
      }
      if (code.startsWith("83")) {
        this.relativeE = true;
        return;
      }
      if (code.startsWith("82")) {
        this.relativeE = false;
        return;
      }
      if (code.startsWith("620 ") || code === "620") {
        this.m620(s, from, to, true);
        return;
      }
      if (code.startsWith("621 ") || code === "621") {
        this.m620(s, from, to, false);
        return;
      }
      return;
    }
    if (c === 84) {
      // T<n>
      const n = Number(s.slice(from + 1, to).split(/[ ;]/)[0]);
      if (Number.isInteger(n) && n >= 0 && n < MAX_TOOL) this.setTool(n);
    }
  }

  private comment(s: string, from: number, to: number): void {
    // "; FEATURE: Outer wall", ";TYPE:External perimeter"
    let at = from + 1;
    if (s.charCodeAt(at) === 32) at++;
    const c = s.charCodeAt(at);
    if (c === 70 && s.startsWith("FEATURE:", at)) {
      this.setFeature(s.slice(at + 8, to).trim());
      return;
    }
    if (c === 84 && s.startsWith("TYPE:", at)) {
      this.setFeature(s.slice(at + 5, to).trim());
      return;
    }
    if (c === 67 && s.startsWith("CHANGE_LAYER", at)) {
      this.startLayer();
      return;
    }
    if (c === 76 && s.startsWith("LAYER_CHANGE", at)) {
      this.startLayer();
      return;
    }
    if (c === 90 && s.startsWith("Z_HEIGHT:", at)) {
      this.setZ(Number(s.slice(at + 9, to)));
      return;
    }
    if (c === 90 && s.charCodeAt(at + 1) === 58) {
      this.setZ(Number(s.slice(at + 2, to)));
      return;
    }
    if (c === 76 && s.startsWith("LAYER_HEIGHT:", at)) {
      this.setHeight(Number(s.slice(at + 13, to)));
      return;
    }
    if (c === 72 && s.startsWith("HEIGHT:", at)) {
      this.setHeight(Number(s.slice(at + 7, to)));
      return;
    }
    if (c === 108 && s.startsWith("layer num/total_layer_count:", at)) {
      const m = /(\d+)\s*\/\s*(\d+)/.exec(s.slice(at + 28, to));
      if (m) this.announced = Number(m[2]);
      return;
    }
    if (c === 69 && s.startsWith("EXECUTABLE_BLOCK_END", at)) {
      this.flush();
      this.inBlock = false;
      return;
    }
    if (c === 69 && s.startsWith("EXECUTABLE_BLOCK_START", at)) {
      this.inBlock = true;
      return;
    }
    if (this.totalSeconds == null && this.cur == null) {
      if (c === 116 && s.startsWith("total estimated time:", at)) {
        this.totalSeconds = parseDuration(s.slice(at + 21, to));
      } else if (c === 101 && s.startsWith("estimated printing time (normal mode) =", at)) {
        this.totalSeconds = parseDuration(s.slice(at + 39, to));
      }
    }
  }

  private setFeature(name: string): void {
    this.flush();
    const lower = name.toLowerCase();
    if (lower === "custom") {
      this.feature = CUSTOM;
      return;
    }
    this.feature = FEATURE_IDS.get(lower) ?? 0;
  }

  private startLayer(): void {
    this.sawLayerComment = true;
    this.finishLayer();
    this.cur = {
      z: 0,
      height: 0,
      remainingMinutes: null,
      pos: new Floats(),
      feature: new Bytes(),
      filament: new Bytes(),
    };
  }

  private setZ(z: number): void {
    if (!Number.isFinite(z) || !this.cur) return;
    this.cur.z = z;
    // Prusa/Orca write ;Z: before ;HEIGHT:, Bambu Z_HEIGHT before LAYER_HEIGHT: both end up here.
    if (!this.cur.height) this.cur.height = z - (this.layers.at(-1)?.z ?? 0);
  }

  private setHeight(h: number): void {
    if (Number.isFinite(h) && this.cur) this.cur.height = h;
  }

  private setTool(n: number): void {
    if (n !== this.tool) this.flush();
    this.tool = n;
  }

  private m620(s: string, from: number, to: number, prepare: boolean): void {
    const m = /S(\d+)/.exec(s.slice(from, to));
    if (!m) return;
    const n = Number(m[1]);
    if (n >= MAX_TOOL) return;
    // M620 S<n>A prepares slot n, M621 S<n>A says it is loaded: the filament changes there.
    if (!prepare) this.setTool(n);
  }

  private m73(s: string, from: number, to: number): void {
    if (!this.cur || this.cur.remainingMinutes !== null) return;
    const m = /\bR(\d+(?:\.\d+)?)/.exec(s.slice(from, to));
    if (m) this.cur.remainingMinutes = Number(m[1]);
  }

  private g92(s: string, from: number, to: number): void {
    const m = /\bE(-?[\d.]+)/.exec(s.slice(from, to));
    if (m) this.e = Number(m[1]);
  }

  private move(s: string, from: number, to: number): void {
    let nx = this.x;
    let ny = this.y;
    let nz = this.z;
    let ne = Number.NaN;
    let hasXY = false;
    let i = from + 2;
    while (i < to) {
      const ch = s.charCodeAt(i);
      if (ch === 59) break;
      if (ch === 32) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < to && s.charCodeAt(j) !== 32 && s.charCodeAt(j) !== 59) j++;
      if (ch === 88 || ch === 89 || ch === 90 || ch === 69) {
        const v = Number(s.slice(i + 1, j));
        if (!Number.isNaN(v)) {
          if (ch === 88) {
            nx = this.relativeXYZ ? nx + v : v;
            hasXY = true;
          } else if (ch === 89) {
            ny = this.relativeXYZ ? ny + v : v;
            hasXY = true;
          } else if (ch === 90) nz = this.relativeXYZ ? nz + v : v;
          else ne = v;
        }
      }
      i = j;
    }
    let extruded = false;
    if (!Number.isNaN(ne)) {
      if (this.relativeE) extruded = ne > 0;
      else {
        extruded = ne > this.e;
        this.e = ne;
      }
    }
    this.line3(nx, ny, nz, extruded && hasXY);
  }

  private arc(s: string, from: number, to: number, clockwise: boolean): void {
    const part = s.slice(from, to);
    const num = (key: string, fallback: number): number => {
      const m = new RegExp(`\\b${key}(-?[\\d.]+)`).exec(part);
      return m ? Number(m[1]) : fallback;
    };
    const nx = num("X", this.x);
    const ny = num("Y", this.y);
    const nz = num("Z", this.z);
    const ne = num("E", Number.NaN);
    const ci = num("I", 0);
    const cj = num("J", 0);
    let extruded = false;
    if (!Number.isNaN(ne)) {
      if (this.relativeE) extruded = ne > 0;
      else {
        extruded = ne > this.e;
        this.e = ne;
      }
    }
    if (!extruded) {
      this.line3(nx, ny, nz, false);
      return;
    }
    const cx = this.x + ci;
    const cy = this.y + cj;
    const a0 = Math.atan2(this.y - cy, this.x - cx);
    let a1 = Math.atan2(ny - cy, nx - cx);
    if (clockwise && a1 >= a0) a1 -= 2 * Math.PI;
    if (!clockwise && a1 <= a0) a1 += 2 * Math.PI;
    const r = Math.hypot(this.x - cx, this.y - cy);
    const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / ARC_STEP));
    const z0 = this.z;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const a = a0 + (a1 - a0) * t;
      if (k === steps) this.line3(nx, ny, nz, true);
      else this.line3(cx + r * Math.cos(a), cy + r * Math.sin(a), z0 + (nz - z0) * t, true);
    }
  }

  /** Moves the nozzle to (x, y, z); with `extrude` it lays a segment. */
  private line3(x: number, y: number, z: number, extrude: boolean): void {
    const sx = this.x;
    const sy = this.y;
    const sz = this.z;
    this.x = x;
    this.y = y;
    this.z = z;
    if (!extrude) {
      this.flush();
      return;
    }
    if (!this.cur || !this.inBlock || this.feature === CUSTOM) {
      this.flush();
      return;
    }
    this.moves++;
    if (this.kept >= this.maxSegments - 1) {
      this.truncated = true;
      return;
    }
    if ((this.feature === 4 || this.feature === 5) && this.infillStride > 1) {
      // A long infill run is thinned: only every n-th line of it is drawn.
      if (!this.hasPending || this.pFeature !== this.feature) this.infillSeen++;
      if (this.infillSeen % this.infillStride !== 0) {
        this.flush();
        return;
      }
    }
    if (this.hasPending) {
      const contiguous = this.px1 === sx && this.py1 === sy && this.pz1 === sz;
      if (contiguous && this.pFeature === this.feature && this.pTool === this.tool && this.pz1 === z) {
        const dx = this.px1 - this.px0;
        const dy = this.py1 - this.py0;
        const ex = x - this.px1;
        const ey = y - this.py1;
        const len = Math.hypot(dx, dy);
        const cross = Math.abs(dx * ey - dy * ex);
        if (len < this.minSegment || (cross <= 0.01 * len * Math.hypot(ex, ey) && dx * ex + dy * ey >= 0)) {
          this.px1 = x;
          this.py1 = y;
          return;
        }
      }
      this.flush();
    }
    this.hasPending = true;
    this.px0 = sx;
    this.py0 = sy;
    this.pz0 = sz;
    this.px1 = x;
    this.py1 = y;
    this.pz1 = z;
    this.pFeature = this.feature;
    this.pTool = this.tool;
  }

  private flush(): void {
    if (!this.hasPending) return;
    this.hasPending = false;
    const cur = this.cur;
    if (!cur) return;
    cur.pos.push6(this.px0, this.py0, this.pz0, this.px1, this.py1, this.pz1);
    cur.feature.push(this.pFeature);
    cur.filament.push(this.pTool);
    this.kept++;
    this.toolSegments[this.pTool] = (this.toolSegments[this.pTool] ?? 0) + 1;
    const b = this.bounds;
    const lo = Math.min;
    const hi = Math.max;
    if (!b) {
      this.bounds = [
        lo(this.px0, this.px1),
        lo(this.py0, this.py1),
        lo(this.pz0, this.pz1),
        hi(this.px0, this.px1),
        hi(this.py0, this.py1),
        hi(this.pz0, this.pz1),
      ];
    } else {
      b[0] = lo(b[0], lo(this.px0, this.px1));
      b[1] = lo(b[1], lo(this.py0, this.py1));
      b[2] = lo(b[2], lo(this.pz0, this.pz1));
      b[3] = hi(b[3], hi(this.px0, this.px1));
      b[4] = hi(b[4], hi(this.py0, this.py1));
      b[5] = hi(b[5], hi(this.pz0, this.pz1));
    }
  }

  private finishLayer(): void {
    this.flush();
    const cur = this.cur;
    this.cur = null;
    if (!cur || cur.feature.n === 0) return;
    const index = this.layers.length;
    const layer: Layer = {
      index,
      z: cur.z,
      height: cur.height,
      seconds: null,
      count: cur.feature.n,
      pos: cur.pos.a.slice(0, cur.pos.n),
      feature: cur.feature.a.slice(0, cur.feature.n),
      filament: cur.filament.a.slice(0, cur.filament.n),
    };
    this.seconds.set(index, cur.remainingMinutes);
    this.layers.push(layer);
    this.opts.onLayer?.(layer);
  }
}

function firstRemaining(seconds: Map<number, number | null>): number | null {
  for (const v of seconds.values()) if (v != null) return v * 60;
  return null;
}

/** Reads a whole string of G-code at once (tests, small files). */
export function parseGcode(text: string, opts: ParseOptions = {}): Toolpaths {
  const r = new GcodeReader({ sourceBytes: text.length, ...opts });
  r.write(text);
  return r.end();
}
