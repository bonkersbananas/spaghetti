/**
 * Reading a question the way people ask it: "what worked for the paddle steamer", "spaghetti last week",
 * "Marie's idea about the coffee clips", "skevhet PETG". Filler words are dropped, "worked" and "failed" become
 * a preference, a time phrase becomes a date range, a first name becomes a person, a Swedish word also finds its
 * English twin, and a mistyped word is corrected from what the notebook knows. Shared so the Worker answers and
 * the app marks the same words.
 */
import { fold, type SearchTerm, searchTerms, words } from "./search.ts";

/** What the question prefers: attempts that worked first, or the ones that went wrong. */
export type Intent = "worked" | "failed";

/** A stretch of time a question named ("last week"), in milliseconds since the epoch. */
export interface When {
  from: number;
  to: number;
  /** "last week": how to say it back. */
  label: string;
}

export interface ParsedQuery {
  terms: SearchTerm[];
  intent: Intent | null;
  when: When | null;
  /** First names (folded) typed in the question: the people it may mean. */
  names: string[];
}

/** Words that carry no search value, in English and Swedish (folded: å ä ö are a a o). */
const FILLER = new Set(
  (
    "what which who how did do does we i me my our the a an of for about with that this it is was were are and or " +
    "in on to at from when where show find tell last time times again idea ideas build builds print prints printed " +
    "attempt attempts try tries thing things some any said say says wrote write told think thought " +
    "vad hur som med av en ett det den de vi jag mitt vart min mina om till fran och eller senast sist gang gangen " +
    "ide ideer bygge bygget utskrift forsok"
  ).split(" "),
);

const WORKED = new Set(
  "worked work works success successful succeeded good great best nailed fungerade funkade fungerar funkar lyckades bra".split(
    " ",
  ),
);
const FAILED = new Set("failed fail fails failure failures bad broke broken misslyckades dalig daligt".split(" "));

/** Whole phrases that name a stretch of time, English and Swedish (folded). */
const PHRASES: Array<{ pattern: RegExp; range: "today" | "yesterday" | "week" | "lastweek" | "month" | "lastmonth" }> =
  [
    { pattern: /\b(last|previous) week\b|\bforra veckan\b/, range: "lastweek" },
    { pattern: /\b(this|the) week\b|\bi veckan\b|\bdenna vecka\b/, range: "week" },
    { pattern: /\b(last|previous) month\b|\bforra manaden\b/, range: "lastmonth" },
    { pattern: /\bthis month\b|\bi manaden\b|\bden har manaden\b/, range: "month" },
    { pattern: /\byesterday\b|\bigar\b/, range: "yesterday" },
    { pattern: /\btoday\b|\bidag\b/, range: "today" },
  ];

const DAY = 86_400_000;

/**
 * The stretch of time a range names. Weeks start on Monday, in the person's own time zone (`tzOffset`: minutes
 * east of UTC, as the app sends it; none means UTC).
 */
export function whenRange(range: (typeof PHRASES)[number]["range"], now: number, tzOffset = 0): When {
  const local = now + tzOffset * 60_000;
  const day = Math.floor(local / DAY) * DAY;
  const weekday = (new Date(day).getUTCDay() + 6) % 7; // Monday 0
  const monday = day - weekday * DAY;
  const startOfMonth = Date.UTC(new Date(local).getUTCFullYear(), new Date(local).getUTCMonth(), 1);
  const startOfLastMonth = Date.UTC(new Date(local).getUTCFullYear(), new Date(local).getUTCMonth() - 1, 1);
  const spans = {
    today: [day, day + DAY, "today"],
    yesterday: [day - DAY, day, "yesterday"],
    week: [monday, monday + 7 * DAY, "this week"],
    lastweek: [monday - 7 * DAY, monday, "last week"],
    month: [
      startOfMonth,
      Date.UTC(new Date(local).getUTCFullYear(), new Date(local).getUTCMonth() + 1, 1),
      "this month",
    ],
    lastmonth: [startOfLastMonth, startOfMonth, "last month"],
  } as const;
  const [from, to, label] = spans[range];
  return { from: from - tzOffset * 60_000, to: to - tzOffset * 60_000, label };
}

/**
 * Words that mean the same, so "skevhet" finds "warping" and "blå" finds "Blue" (folded; the index holds English
 * tags and whatever people typed). Each row is one meaning; a term that starts any member finds them all.
 */
const SYNONYMS: string[][] = [
  ["warp", "warping", "skev", "skevhet", "skevt", "vrid", "vridning", "curling"],
  ["stringing", "trad", "tradar", "spindelvav"],
  ["adhesion", "haftning", "fastnar", "lossnar", "lossnade"],
  ["nozzle", "munstycke"],
  ["bed", "bedd", "byggplatta"],
  ["plate", "platta"],
  ["temperature", "temp", "temperatur"],
  ["support", "supports", "stod"],
  ["brim", "brimkant"],
  ["dried", "drying", "dry", "torkad", "torkat", "torkning", "torr"],
  ["wet", "fuktig", "fuktigt", "blot"],
  ["clog", "clogged", "igensatt", "propp"],
  ["printer", "skrivare"],
  ["spool", "spole", "rulle"],
  ["layer", "lager", "skikt"],
  ["infill", "fyllning"],
  ["speed", "hastighet", "fart"],
  ["color", "colour", "farg"],
  ["blue", "bla"],
  ["red", "rod"],
  ["green", "gron"],
  ["black", "svart"],
  ["white", "vit"],
  ["yellow", "gul"],
  ["grey", "gray", "gra"],
  ["pink", "rosa"],
  ["purple", "lila"],
  ["brown", "brun"],
  ["gold", "guld"],
  ["silk", "siden"],
  ["matte", "matt"],
  ["clear", "transparent", "genomskinlig"],
  ["strong", "stark"],
  ["tight", "tat"],
  ["surface", "yta"],
  ["overhang", "overhang"],
  ["spaghetti", "spagetti"],
];

/** The words a term also stands for. A short term must be the whole member: "gra" is not "grattis". */
function alsoFor(term: SearchTerm): string[] {
  if (!term.prefix && !/^[a-z]+$/.test(term.text)) return [];
  const found = new Set<string>();
  for (const group of SYNONYMS) {
    const hit = group.some((member) =>
      term.text.length >= 4 && term.prefix
        ? member.startsWith(term.text) || (member.length >= 4 && term.text.startsWith(member))
        : member === term.text,
    );
    if (hit) for (const member of group) if (member !== term.text) found.add(member);
  }
  return [...found];
}

/** Reads a typed question. `now` and `tzOffset` place time phrases. */
export function parseQuery(query: string, now: number, tzOffset = 0): ParsedQuery {
  let rest = fold(query).replace(/[’']s\b/g, "");
  let when: When | null = null;
  for (const { pattern, range } of PHRASES) {
    if (!pattern.test(rest)) continue;
    when ??= whenRange(range, now, tzOffset);
    rest = rest.replace(pattern, " ");
  }
  let intent: Intent | null = null;
  const kept: string[] = [];
  for (const word of words(rest)) {
    if (WORKED.has(word)) intent ??= "worked";
    else if (FAILED.has(word)) intent ??= "failed";
    else if (!FILLER.has(word) && (word.length > 1 || /\d/.test(word))) kept.push(word);
  }
  const terms = searchTerms(kept.join(" ")).map((term) => {
    const also = alsoFor(term);
    return also.length ? { ...term, also } : term;
  });
  // Nothing left but filler ("for", "the"): search for what was typed, rather than for nothing.
  if (!terms.length && !intent && !when) {
    return { terms: searchTerms(query), intent: null, when: null, names: [] };
  }
  return { terms, intent, when, names: [] };
}

/**
 * Splits off the terms that are a person's first name ("Marie's idea" is Marie's), so the search can narrow to
 * what they wrote. `people` are first names, folded.
 */
export function splitNames(terms: readonly SearchTerm[], people: readonly string[]) {
  const names = terms.filter((term) => people.includes(term.text)).map((term) => term.text);
  return { names, terms: terms.filter((term) => !names.includes(term.text)) };
}

/** Optimal string alignment distance: edits (and a swap of two neighbours) from one word to the other. */
export function distance(a: string, b: string): number {
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    rows[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) {
        (rows[0] as number[])[j] = j;
        continue;
      }
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        ((rows[i - 1] as number[])[j] as number) + 1,
        ((rows[i] as number[])[j - 1] as number) + 1,
        ((rows[i - 1] as number[])[j - 1] as number) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, ((rows[i - 2] as number[])[j - 2] as number) + 1);
      }
      (rows[i] as number[])[j] = best;
    }
  }
  return (rows[a.length] as number[])[b.length] as number;
}

/** How far a mistyped word may be from a real one: none for very short words. */
const allowedEdits = (word: string) => (word.length < 4 ? 0 : word.length < 8 ? 1 : 2);

/**
 * The known word a typed one most likely meant ("pwtg" is out of reach, "petgg" is "petg", "wraping" is "warping").
 * `vocabulary` is ordered by how often words occur, most first, which breaks ties. Numbers and short material
 * names are left alone, and a word that is already known (or the start of one) needs no help.
 */
export function correctWord(word: string, vocabulary: readonly string[]): string | null {
  if (/\d/.test(word) || word.length < 4) return null;
  if (vocabulary.some((known) => known.startsWith(word))) return null;
  const limit = allowedEdits(word);
  let best: { word: string; edits: number } | null = null;
  for (const known of vocabulary) {
    if (Math.abs(known.length - word.length) > limit) continue;
    // A typing slip in the first letter is rarer than elsewhere.
    const edits = distance(word, known) + (known[0] === word[0] ? 0 : 0.5);
    if (edits <= limit && (!best || edits < best.edits)) best = { word: known, edits };
  }
  return best?.word ?? null;
}

/** The terms with the unknown ones corrected; null when nothing changed. */
export function correctTerms(terms: readonly SearchTerm[], vocabulary: readonly string[]): SearchTerm[] | null {
  let changed = false;
  const next = terms.map((term) => {
    const fixed = term.prefix ? correctWord(term.text, vocabulary) : null;
    if (!fixed) return term;
    changed = true;
    return { text: fixed, prefix: true, ...(term.also ? { also: term.also } : {}) };
  });
  return changed ? next : null;
}
