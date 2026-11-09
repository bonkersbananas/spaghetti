/**
 * The journal: what happened, newest first, grouped by day near the top and
 * by week further back, inside months. Pure helpers, shared by the app and
 * the unit tests.
 */
import { OUTCOMES, type Outcome } from "./attempts.ts";

/** What a journal entry records. */
export const JOURNAL_KINDS = ["attempt", "idea", "started", "finished", "shelved"] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

/**
 * The outcome filter: one outcome, or "failures" (spaghetti and partly: every
 * attempt with something to learn from).
 */
export const OUTCOME_FILTERS = ["failures", ...OUTCOMES] as const;
export type OutcomeFilter = (typeof OUTCOME_FILTERS)[number];

/** The outcomes an outcome filter lets through. */
export function outcomesFor(filter: OutcomeFilter): Outcome[] {
  return filter === "failures" ? ["failed", "partial"] : [filter];
}

export const OUTCOME_FILTER_LABELS: Record<OutcomeFilter, string> = {
  failures: "Only failures",
  failed: "Spaghetti",
  partial: "Partly",
  success: "Worked",
};

/** Days this close to today get their own heading; older entries are grouped by week. */
export const DAYS_SHOWN_BY_DAY = 7;

export interface JournalGroup<T> {
  key: string;
  kind: "day" | "week";
  /** Start of the day or week (clipped to the month), local time. */
  start: number;
  /** End of the week (clipped to the month), for its label. */
  end: number;
  entries: T[];
}

export interface JournalMonth<T> {
  /** "2026-10" */
  key: string;
  /** First and last millisecond of the month, local time. */
  start: number;
  end: number;
  groups: JournalGroup<T>[];
}

const startOfDay = (time: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

const addDays = (time: number, days: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
};

/** Monday of the week the time falls in, local time. */
const startOfWeek = (time: number) => {
  const date = new Date(time);
  return addDays(startOfDay(time), -((date.getDay() + 6) % 7));
};

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Groups entries (newest first) into months, and within a month by day for
 * the last week and by week before that.
 */
export function groupJournal<T extends { at: number }>(entries: readonly T[], now = Date.now()): JournalMonth<T>[] {
  const firstDay = addDays(startOfDay(now), -(DAYS_SHOWN_BY_DAY - 1));
  const months: JournalMonth<T>[] = [];
  for (const entry of entries) {
    const date = new Date(entry.at);
    const monthKey = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    let month = months.at(-1);
    if (month?.key !== monthKey) {
      const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime() - 1;
      month = { key: monthKey, start, end, groups: [] };
      months.push(month);
    }
    const byDay = entry.at >= firstDay;
    const start = byDay ? startOfDay(entry.at) : Math.max(startOfWeek(entry.at), month.start);
    const end = byDay ? addDays(start, 1) - 1 : Math.min(addDays(startOfWeek(entry.at), 7) - 1, month.end);
    const key = `${byDay ? "d" : "w"}${start}`;
    let group = month.groups.at(-1);
    if (group?.key !== key) {
      group = { key, kind: byDay ? "day" : "week", start, end, entries: [] };
      month.groups.push(group);
    }
    group.entries.push(entry);
  }
  return months;
}

/** "Today", "Yesterday", "Thursday", or "Thu 29 Oct" further back than a week. */
export function dayLabel(start: number, now = Date.now()): string {
  const today = startOfDay(now);
  if (start === today) return "Today";
  if (start === addDays(today, -1)) return "Yesterday";
  return new Date(start).toLocaleDateString(undefined, { weekday: "long" });
}

/** "5 Nov", the date beside a day heading. */
export function shortDate(time: number): string {
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "12–18 Oct" (or "Oct 12 – 18", as the locale writes it), one date for a single day. */
export function weekLabel(start: number, end: number): string {
  if (startOfDay(start) === startOfDay(end)) return shortDate(start);
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).formatRange(start, end);
}

/** "November", or "November 2025" in another year. */
export function monthLabel(start: number, now = Date.now()): string {
  const date = new Date(start);
  return date.toLocaleDateString(undefined, {
    month: "long",
    ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}),
  });
}

/** One month in numbers, for its heading. */
export interface JournalSummary {
  /** Attempts with an outcome. */
  prints: number;
  worked: number;
  partly: number;
  spaghetti: number;
  /** Builds marked done that month, newest first. */
  finished: Array<{ id: string; title: string | null }>;
}

/** "Headphone stand" → "headphone stand", but "PETG box" stays. */
function midSentence(title: string): string {
  const [first = "", second = ""] = title;
  return second && second === second.toLowerCase() ? first.toLowerCase() + title.slice(1) : title;
}

/**
 * The month in one quiet line: "14 prints, 3 spaghetti, tugboat finished".
 * Empty when nothing was printed or finished.
 */
export function summaryLine(summary: JournalSummary): string {
  const parts: string[] = [];
  if (summary.prints) parts.push(`${summary.prints} ${summary.prints === 1 ? "print" : "prints"}`);
  if (summary.spaghetti) parts.push(`${summary.spaghetti} spaghetti`);
  const titled = summary.finished.map((build) => build.title?.trim()).filter((title): title is string => !!title);
  if (summary.finished.length === 1) {
    parts.push(`${titled[0] ? midSentence(titled[0]) : "1 build"} finished`);
  } else if (summary.finished.length === 2 && titled.length === 2) {
    parts.push(`${midSentence(titled[0] ?? "")} and ${midSentence(titled[1] ?? "")} finished`);
  } else if (summary.finished.length > 1) {
    parts.push(`${summary.finished.length} builds finished`);
  }
  return parts.join(", ");
}
