/** Printer upkeep: print hours, what is due, and the starting list of tasks. Pure, so the Worker, the app and the tests agree. */
import type { Outcome } from "./attempts.ts";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** An attempt the bridge saw end can't have run longer than this (a forgotten bridge message shouldn't add weeks). */
const MAX_BRIDGE_MINUTES = 7 * 24 * 60;

/** What the hours need from an attempt. */
export interface HoursAttempt {
  /** When it started, epoch ms. */
  printedAt: number;
  /** When the printer bridge saw it come off the bed, epoch ms. */
  endedAt: number | null;
  outcome: Outcome | null;
  settings: { actualMinutes?: number; estimatedMinutes?: number; failedAtPercent?: number };
}

/**
 * How long an attempt kept the printer busy, in minutes. People's own actual time wins, then the bridge's
 * (started to off the bed: the printer's own clock), then the slicer's estimate (only as far as a failed print
 * got). A print still going has run for as long as it has been, never past its estimate.
 */
export function attemptMinutes(attempt: HoursAttempt, now: number): number {
  const { actualMinutes, estimatedMinutes, failedAtPercent } = attempt.settings;
  if (actualMinutes !== undefined && actualMinutes >= 0) return actualMinutes;
  if (attempt.endedAt !== null) {
    const minutes = (attempt.endedAt - attempt.printedAt) / MINUTE;
    if (minutes > 0) return Math.min(minutes, MAX_BRIDGE_MINUTES);
  }
  if (attempt.outcome === null && attempt.endedAt === null) {
    const elapsed = Math.max(0, (now - attempt.printedAt) / MINUTE);
    return estimatedMinutes !== undefined ? Math.min(elapsed, estimatedMinutes) : 0;
  }
  if (estimatedMinutes !== undefined && estimatedMinutes > 0) {
    const ran = failedAtPercent === undefined ? 1 : Math.min(1, Math.max(0, failedAtPercent / 100));
    return estimatedMinutes * ran;
  }
  return 0;
}

/** The printer's running total, in hours, of the attempts that started before `until` (default: all of them). */
export function printHours(attempts: readonly HoursAttempt[], now: number, until = Number.POSITIVE_INFINITY): number {
  let minutes = 0;
  for (const attempt of attempts) {
    if (attempt.printedAt < until) minutes += attemptMinutes(attempt, now);
  }
  return minutes / 60;
}

export interface UpkeepInterval {
  intervalHours: number | null;
  intervalDays: number | null;
}

export interface UpkeepStatus {
  /** How far through the interval, 0 and up (1 is due). The larger of the hours' and the days' share. */
  fraction: number;
  due: boolean;
  /** Which limit is nearer: what the meter and the words talk about. */
  by: "hours" | "days" | null;
}

/** Where a task stands: `sinceHours` of printing and `sinceDays` of calendar since it was last done (or began). */
export function upkeepStatus(task: UpkeepInterval, sinceHours: number, sinceDays: number): UpkeepStatus {
  const hours = task.intervalHours ? sinceHours / task.intervalHours : null;
  const days = task.intervalDays ? sinceDays / task.intervalDays : null;
  if (hours === null && days === null) return { fraction: 0, due: false, by: null };
  const byHours = hours !== null && (days === null || hours >= days);
  const fraction = Math.max(0, byHours ? (hours ?? 0) : (days ?? 0));
  return { fraction, due: fraction >= 1, by: byHours ? "hours" : "days" };
}

export const daysBetween = (from: number, to: number) => Math.max(0, (to - from) / DAY);

export interface UpkeepBase extends UpkeepInterval {
  /** The printer's hours when it was last done, or null if never. */
  lastHours: number | null;
  lastAt: number | null;
  createdAt: number;
}

/**
 * How long since a task was done: from its last "Done", or, for one never done, from when it was added
 * (so a new list doesn't start with everything due after years of printing).
 */
export function sinceDone(task: UpkeepBase, attempts: readonly HoursAttempt[], now: number) {
  const nowHours = printHours(attempts, now);
  const baseHours = task.lastHours ?? printHours(attempts, now, task.createdAt);
  return {
    sinceHours: Math.max(0, nowHours - baseHours),
    sinceDays: daysBetween(task.lastAt ?? task.createdAt, now),
  };
}

/** "42 print hours since" or "63 days since": whichever limit the task is nearer to. */
export function sinceWords(status: UpkeepStatus, sinceHours: number, sinceDays: number): string {
  if (status.by === "days") {
    const days = Math.floor(sinceDays);
    return days === 0 ? "since today" : `${days} ${days === 1 ? "day" : "days"} since`;
  }
  const hours = Math.floor(sinceHours);
  return `${hours} print ${hours === 1 ? "hour" : "hours"} since`;
}

/** "42 print hours", "1 h", "3 days": the meter's label for a task. */
export function formatHours(hours: number): string {
  if (hours < 10) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round(hours).toLocaleString("en")} h`;
}

export interface DefaultUpkeepTask extends UpkeepInterval {
  id: string;
  name: string;
  note: string;
}

/**
 * The starting list for the X2D. The intervals come from Bambu's maintenance guidance for its other printers
 * and are not confirmed for the X2D (docs/printer.md, "Upkeep"): people edit them.
 */
export const DEFAULT_UPKEEP: readonly DefaultUpkeepTask[] = [
  {
    id: "plate",
    name: "Clean the build plate",
    note: "Warm water and a little dish soap, then dry it. Grease from fingers costs adhesion.",
    intervalHours: 20,
    intervalDays: 14,
  },
  {
    id: "nozzle",
    name: "Clean the nozzle and wiper",
    note: "Pull off any stuck filament and wipe the nozzle tip; swap the wiper if it is frayed.",
    intervalHours: 50,
    intervalDays: 30,
  },
  {
    id: "purge-chute",
    name: "Empty the purge chute",
    note: "Colour changes drop waste there; a full chute jams.",
    intervalHours: 15,
    intervalDays: 14,
  },
  {
    id: "desiccant",
    name: "Replace the AMS desiccant",
    note: "When the indicator turns, or when the AMS stops keeping filament dry.",
    intervalHours: null,
    intervalDays: 60,
  },
  {
    id: "rods",
    name: "Lubricate the rods",
    note: "A thin film of the grease that came with the printer on the linear rods; wipe off the excess.",
    intervalHours: 200,
    intervalDays: 180,
  },
  {
    id: "belts",
    name: "Check the belts",
    note: "Pluck them: both should sound alike and be tight, with no fraying.",
    intervalHours: 300,
    intervalDays: 90,
  },
  {
    id: "air-filter",
    name: "Replace the air filter",
    note: "The carbon and HEPA filter that cleans the chamber air.",
    intervalHours: 300,
    intervalDays: 90,
  },
];

/** "Clean the build plate" → "clean the build plate", for use inside a sentence. */
export const lowerFirst = (text: string) => (text ? text[0]?.toLowerCase() + text.slice(1) : text);

/** The one quiet line for Today, or null when nothing is due. */
export function dueLine(
  due: ReadonlyArray<{ name: string; status: UpkeepStatus; sinceHours: number; sinceDays: number }>,
): string | null {
  const [first] = [...due].sort((a, b) => b.status.fraction - a.status.fraction);
  if (!first) return null;
  const more = due.length - 1;
  return `Time to ${lowerFirst(first.name)}, ${sinceWords(first.status, first.sinceHours, first.sinceDays)}${
    more > 0 ? `, and ${more} more` : ""
  }.`;
}
