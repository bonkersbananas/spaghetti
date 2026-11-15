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
  itemId: string;
  item: Item;
  stage: Item["stage"];
  title: string;
  /** The thing's latest news: "worked", "spaghetti", "spaghetti, printing again", "captured". */
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

/**
 * What the other person did since `from`: a short sentence ("Sam printed 6 (2 worked, 2 partly, 2 spaghetti)
 * and captured 3 ideas.") and the things themselves, each once with its latest news, newest first. Their entries
 * only: yours you know. The journal credits a build's start, finish and shelving to whoever captured it, not whoever
 * did it, so only ideas and attempts say who (an attempt: whoever gave it its outcome, else who logged it).
 */
export function catchUp(
  entries: readonly JournalEntry[],
  items: ReadonlyMap<string, Item>,
  { me, from, name, lines = 3 }: { me: string; from: number; name: string; lines?: number },
): { sentence: string; lines: SinceLine[]; total: number } | null {
  const doneBy = (entry: JournalEntry) =>
    entry.kind === "attempt"
      ? (items.get(entry.itemId)?.attempts.find((a) => a.id === entry.attemptId)?.finishedBy ?? entry.by)
      : entry.by;
  const theirs = entries.filter(
    (entry) =>
      (entry.kind === "idea" || entry.kind === "attempt") &&
      doneBy(entry) !== me &&
      entry.at > from &&
      items.has(entry.itemId),
  );
  if (theirs.length === 0) return null;
  const tally = { worked: 0, partly: 0, failed: 0, printing: 0, ideas: 0 };
  const newsOf = new Map<string, string[]>();
  const order: string[] = [];
  // Newest first, as the journal gives them.
  for (const entry of theirs) {
    const item = items.get(entry.itemId);
    if (!item) continue;
    const outcome = entry.kind === "attempt" ? item.attempts.find((a) => a.id === entry.attemptId)?.outcome : null;
    let what = "captured";
    if (entry.kind === "idea") tally.ideas++;
    else if (outcome === "success") tally.worked++, (what = "worked");
    else if (outcome === "failed") tally.failed++, (what = "spaghetti");
    else if (outcome === "partial") tally.partly++, (what = "partly");
    else tally.printing++, (what = "printing");
    if (!newsOf.has(item.id)) {
      newsOf.set(item.id, []);
      order.push(item.id);
    }
    newsOf.get(item.id)?.push(what);
  }
  // Prints still on the bed are in Now: the sentence counts what has an answer.
  const prints = tally.worked + tally.partly + tally.failed;
  const breakdown = [
    tally.worked && `${tally.worked} worked`,
    tally.partly && `${tally.partly} partly`,
    tally.failed && `${tally.failed} spaghetti`,
  ].filter(Boolean);
  const printed = prints ? `printed ${prints} (${breakdown.join(", ")})` : "";
  const captured = tally.ideas ? `captured ${count(tally.ideas, "idea")}` : "";
  const sentence = `${name} ${[printed, captured].filter(Boolean).join(" and ")}.`;
  const rows: SinceLine[] = [];
  for (const id of order) {
    const item = items.get(id);
    const news = newsOf.get(id);
    if (!item || !news) continue;
    // The newest news; a print started again after an earlier answer says so ("spaghetti, printing again").
    const [latest = "captured", ...earlier] = news;
    const before = earlier.find((what) => what !== "printing" && what !== "captured");
    const what = latest === "printing" && before ? `${before}, printing again` : latest;
    rows.push({ itemId: id, item, stage: item.stage, title: item.title || firstWords(item.note), what });
  }
  return { sentence, lines: rows.slice(0, lines), total: rows.length };
}
