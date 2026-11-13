/**
 * Spaghetti's own slicer beside OrcaSlicer's engine (decision 0055): what our slicer's answers mean for a slice (it
 * slices, or OrcaSlicer's engine steps in, and why), and how the app says which slicer made a slice. Pure, so the
 * slice worker, the cards and the tests share it.
 */
import { DEFAULT_SLICER } from "./defaults.ts";
import { type SlicerId, slicerWords } from "./settings.ts";
import type { FileSlice, SliceFallback } from "./types.ts";

/** Our slicer's answer for settings it can't slice yet (slicer-rs/src/wasm.rs `code`), with its words for what. */
export const RUST_UNSUPPORTED = 8;

/**
 * What our slicer's answer means: null when it sliced (0), else why OrcaSlicer's engine slices instead. `said` is
 * its summary: `{"error": "can't slice with tree supports yet"}` for a refusal. Anything else (a file it couldn't
 * read, a model it would place otherwise, a crash) is a failure on this model: OrcaSlicer's engine answers for it.
 */
export function fallbackOf(code: number, said: string): SliceFallback | null {
  if (code === 0) return null;
  if (code === RUST_UNSUPPORTED) {
    const what = unsupportedWhat(said);
    if (what) return { why: "unsupported", what };
  }
  return { why: "failed" };
}

/** "tree supports" from `{"error": "can't slice with tree supports yet"}`. */
function unsupportedWhat(said: string): string | null {
  let error: unknown;
  try {
    error = (JSON.parse(said) as { error?: unknown })?.error;
  } catch {
    return null;
  }
  if (typeof error !== "string") return null;
  const what = /can't slice with (.+?) yet/i.exec(error)?.[1]?.trim();
  return what && what.length <= 80 ? what : null;
}

/** Our slicer's notes as kept: at most eight, each a short line ("Auto Lift printed as spiral lifts"). */
export function notesOf(fallbacks: unknown): string[] {
  if (!Array.isArray(fallbacks)) return [];
  return fallbacks
    .filter((note): note is string => typeof note === "string" && !!note.trim())
    .map((note) => note.trim().slice(0, 120))
    .slice(0, 8);
}

/** Why OrcaSlicer's engine stepped in, as the rest of "Sliced by OrcaSlicer: …". */
export function fallbackWords(fallback: SliceFallback): string {
  switch (fallback.why) {
    case "unsupported":
      return `our own slicer can't do ${fallback.what ?? "these settings"} yet`;
    case "floating":
      return "our own slicer can't check for floating parts yet";
    case "unloaded":
      return "our own slicer couldn't start";
    default:
      return "our own slicer couldn't slice this one";
  }
}

/** The slicer that made a slice: its record's, else OrcaSlicer's engine (every slice from before there was a choice). */
export const slicerOf = (slice: Pick<FileSlice, "settings">): SlicerId => slice.settings.slicer ?? "orca";

/**
 * Who sliced a model, in the card's quiet line: "Sliced by Spaghetti" when the usual slicer made it, its name
 * otherwise ("Sliced by Spaghetti's own slicer"), and, where OrcaSlicer's engine stepped in for ours, why ("Sliced
 * by OrcaSlicer: our own slicer can't do tree supports yet"), unless `short` (a story card's button).
 */
export function slicedBy(
  slice: Pick<FileSlice, "settings" | "fallback">,
  { short = false, usual = DEFAULT_SLICER }: { short?: boolean; usual?: SlicerId } = {},
): string {
  if (slice.fallback) return short ? "Sliced by OrcaSlicer" : `Sliced by OrcaSlicer: ${fallbackWords(slice.fallback)}`;
  const slicer = slicerOf(slice);
  return slicer === usual ? "Sliced by Spaghetti" : `Sliced by ${slicerWords(slicer)}`;
}

/** "0.4 s", "2.3 s", "12 s", "1 min 12 s": how long a slice took, as a line says it. */
export function durationWords(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 9.95) return `${Math.max(0.1, Math.round(seconds * 10) / 10).toLocaleString("en")} s`;
  if (seconds < 59.5) return `${Math.round(seconds)} s`;
  const whole = Math.round(seconds);
  const rest = whole % 60;
  return `${Math.floor(whole / 60)} min${rest ? ` ${rest} s` : ""}`;
}

/**
 * About how long our slicer takes on a laptop, in ms, to pace its ring: it can't say how far it is while it slices
 * (one call into WebAssembly). Its time goes with the layers it slices (about 9 ms a layer in Chromium for a Benchy, 7
 * for small text, 10 for each of 12 Benchies on a plate: docs/proposals/rust-slicer.md) and a little with triangles.
 */
export function rustEstimateMs({ layers, triangles }: { layers: number; triangles: number }): number {
  return 300 + 9 * layers + triangles * 0.002;
}

/**
 * How far along a step that can't say is, from how long it has run and about how long it takes: quick at first,
 * slowing as it nears the end, never there (0.97 at most), so a slow phone's ring still moves without lying that it is
 * done.
 */
export const pacedFraction = (elapsedMs: number, expectedMs: number) =>
  Math.min(0.97, 1 - Math.exp((-1.6 * elapsedMs) / Math.max(1, expectedMs)));
