/**
 * Reading a question the way people ask it: "what worked for the paddle steamer", "spaghetti last week",
 * "Marie's idea about the coffee clips", "skevhet PETG". Filler words are dropped, "worked" and "failed" become
 * a preference, a time phrase becomes a date range, a first name becomes a person, a Swedish word also finds its
 * English twin, and a mistyped word is corrected from what the notebook knows. Shared so the Worker answers and
 * the app marks the same words.
 */
import { EXACT_WORDS, fold, MAX_TERMS, matchesTerm, type SearchTerm, searchTerms, words } from "./search.ts";
import { addWeeks, mondayOf, startOfZonedDay, zonedParts } from "./week.ts";

/** What the question prefers: attempts that worked first, or the ones that went wrong. */
export type Intent = "worked" | "failed";

/** A stretch of time a question named ("last week"), in milliseconds since the epoch. */
export interface When {
  from: number;
  to: number;
  /** "last week": how to say it back. */
  label: string;
  /** The Monday of the week it names ("this week", "last week"): the week page to link. */
  weekMonday: string | null;
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

/** A calendar day (YYYY-MM-DD) some days from another. */
const dayPlus = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The stretch of time a range names, in the workspace's time zone with weeks from Monday, the way the week pages
 * count them (shared/week.ts): "last week" is the page /week/<monday> that `weekMonday` names.
 */
export function whenRange(range: (typeof PHRASES)[number]["range"], now: number): When {
  const p = zonedParts(now);
  const today = new Date(Date.UTC(p.year, p.month - 1, p.day)).toISOString().slice(0, 10);
  const monday = mondayOf(now);
  const first = `${today.slice(0, 7)}-01`;
  const nextFirst = new Date(Date.UTC(p.year, p.month, 1)).toISOString().slice(0, 10);
  const lastFirst = new Date(Date.UTC(p.year, p.month - 2, 1)).toISOString().slice(0, 10);
  const spans = {
    today: [today, dayPlus(today, 1), "today", null],
    yesterday: [dayPlus(today, -1), today, "yesterday", null],
    week: [monday, addWeeks(monday, 1), "this week", monday],
    lastweek: [addWeeks(monday, -1), monday, "last week", addWeeks(monday, -1)],
    month: [first, nextFirst, "this month", null],
    lastmonth: [lastFirst, first, "last month", null],
  } as const;
  const [from, to, label, weekMonday] = spans[range];
  return { from: startOfZonedDay(from), to: startOfZonedDay(to), label, weekMonday };
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

/** A decimal number ("0.4") is one word, so "0.4 nozzle" finds the nozzle size; anything else splits on punctuation. */
const NUMBER_OR_WORD = /\p{N}+(?:\.\p{N}+)?(?![\p{L}])|[\p{L}\p{N}]+/gu;
const DECIMAL = /^\d+\.\d+$/;

/** Reads a typed question. `now` places time phrases. */
export function parseQuery(query: string, now: number): ParsedQuery {
  // "0,4" is the decimal 0.4, and "Marie's" is Marie.
  let rest = fold(query)
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[’']s\b/g, "");
  let when: When | null = null;
  for (const { pattern, range } of PHRASES) {
    if (!pattern.test(rest)) continue;
    when ??= whenRange(range, now);
    rest = rest.replace(pattern, " ");
  }
  let intent: Intent | null = null;
  const kept: string[] = [];
  for (const word of rest.match(NUMBER_OR_WORD) ?? []) {
    if (WORKED.has(word)) intent ??= "worked";
    else if (FAILED.has(word)) intent ??= "failed";
    else if (!FILLER.has(word) && (word.length > 1 || /\d/.test(word))) kept.push(word);
  }
  const terms = [...new Set(kept)].slice(0, MAX_TERMS).map((word): SearchTerm => {
    const term = { text: word, prefix: !EXACT_WORDS.has(word) && !DECIMAL.test(word) };
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

/** A term and the words it also stands for, each as a plain term: what the app marks, and what a match is tested against. */
export const markTerms = (terms: readonly SearchTerm[]): SearchTerm[] =>
  terms.flatMap((term) => [
    { text: term.text, prefix: term.prefix },
    ...(term.also ?? []).map((text) => ({ text, prefix: true })),
  ]);

/** Whether a text has a word for every term (or for a word it also stands for). */
export function textMatchesTerms(text: string, terms: readonly SearchTerm[]): boolean {
  if (!terms.length) return false;
  const found = words(text);
  return terms.every((term) => found.some((word) => matchesTerm(word, markTerms([term]))));
}
