/**
 * "Since Thursday": what the other person did while you were away. Pure rules, shared by the screen and the unit
 * tests. A visit after this long away starts a catch-up; it stays for the rest of the day.
 */
import type { Item, JournalEntry } from "./api.ts";

/** Away this long, and the next visit has something to catch up on. */
export const AWAY_MS = 6 * 60 * 60 * 1000;
/** A catch-up is offered this long after the visit that started it, then it goes quiet. */
export const CATCH_UP_MS = 12 * 60 * 60 * 1000;

const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (time: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** "Since this morning", "Since yesterday", "Since Thursday", or the date a week or more back. */
export function sinceLabel(from: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(from)) / DAY);
  if (days <= 0) return "Since earlier today";
  if (days === 1) return "Since yesterday";
  if (days < 7) return `Since ${new Date(from).toLocaleDateString(undefined, { weekday: "long" })}`;
  return `Since ${new Date(from).toLocaleDateString(undefined, { month: "long", day: "numeric" })}`;
}

export interface SinceLine {
  key: string;
  itemId: string;
  stage: Item["stage"];
  title: string;
  /** "worked", "spaghetti", "captured"… */
  what: string;
}

/** An idea with no title: the start of its note, cut at a word. */
function firstWords(note: string, max = 40): string {
  const line = note.split("\n")[0]?.trim() ?? "";
  if (line.length <= max) return line;
  return `${line
    .slice(0, max)
    .replace(/\s+\S*$/, "")
    .replace(/[\s.,;:!?]+$/, "")}…`;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * What the other person did since `from`, in a sentence ("finished 1 build, had 1 spaghetti and added 2 ideas") and as
 * the newest few lines to open. Their entries only: yours you know.
 */
export function catchUp(
  entries: readonly JournalEntry[],
  items: ReadonlyMap<string, Item>,
  { me, from, name, lines = 3 }: { me: string; from: number; name: string; lines?: number },
): { sentence: string; lines: SinceLine[]; total: number } | null {
  const theirs = entries.filter((entry) => entry.by !== me && entry.at > from && items.has(entry.itemId));
  if (theirs.length === 0) return null;
  const tally = { finished: 0, started: 0, shelved: 0, worked: 0, failed: 0, partly: 0, printing: 0, ideas: 0 };
  const rows: SinceLine[] = [];
  for (const entry of theirs) {
    const item = items.get(entry.itemId);
    if (!item) continue;
    const outcome = entry.kind === "attempt" ? item.attempts.find((a) => a.id === entry.attemptId)?.outcome : null;
    let what = "captured";
    if (entry.kind === "idea") tally.ideas++;
    else if (entry.kind === "finished") tally.finished++, (what = "finished");
    else if (entry.kind === "started") tally.started++, (what = "started");
    else if (entry.kind === "shelved") tally.shelved++, (what = "shelved");
    else if (outcome === "success") tally.worked++, (what = "worked");
    else if (outcome === "failed") tally.failed++, (what = "spaghetti");
    else if (outcome === "partial") tally.partly++, (what = "partly");
    else tally.printing++, (what = "printing");
    rows.push({
      key: entry.key,
      itemId: item.id,
      stage: item.stage,
      title: item.title || firstWords(item.note),
      what,
    });
  }
  const parts = [
    tally.finished && `finished ${count(tally.finished, "build")}`,
    tally.worked && `${count(tally.worked, "print")} that worked`,
    tally.failed && `had ${count(tally.failed, "spaghetti", "spaghettis")}`,
    tally.partly && `${count(tally.partly, "print")} came out partly`,
    tally.printing && `started ${count(tally.printing, "print")}`,
    tally.started && `started ${count(tally.started, "build")}`,
    tally.shelved && `shelved ${count(tally.shelved, "build")}`,
    tally.ideas && `added ${count(tally.ideas, "idea")}`,
  ].filter((part): part is string => !!part);
  // Three things read in a breath; the rest is in the list and the journal.
  const said = parts.length > 3 ? [...parts.slice(0, 3), "more besides"] : parts;
  return { sentence: `${name} ${listOf(said)}.`, lines: rows.slice(0, lines), total: rows.length };
}
