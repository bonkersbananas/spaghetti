/**
 * Claude naming an idea that was saved without a title (docs/decisions/0070): the rules both sides share. The title
 * is the idea's own field; Claude only ever fills it while it is empty, and a person's title always wins.
 */
import { firstModelLink } from "./model-links.ts";

/** Per day, for the whole workspace: a key can't run up a bill. */
export const TITLES_PER_DAY = 60;

/** The longest title Claude may give: a few words, never a sentence. */
export const MAX_CLAUDE_TITLE = 60;

/** A note's own words: what is left without its links. */
export const noteWords = (note: string) => note.replace(/https?:\/\/\S+/g, "").trim();

/**
 * Whether an idea is one Claude should name: an idea with no title, no model link (a model page's idea gets the
 * page's title from the draft, decision 0019) and something to read, a photo or words in its note.
 */
export function wantsTitle(item: { stage: string; title: string | null; note: string; photos: number }): boolean {
  if (item.stage !== "idea" || item.title?.trim()) return false;
  if (firstModelLink(item.note)) return false;
  return item.photos > 0 || noteWords(item.note).length > 0;
}

/**
 * Tidies what Claude answered into a title, or null when it isn't one: one line, no quotes or full stop at the end,
 * short, and never a stand-in that says nothing ("Untitled", "3D print idea").
 */
export function cleanTitle(raw: string | null | undefined): string | null {
  let title = (raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "")
    .replace(/[.。!]+$/, "")
    .trim();
  if (!title || title.length > MAX_CLAUDE_TITLE) return null;
  if (/^(untitled|no title|unknown|idea|3d print(ing)?( idea)?|a? ?3d[- ]printed (object|part|thing))$/i.test(title))
    return null;
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return title;
}
