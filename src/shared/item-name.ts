/**
 * What an idea or a build is called, everywhere its name shows: its cards, its page and the tab's title, search, the
 * palette, the move and pick sheets, the shared page and a link's preview. One rule, so a thing never has one name on
 * its card and another on its page (docs/design.md, "One name").
 *
 * 1. A title someone typed (or Claude gave it) always wins.
 * 2. A note that starts with a link (an idea pasted from MakerWorld or Printables): the linked page's title, which the
 *    Worker knows once anyone looked (`Item.linkTitle`), else the words in its address ("Skadis pegboard white").
 * 3. Else the note's first line (an address with no words in it is skipped: a raw address is never a name).
 * 4. Else, a photo or a file and no words: "Untitled idea" or "Untitled build", the same quiet name on every screen.
 *
 * The name is never written into the idea: its title stays empty, so the page's title field shows the name as its
 * placeholder and tidying up later is one tap. Pure and tiny: every first load reads it.
 */
import { tidyPageTitle } from "./capture.ts";
import { findLinks, linkWords } from "./links.ts";
import { printablesTitleFromLink } from "./model-name.ts";

/** Where a name came from: `title` is the only one that is the thing's own. */
export type NameSource = "title" | "link" | "note" | "none";

export interface ItemName {
  text: string;
  /** It has a title of its own: the name isn't standing in for one. */
  titled: boolean;
  from: NameSource;
}

export interface Nameable {
  title: string | null;
  note?: string | null;
  /** "idea", or a build's stage: only the last-resort name tells them apart. */
  stage?: string;
  /** The page title of the link the note starts with, when the Worker has read it (`Item.linkTitle`). */
  linkTitle?: string | null;
}

/** The name of a thing with no title, no words and no readable link. */
export const UNTITLED = { idea: "Untitled idea", build: "Untitled build" } as const;

/** Longer than any screen shows on one line: they clamp or truncate, but a name still ends on a whole word. */
export const NAME_MAX = 120;

/** "A very long first line of a note that goes on…": cut on a word, with an ellipsis. */
export function clipName(text: string, max = NAME_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${head.slice(0, space > max * 0.6 ? space : head.length).replace(/[\s.,;:!?-]+$/, "")}…`;
}

/** The link a line is, when it is only that link (a pasted address); else null. */
function bareLink(line: string): string | null {
  const text = line.trim();
  const [only] = findLinks(text);
  return only && only.start === 0 && only.end === text.length ? only.url : null;
}

/** The link the note starts with, when its first line is only that link; else null. */
export function leadingLink(note: string | null | undefined): string | null {
  const first = note?.split("\n").find((line) => line.trim());
  return first ? bareLink(first) : null;
}

/** What a link is called: its page's title when known, else the words in its address. Null when it has none. */
export function linkName(url: string, pageTitle?: string | null): string | null {
  const page = pageTitle?.replace(/\s+/g, " ").trim();
  if (page) return tidyPageTitle(page) ?? page;
  // Only the address's last part can name the thing: "makerworld.com/en/models/123" is not called "Models".
  const [path = ""] = url.split(/[?#]/);
  const parts = path.replace(/\/+$/, "").split("/");
  const last = parts.length > 3 ? parts.at(-1) : undefined;
  return printablesTitleFromLink(url) ?? (last ? linkWords(`${parts[2]}/${last}`)?.words : undefined) ?? null;
}

export function itemName(item: Nameable): ItemName {
  const title = item.title?.trim();
  if (title) return { text: title, titled: true, from: "title" };
  const link = leadingLink(item.note);
  const fromLink = link ? linkName(link, item.linkTitle) : null;
  if (fromLink) return { text: clipName(fromLink), titled: false, from: "link" };
  // A raw address is never a name: a link with no words to read gives way to the note's next line.
  const line = item.note?.split("\n").find((l) => l.trim() && !(link && bareLink(l)));
  if (line) return { text: clipName(line), titled: false, from: "note" };
  return { text: item.stage && item.stage !== "idea" ? UNTITLED.build : UNTITLED.idea, titled: false, from: "none" };
}

/** Just the name's words. */
export const nameOf = (item: Nameable) => itemName(item).text;
