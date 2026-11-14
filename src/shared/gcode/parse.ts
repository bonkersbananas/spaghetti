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
  /** Keep the layers for `end` (default). Off, the reader only counts them and hands each to `onLayer`: a viewer that takes them as they come needs no second copy. */
  keepLayers?: boolean;
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
/**
 * The share of the budget the reader steers for, layer by layer: the rest is room for a dense stretch it only sees
 * after the fact. Kept segments can't be taken back (the viewer draws each layer as it comes), so the reader keeps
 * to the budget as it goes: what it has kept, against the share of the file it has read.
 */
const STEER_SHARE = 0.85;
/** The coarsest it goes: segments merged up to this long (mm), and one infill line in this many. */
const MAX_MIN_SEGMENT = 8;
const MAX_INFILL_STRIDE = 32;
/** Decimation's lightest setting (mm): only collinear runs and specks merge. */
const BASE_MIN_SEGMENT = 0.04;
/**
 * Segments kept back for each layer still to come, at most: should a layer be too dense for the coarsest decimation,
 * it is drawn in part rather than leave the layers above it out.
 */
const LAYER_FLOOR = 64;
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
  /** How far into the text the line being read ends. */
  private at = 0;

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
  private layerCount = 0;
  private lastZ = 0;
  private firstTotal: number | null = null;

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

  // Decimation: first guessed from the file's size, then steered at every layer so the whole print fits the budget.
  private minSegment: number;
  private infillStride: number;
  private infillSeen = 0;
  private readonly maxSegments: number;
  private everDecimated = false;
  private steeredAt = { bytes: 0, kept: 0 };
  private baseMinSegment = BASE_MIN_SEGMENT;
  private baseInfillStride = 1;
  /** The layer being read keeps segments up to this many in all, leaving room for the layers above it. */
  private layerCap = Number.POSITIVE_INFINITY;
  /** The file's own count of its layers (its header's "total layer number"). */
  private headerLayers: number | null = null;

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
    this.minSegment = ratio > 1 ? Math.min(2, 0.15 * ratio) : BASE_MIN_SEGMENT;
    this.infillStride = ratio > 2 ? Math.min(8, Math.ceil(ratio / 2)) : 1;
    this.everDecimated = this.minSegment > BASE_MIN_SEGMENT || this.infillStride > 1;
    this.baseMinSegment = this.minSegment;
    this.baseInfillStride = this.infillStride;
  }

  write(text: string): void {
    // Where `data` starts in the whole text: the decimation is steered by how far into it each line is.
    const from = this.bytes - this.rest.length;
    this.bytes += text.length;
    const data = this.rest ? this.rest + text : text;
    let start = 0;
    for (;;) {
      const nl = data.indexOf("\n", start);
      if (nl < 0) break;
      this.at = from + nl + 1;
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
    if (this.layerCount === 0) {
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
    const decimated = this.everDecimated;
    const total = this.totalSeconds ?? this.firstTotal;
    return {
      plate,
      layers: this.layers,
      filaments,
      bounds: this.bounds,
      totalSeconds: total,
      announcedLayers: this.announced,
      stats: {
        layers: this.layerCount,
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
    if (c === 116 && s.startsWith("total layer number:", at)) {
      const n = Number(s.slice(at + 19, to));
      if (Number.isInteger(n) && n > 0) this.headerLayers = n;
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
    this.steer();
    this.capLayer();
    this.cur = {
      z: 0,
      height: 0,
      remainingMinutes: null,
      pos: new Floats(),
      feature: new Bytes(),
      filament: new Bytes(),
    };
  }

  /**
   * Keeps the whole print within the budget, every layer of it: at each layer, the segments the last stretch kept for
   * each byte it read, against what the budget left allows for each byte still to come. Ahead of it, segments are
   * merged up to a longer length (and, coarse enough, infill thinned); well behind it, eased back towards the size's
   * first guess. Without the file's size there is nothing to steer by, and the first guess stands.
   */
  private steer(): void {
    const total = this.opts.sourceBytes;
    if (!total) return;
    const read = this.at - this.steeredAt.bytes;
    // Too little read since the last look to judge it by (the start G-code, a thin layer).
    if (read < total / 400) return;
    const kept = this.kept - this.steeredAt.kept;
    this.steeredAt = { bytes: this.at, kept: this.kept };
    const left = Math.max(total - this.at, total / 400);
    const room = Math.max(this.maxSegments * STEER_SHARE - this.kept, 0);
    const allowed = room / left;
    const rate = kept / read;
    if (rate > allowed) {
      const factor = Math.min(4, allowed > 0 ? rate / allowed : 4);
      this.minSegment = Math.min(MAX_MIN_SEGMENT, Math.max(this.minSegment, 0.1) * factor * 1.1);
      if (this.minSegment >= 0.5 || allowed === 0) {
        this.infillStride = Math.min(MAX_INFILL_STRIDE, Math.ceil(Math.max(this.infillStride, 1) * factor));
      }
      this.everDecimated = true;
    } else if (rate < allowed / 3 && this.minSegment > this.baseMinSegment) {
      this.minSegment = Math.max(this.baseMinSegment, this.minSegment / 1.5);
      this.infillStride = Math.max(this.baseInfillStride, Math.floor(this.infillStride / 1.5));
    }
  }

  /**
   * What the layer starting may keep: the budget less a floor for each layer still to come, counted from the file's
   * header, else guessed from the share of the file left at the layers' size so far.
   */
  private capLayer(): void {
    const total = this.opts.sourceBytes;
    const done = this.layerCount;
    let left: number;
    if (this.headerLayers !== null) left = Math.max(this.headerLayers - done - 1, 0);
    else if (total && done > 0 && this.at > 0) left = Math.ceil(((total - this.at) / this.at) * done);
    else return;
    const floor = Math.min(LAYER_FLOOR, Math.floor(this.maxSegments / (2 * (done + left + 1))));
    // Its own floor at least, should the count of layers to come have grown since the last.
    this.layerCap = Math.max(this.maxSegments - 1 - left * floor, Math.min(this.kept + floor, this.maxSegments - 1));
  }

  private setZ(z: number): void {
    if (!Number.isFinite(z) || !this.cur) return;
    this.cur.z = z;
    // Prusa/Orca write ;Z: before ;HEIGHT:, Bambu Z_HEIGHT before LAYER_HEIGHT: both end up here.
    if (!this.cur.height) this.cur.height = z - this.lastZ;
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
    if (this.kept >= this.layerCap) {
      // This layer has had its share: the rest of it gives way to the layers above.
      this.everDecimated = true;
      this.flush();
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
    const index = this.layerCount++;
    this.lastZ = cur.z;
    if (this.firstTotal === null && cur.remainingMinutes !== null) this.firstTotal = cur.remainingMinutes * 60;
    const total = this.totalSeconds ?? this.firstTotal;
    const layer: Layer = {
      index,
      z: cur.z,
      height: cur.height,
      seconds:
        cur.remainingMinutes !== null && total !== null
          ? Math.max(0, Math.round(total - cur.remainingMinutes * 60))
          : null,
      count: cur.feature.n,
      pos: cur.pos.a.slice(0, cur.pos.n),
      feature: cur.feature.a.slice(0, cur.feature.n),
      filament: cur.filament.a.slice(0, cur.filament.n),
    };
    if (this.opts.keepLayers !== false) this.layers.push(layer);
    this.opts.onLayer?.(layer);
  }
}

/** Reads a whole string of G-code at once (tests, small files). */
export function parseGcode(text: string, opts: ParseOptions = {}): Toolpaths {
  const r = new GcodeReader({ sourceBytes: text.length, ...opts });
  r.write(text);
  return r.end();
}
