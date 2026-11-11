/**
 * Search terms: how a typed query becomes an SQLite FTS5 MATCH expression
 * (in the Worker) and which words get highlighted (in the app). Both sides
 * read the query the same way, so what is marked is what matched.
 */
import { BUILT_IN_TAGS, type TagDefinition, type TagKind } from "./attempts.ts";

export interface SearchTerm {
  /** Lowercase, without accents: "petg", "warp". */
  text: string;
  /** Matches words that start with it ("warp" finds "warping"). */
  prefix: boolean;
  /** Other words that mean the same ("skev" is "warping" in Swedish): any of them matches too, as a word start. */
  also?: string[];
}

/** At most this many words of a query are used. */
export const MAX_TERMS = 8;

/**
 * Short material names that are whole words, not the start of others: "PLA"
 * shouldn't find every "plate" and "planter", nor "PA" every "part".
 */
const EXACT_WORDS = new Set(["pla", "pa", "pc", "abs"]);

/** Lowercase, without accents, the way FTS5's unicode61 tokenizer (remove_diacritics 2) reads text. */
export function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The words of a text, as the index splits them. */
export function words(text: string): string[] {
  return fold(text).match(NUMBER_OR_WORD) ?? [];
}

/** A decimal number ("0.4") is one word, so "0.4 nozzle" finds the nozzle size; anything else splits on punctuation. */
const NUMBER_OR_WORD = /\p{N}+(?:\.\p{N}+)?(?![\p{L}])|[\p{L}\p{N}]+/gu;
const DECIMAL = /^\d+\.\d+$/;

/** "PETG warp" → petg (prefix), warp (prefix). Empty when there is nothing to look for. */
export function searchTerms(query: string): SearchTerm[] {
  const seen = new Set<string>();
  const terms: SearchTerm[] = [];
  for (const word of words(query)) {
    if (seen.has(word)) continue;
    seen.add(word);
    terms.push({ text: word, prefix: !EXACT_WORDS.has(word) && !DECIMAL.test(word) });
    if (terms.length === MAX_TERMS) break;
  }
  return terms;
}

/** Whether a word of the text matches one of the terms. */
export function matchesTerm(word: string, terms: readonly SearchTerm[]): boolean {
  const folded = fold(word);
  return terms.some(
    (term) =>
      (term.prefix ? folded.startsWith(term.text) : folded === term.text) ||
      term.also?.some((other) => folded.startsWith(other)),
  );
}

/**
 * The FTS5 expression for the terms: every term must match (AND), each as a
 * quoted token so nothing typed is read as FTS syntax. A term that starts a
 * word of a tag's label but none of its slug ("drying" → "Drying helped",
 * stored as dried-filament-helped) also finds that tag.
 */
export function ftsQuery(
  terms: readonly SearchTerm[],
  customTags: readonly (TagDefinition & { kind: TagKind })[] = [],
) {
  const tags = [
    ...BUILT_IN_TAGS.failure.map((tag) => ({ ...tag, kind: "failure" as const })),
    ...BUILT_IN_TAGS.success.map((tag) => ({ ...tag, kind: "success" as const })),
    ...customTags,
  ];
  return terms
    .map((term) => {
      const token = ftsToken(term.text, term.prefix);
      const others = (term.also ?? []).map((other) => ftsToken(other, true));
      const viaLabel = tags
        .filter(
          (tag) =>
            words(tag.label).some((word) => (term.prefix ? word.startsWith(term.text) : word === term.text)) &&
            !words(tag.slug).some((word) => word.startsWith(term.text)),
        )
        .map((tag) => `tags : "${words(tag.slug).join(" ")}"`);
      const options = [token, ...others, ...viaLabel];
      return options.length > 1 ? `(${options.join(" OR ")})` : token;
    })
    .join(" AND ");
}

/** One word as an FTS5 string; "0.4" is the phrase "0 4", which is how the index splits it. */
function ftsToken(text: string, prefix: boolean) {
  const pieces = text.match(/[\p{L}\p{N}]+/gu) ?? [text];
  return `"${pieces.join(" ")}"${prefix ? "*" : ""}`;
}

/** A piece of text, marked when it matched. */
export interface Segment {
  text: string;
  match: boolean;
}

/** Splits text into matched and plain pieces, word by word. */
export function highlight(text: string, terms: readonly SearchTerm[]): Segment[] {
  if (!terms.length || !text) return text ? [{ text, match: false }] : [];
  const segments: Segment[] = [];
  let last = 0;
  for (const found of text.matchAll(NUMBER_OR_WORD)) {
    const start = found.index ?? 0;
    if (!matchesTerm(found[0], terms)) continue;
    if (start > last) segments.push({ text: text.slice(last, start), match: false });
    segments.push({ text: found[0], match: true });
    last = start + found[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return segments;
}

/** The markers FTS5's snippet() puts around matched words in a long note. */
export const SNIPPET_OPEN = "\u{E000}";
export const SNIPPET_CLOSE = "\u{E001}";

/** Splits a snippet from the server into matched and plain pieces. */
export function snippetSegments(snippet: string): Segment[] {
  const segments: Segment[] = [];
  for (const part of snippet.split(SNIPPET_OPEN)) {
    const close = part.indexOf(SNIPPET_CLOSE);
    if (close === -1) {
      if (part) segments.push({ text: part, match: false });
      continue;
    }
    segments.push({ text: part.slice(0, close), match: true });
    const rest = part.slice(close + SNIPPET_CLOSE.length);
    if (rest) segments.push({ text: rest, match: false });
  }
  return segments;
}
