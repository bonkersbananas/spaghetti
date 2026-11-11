/**
 * The week in Spaghetti (decision 0030): Monday to Sunday in the workspace's time zone, the shapes the page and
 * the API share, and the few pure rules both sides need (which week a moment is in, where it starts and ends,
 * and the words for the push). Pure and Intl-only, so the browser, the Worker and the unit tests agree.
 */
import type { Outcome } from "./attempts.ts";

/** The two of you live in one place: weeks begin and end by this clock, not by whoever's phone is asking. */
export const WORKSPACE_TIME_ZONE = "Europe/Stockholm";

/** "Your week" goes out on Sunday at this hour, workspace time. */
export const WEEK_PUSH_HOUR = 19;
/** A run of the cron that comes late (a hiccup) still sends until this hour; after it the week is left to be read. */
export const WEEK_PUSH_UNTIL_HOUR = 22;

const DAY = 24 * 60 * 60 * 1000;

const pad = (value: number) => String(value).padStart(2, "0");
const iso = (utc: number) => {
  const date = new Date(utc);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};
/** A YYYY-MM-DD string as UTC midnight (calendar arithmetic only: nothing here depends on a zone). */
const utcOf = (day: string) => {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
};

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 is Monday, 6 is Sunday. */
  weekday: number;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The wall clock in a zone at an instant. */
export function zonedParts(time: number, timeZone: string = WORKSPACE_TIME_ZONE): ZonedParts {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
      hourCycle: "h23",
    });
    formatters.set(timeZone, format);
  }
  const values: Record<string, string> = {};
  for (const part of format.formatToParts(time)) values[part.type] = part.value;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: Math.max(0, WEEKDAYS.indexOf(values.weekday ?? "")),
  };
}

/** How far the zone is ahead of UTC at an instant, in ms. */
function offsetAt(time: number, timeZone: string): number {
  const p = zonedParts(time, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(time / 1000) * 1000;
}

/** The instant a calendar day begins in the zone (00:00 there). */
export function startOfZonedDay(day: string, timeZone: string = WORKSPACE_TIME_ZONE): number {
  const guess = utcOf(day);
  return guess - offsetAt(guess - offsetAt(guess, timeZone), timeZone);
}

/** The Monday (YYYY-MM-DD) of the week an instant falls in. */
export function mondayOf(time: number, timeZone: string = WORKSPACE_TIME_ZONE): string {
  const p = zonedParts(time, timeZone);
  return iso(Date.UTC(p.year, p.month - 1, p.day) - p.weekday * DAY);
}

/** A string that is a real calendar day and a Monday. */
export function isMonday(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && iso(utcOf(day)) === day && new Date(utcOf(day)).getUTCDay() === 1;
}

/** Any calendar day string (`2026-11-11`): its Monday, or null when it isn't a day. */
export function mondayOfDay(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || iso(utcOf(day)) !== day) return null;
  return iso(utcOf(day) - ((new Date(utcOf(day)).getUTCDay() + 6) % 7) * DAY);
}

export const addWeeks = (monday: string, weeks: number): string => iso(utcOf(monday) + weeks * 7 * DAY);
export const sundayOf = (monday: string): string => iso(utcOf(monday) + 6 * DAY);

/** [start, end): from Monday 00:00 to the next Monday 00:00 in the zone (a week of daylight saving is 167 or 169 hours). */
export function weekBounds(monday: string, timeZone: string = WORKSPACE_TIME_ZONE) {
  return { start: startOfZonedDay(monday, timeZone), end: startOfZonedDay(addWeeks(monday, 1), timeZone) };
}

/** "November 9 – 15, 2026", "January 5 – 11, 2026", and across New Year "December 29, 2025 – January 4, 2026". */
export function weekRangeLabel(monday: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatRange(utcOf(monday), utcOf(sundayOf(monday)));
}

/** "This week", "Last week", or the dates. */
export function weekName(monday: string, now = Date.now()): string {
  const current = mondayOf(now);
  if (monday === current) return "This week";
  if (monday === addWeeks(current, -1)) return "Last week";
  return weekRangeLabel(monday);
}

/** Whether the zone's clock is within the hours "Your week" goes out: Sunday from 19:00 until 22:00. */
export function isWeekPushTime(now: number, timeZone: string = WORKSPACE_TIME_ZONE): boolean {
  const p = zonedParts(now, timeZone);
  return p.weekday === 6 && p.hour >= WEEK_PUSH_HOUR && p.hour < WEEK_PUSH_UNTIL_HOUR;
}

/** Whether a week is over, or it is Sunday evening already, the moment its look back is written and sent. */
export function weekIsReadyToWrite(monday: string, now: number, timeZone: string = WORKSPACE_TIME_ZONE): boolean {
  const current = mondayOf(now, timeZone);
  if (monday < current) return true;
  if (monday > current) return false;
  const p = zonedParts(now, timeZone);
  return p.weekday === 6 && p.hour >= WEEK_PUSH_HOUR;
}

// ---- What the week holds ----

export interface WeekPhoto {
  id: string;
  color: string;
  width: number;
  height: number;
}

/** A print of the week: one attempt, with the final photo of it when it has one. */
export interface WeekPrint {
  attemptId: string;
  itemId: string;
  title: string | null;
  /** "attempt 3" of its build. */
  attempt: number;
  /** Null while it is on the bed. */
  outcome: Outcome | null;
  /** When it was printed (the "when" of the attempt). */
  at: number;
  by: string;
  photo: WeekPhoto | null;
}

export interface WeekItemRef {
  id: string;
  title: string | null;
  at: number;
}

export interface WeekIdea extends WeekItemRef {
  /** Where it is now: an idea that has become a build opens as a build. */
  stage: WeekStage;
  /** The start of its note, for an idea with no title. */
  note: string;
  by: string;
}

export type WeekStage = "idea" | "building" | "done" | "shelved";

export interface WeekThread {
  itemId: string;
  stage: WeekStage;
  title: string | null;
  count: number;
}

export interface WeekWaiting {
  upNext: Array<{ id: string; title: string | null }>;
  failedLast: Array<{ id: string; title: string | null }>;
  low: Array<{ id: string; name: string; gramsLeft: number | null }>;
  upkeep: Array<{ id: string; name: string }>;
}

/** Claude's paragraph, when there is one (or is being written). */
export interface WeekNote {
  status: "thinking" | "done";
  text: string | null;
}

export interface WeekCounts {
  /** Every print of the week, the one on the bed included. */
  total: number;
  worked: number;
  partly: number;
  spaghetti: number;
  printing: number;
}

export interface Week {
  /** The week's Monday and Sunday, YYYY-MM-DD in `timeZone`. */
  monday: string;
  sunday: string;
  timeZone: string;
  /** Start (inclusive) and end (exclusive) as epoch ms. */
  start: number;
  end: number;
  /** Whether it is the week of the request. */
  current: boolean;
  prints: WeekCounts;
  /** The prints that got an answer, worked first, then partly, then spaghetti; newest first within each. */
  made: WeekPrint[];
  /** What is on the bed now, started this week. */
  onTheBed: WeekPrint[];
  buildsFinished: WeekItemRef[];
  ideas: WeekIdea[];
  comments: { total: number; byPerson: Record<string, number>; threads: WeekThread[] };
  /** Filament used by this week's finished prints, in grams (rounded); null when no print said how much. */
  grams: number | null;
  /** True when a failed print's share is a guess. */
  gramsApproximate: boolean;
  /** What is waiting right now: only on the current week. */
  waiting: WeekWaiting | null;
  note: WeekNote | null;
  /** No print, idea, build or comment: the page is one warm line. */
  empty: boolean;
}

export interface WeekResponse {
  week: Week;
}

/** Whether "Your week" is worth sending: at least one print or idea. */
export const weekIsWorthAPush = (week: Pick<Week, "prints" | "ideas">) =>
  week.prints.total > 0 || week.ideas.length > 0;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "4 prints, 1 spaghetti": what the push says first, and the page's one-line count. Null without prints. */
export function printsWords(prints: WeekCounts): string | null {
  if (!prints.total) return null;
  const parts = [plural(prints.total, "print")];
  if (prints.spaghetti) parts.push(`${prints.spaghetti} spaghetti`);
  return parts.join(", ");
}

/** The push: "Your week: 4 prints, 1 spaghetti", then the rest in a line, opening the week. */
export function weekMessage(week: Week): {
  kind: "week";
  title: string;
  body: string;
  tag: string;
  url: string;
  actions: [];
} {
  const first = printsWords(week.prints) ?? plural(week.ideas.length, "idea");
  const rest = [
    week.prints.total && week.ideas.length ? plural(week.ideas.length, "new idea") : null,
    week.buildsFinished.length ? `${plural(week.buildsFinished.length, "build")} finished` : null,
    week.prints.worked ? `${week.prints.worked} worked` : null,
  ].filter((part): part is string => part !== null);
  return {
    kind: "week",
    title: `Your week: ${first}`,
    body: rest.length ? `${rest.join(", ")}. Have a look back.` : "Have a look back at the week.",
    tag: `week-${week.monday}`,
    url: weekUrl(week.monday),
    actions: [],
  };
}

export const weekUrl = (monday: string) => `/week/${monday}`;

/** How much filament one finished attempt used, in grams: the plan, and for a failed print the share it got through (a guess). */
export function attemptGrams(
  outcome: Outcome | null,
  settings: {
    filaments?: Array<{ grams?: number }>;
    weightGrams?: number;
    failedAtPercent?: number;
  },
): { grams: number; approximate: boolean } | null {
  if (!outcome) return null;
  const filaments = settings.filaments ?? [];
  let planned = 0;
  let known = false;
  for (const filament of filaments) {
    if (filament.grams !== undefined && filament.grams > 0) {
      planned += filament.grams;
      known = true;
    }
  }
  if (!known && settings.weightGrams !== undefined && settings.weightGrams > 0) {
    planned = settings.weightGrams;
    known = true;
  }
  if (!known) return null;
  const failed = outcome === "failed";
  const share =
    failed && settings.failedAtPercent !== undefined ? Math.min(Math.max(settings.failedAtPercent, 0), 100) / 100 : 1;
  return { grams: planned * share, approximate: failed };
}
