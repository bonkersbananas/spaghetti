// What the 3D view says under the print, in words. Pure, so tests can reach it.

// Relative, so the unit tests reach it without the app's aliases.
import { formatDuration } from "../../../shared/time.ts";

/**
 * The one line a print in progress says while the view is at the layer it has reached: "Layer 140 of 317 · 1 h 45 min
 * left". The time is the printer's own estimate (the bridge's report), else what the slicer's layer times leave.
 */
export function liveReadout(layer: number, count: number, remainingMinutes: number | null, secondsLeft: number | null) {
  const minutes = remainingMinutes ?? (secondsLeft != null ? secondsLeft / 60 : null);
  const left = minutes == null ? null : minutes >= 1 ? `${formatDuration(minutes)} left` : "nearly done";
  return [`Layer ${layer} of ${count}`, left].filter(Boolean).join(" · ");
}

/** The slider's readout for a layer: "Layer 112 of 240 · 13.4 mm · 1 h 12 min in". */
export function layerReadout(index: number, count: number, z: number | undefined, seconds: number | null | undefined) {
  const parts = [`Layer ${index + 1} of ${count}`];
  if (z !== undefined) parts.push(`${(Math.round(z * 100) / 100).toString()} mm`);
  if (seconds != null) parts.push(seconds < 60 ? "at the start" : `${formatDuration(seconds / 60)} in`);
  return parts.join(" · ");
}
