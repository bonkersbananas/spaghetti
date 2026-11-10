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
