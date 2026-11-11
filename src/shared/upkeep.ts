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

/** How far through the nearer limit, for the row under the name: "12 of 20 print hours", "30 of 60 days". */
export function progressWords(
  task: UpkeepInterval,
  status: UpkeepStatus,
  sinceHours: number,
  sinceDays: number,
): string {
  if (status.by === "hours" && task.intervalHours) {
    return `${Math.floor(sinceHours)} of ${task.intervalHours} print ${task.intervalHours === 1 ? "hour" : "hours"}`;
  }
  if (status.by === "days" && task.intervalDays) {
    return `${Math.floor(sinceDays)} of ${task.intervalDays} ${task.intervalDays === 1 ? "day" : "days"}`;
  }
  return "";
}

/** "42 print hours", "1 h", "3 days": the meter's label for a task. */
export function formatHours(hours: number): string {
  if (hours < 10) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round(hours).toLocaleString("en")} h`;
}

/** "Clean the build plate" → "clean the build plate", for use inside a sentence. */
export const lowerFirst = (text: string) => (text ? text[0]?.toLowerCase() + text.slice(1) : text);

/** "it's been 19 days" or "it's been 42 print hours": how long since, the way a person would say it. */
export function sinceSentence(status: UpkeepStatus, sinceHours: number, sinceDays: number): string {
  if (status.by === "days") {
    const days = Math.floor(sinceDays);
    return days === 0 ? "it's been less than a day" : `it's been ${days} ${days === 1 ? "day" : "days"}`;
  }
  const hours = Math.floor(sinceHours);
  return `it's been ${hours} print ${hours === 1 ? "hour" : "hours"}`;
}

/**
 * The one quiet line for Today, or null when nothing is due: "Clean the build plate: it's been 19 days", and when
 * more are due, `more` says so ("1 more due") for a quiet second part.
 */
export function dueLine(
  due: ReadonlyArray<{ name: string; status: UpkeepStatus; sinceHours: number; sinceDays: number }>,
): { text: string; more: string | null } | null {
  const [first] = [...due].sort((a, b) => b.status.fraction - a.status.fraction);
  if (!first) return null;
  const more = due.length - 1;
  return {
    text: `${first.name}: ${sinceSentence(first.status, first.sinceHours, first.sinceDays)}`,
    more: more > 0 ? `${more} more due` : null,
  };
}
