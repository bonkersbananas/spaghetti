/**
 * How far along a printing attempt is, from when it started and the slicer's
 * estimate. Pure, so unit tests and every screen (the attempt entry, the
 * build card, Today, the sidebar) say the same thing. Never draws progress
 * the app can't know: without an estimate there is no fraction.
 */
import { formatDuration } from "./time.ts";

const MINUTE = 60_000;
/** Under this much time left the label counts down; above it, it names a time. */
const COUNTDOWN_UNDER = 90 * MINUTE;

export type PrintProgressState = "running" | "due" | "unknown";

export interface PrintProgressResult {
  /** 0–1, or null when there is no estimate to measure against. */
  fraction: number | null;
  state: PrintProgressState;
  /** "About 45 min left", "Done around 10:38", "Should be done by now", "On the bed now". */
  label: string;
  /** The printer's own layer (counting from 1) and the file's total, when it reported them. */
  layer?: number;
  totalLayers?: number;
}

/** The clock time a print is due, written like every other time in the app (the journal's "9:00 AM"): no leading zero. */
function clockTime(time: number): string {
  return new Date(time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "About 45 min left" when it's close, else "Done around 10:38". Undefined once it is due. */
export function doneBy(startedAt: number, estimatedMinutes: number, now: number): string | undefined {
  const end = startedAt + estimatedMinutes * MINUTE;
  const left = end - now;
  if (left <= 0) return undefined;
  if (left < COUNTDOWN_UNDER) return `About ${formatDuration(Math.max(1, left / MINUTE))} left`;
  return `Done around ${clockTime(end)}`;
}

export function printProgress(
  startedAt: number,
  estimatedMinutes: number | undefined,
  now: number,
): PrintProgressResult {
  if (!estimatedMinutes || estimatedMinutes <= 0) {
    return { fraction: null, state: "unknown", label: "On the bed now" };
  }
  const label = doneBy(startedAt, estimatedMinutes, now);
  if (label === undefined) return { fraction: 1, state: "due", label: "Should be done by now" };
  const fraction = Math.min(1, Math.max(0, (now - startedAt) / (estimatedMinutes * MINUTE)));
  return { fraction, state: "running", label };
}

/** What the printer reported (the bridge, via the app): see `BridgeProgress` in bridge.ts. */
export interface LiveProgress {
  percent: number;
  remainingMinutes: number | null;
  layer: number | null;
  totalLayers: number | null;
  /** When the app heard it, epoch ms. */
  at: number;
}

/** A report counts as live for this long after it arrived: the bridge sends one at least every minute. */
export const LIVE_FRESH_MS = 3 * MINUTE;

/**
 * The printer's own progress, as the same shape `printProgress` gives: "Layer 112 of 240 · about 38 min left".
 * Null once the report is old (the bridge went quiet), so the slicer's estimate takes over again without a fuss.
 */
export function livePrintProgress(live: LiveProgress | null | undefined, now: number): PrintProgressResult | null {
  if (!live || now - live.at > LIVE_FRESH_MS) return null;
  const parts: string[] = [];
  if (live.layer !== null && live.totalLayers !== null && live.totalLayers > 0) {
    parts.push(`Layer ${live.layer} of ${live.totalLayers}`);
  }
  if (live.remainingMinutes !== null) {
    parts.push(
      live.remainingMinutes > 0 ? `about ${formatDuration(Math.max(1, live.remainingMinutes))} left` : "nearly done",
    );
  }
  const text = parts.join(" · ");
  const label = text ? text.charAt(0).toUpperCase() + text.slice(1) : `${Math.round(live.percent)}% done`;
  const layers =
    live.layer !== null && live.totalLayers !== null && live.totalLayers > 0
      ? { layer: live.layer, totalLayers: live.totalLayers }
      : {};
  return { fraction: Math.min(1, Math.max(0, live.percent / 100)), state: "running", label, ...layers };
}

/**
 * A print that stopped on the printer and waits for someone to say how it went: no outcome, but the bridge saw
 * it end. Calm, not an alarm: "Off the bed at 10:42 · how did it go?".
 */
export const isOffTheBed = (attempt: { outcome: unknown; endedAt: number | null }) =>
  attempt.outcome === null && attempt.endedAt !== null;

export function offTheBedLabel(endedAt: number): string {
  return `Off the bed at ${clockTime(endedAt)}`;
}
