/**
 * What an idea or a build is called, everywhere its name shows: its cards, its page and the tab's title, search, the
 * palette, the move and pick sheets, the shared page and a link's preview. One rule, so a thing never has one name on
 * its card and another on its page (docs/design.md, "One name").
 *
 * 1. A title someone typed (or Claude gave it) always wins.
 * 2. A note that starts with a link (an idea pasted from MakerWorld or Printables): what the Worker says the link is
 *    called (`Item.linkTitle`, link-name.ts: its page's title once anyone looked, else its address's words), else, on a
 *    copy this device made, the words in its address's last part ("Skadis pegboard white").
 * 3. Else the note's first line (an address with no words in it is skipped: a raw address is never a name).
 * 4. Else, a photo or a file and no words: "Untitled idea" or "Untitled build", the same quiet name on every screen.
 *
 * The name is never written into the idea: its title stays empty, so the page's title field shows the name as its
 * placeholder and tidying up later is one tap. Pure and tiny, a leaf: every first load reads it, so the heavier reading
 * of a link (a page title's site suffix, Printables' casing) is link-name.ts's, on the Worker.
 */

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
  /** What the link the note starts with is called, as the Worker read it (`Item.linkTitle`). */
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

/** The link a line is, when it is only that link (a pasted address); else null. links.ts's findLinks, for one line. */
function bareLink(line: string): string | null {
  const text = line.trim();
  return /^https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]$/i.test(text) ? text : null;
}

/** The link the note starts with, when its first line is only that link; else null. */
export function leadingLink(note: string | null | undefined): string | null {
  const first = note?.split("\n").find((line) => line.trim());
  return first ? bareLink(first) : null;
}

/**
 * The words in a link's last part ("…/p/skadis-pegboard-white-20320802" is "Skadis pegboard white"), or null: numbers,
 * ids ("thing:12345") and a file's extension are not words. links.ts's linkWords, for the last part only:
 * "makerworld.com/en/models/123" is not called "Models".
 */
export function addressName(url: string): string | null {
  const [path = ""] = url.split(/[?#]/);
  const parts = path.replace(/\/+$/, "").split("/");
  return parts.length > 3 ? partWords(parts.at(-1) ?? "") : null;
}

/** The words in one part of an address ("skadis-pegboard-white-20320802" is "Skadis pegboard white"), or null. */
export function partWords(part: string): string | null {
  let decoded = part;
  try {
    decoded = decodeURIComponent(part);
  } catch {}
  const tokens = decoded.replace(/\.[a-z0-9]{2,5}$/i, "").split(/[-_+.:\s]+/);
  const words = tokens.filter((word) => /\p{L}/u.test(word) && !/\d{3,}/.test(word));
  // An id with a short prefix ("thing:12345") is not a name.
  const idOnly = words.length === 1 && tokens.length > 1 && (words[0]?.length ?? 0) <= 5;
  if (!words.length || words.join("").length <= 2 || idOnly) return null;
  const text = words.slice(0, 8).join(" ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function itemName(item: Nameable): ItemName {
  const title = item.title?.trim();
  if (title) return { text: title, titled: true, from: "title" };
  const link = leadingLink(item.note);
  const fromLink = link ? item.linkTitle?.replace(/\s+/g, " ").trim() || addressName(link) : null;
  if (fromLink) return { text: clipName(fromLink), titled: false, from: "link" };
  // A raw address is never a name: a link with no words to read gives way to the note's next line.
  const line = item.note?.split("\n").find((l) => l.trim() && !(link && bareLink(l)));
  if (line) return { text: clipName(line), titled: false, from: "note" };
  return { text: item.stage && item.stage !== "idea" ? UNTITLED.build : UNTITLED.idea, titled: false, from: "none" };
}

/**
 * The note's words after the line the thing is named by, so a row that shows the name doesn't say it twice: the whole
 * note for a titled thing; after the link or line that named it (a wordless link before it included) otherwise.
 */
export function noteAfterName(item: Nameable): string {
  const note = item.note?.trim() ?? "";
  const name = itemName(item);
  if (name.titled) return note;
  if (name.from === "none") return "";
  const lines = note.split("\n");
  const link = leadingLink(note);
  const at =
    name.from === "link"
      ? lines.findIndex((l) => l.trim())
      : lines.findIndex((l) => l.trim() && !(link && bareLink(l)));
  return lines
    .slice(at + 1)
    .join("\n")
    .trim();
}

/** Just the name's words. */
export const nameOf = (item: Nameable) => itemName(item).text;
