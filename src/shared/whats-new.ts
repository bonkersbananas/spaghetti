/**
 * "What's new": one short sentence per shipped version, kept in /whats-new.json (written by `pnpm ship --note`,
 * docs/deploy.md). A version is named by its entry script (/assets/index-<hash>.js), which a page can read from
 * its own <script> tag. The update toast shows the sentences of the versions newer than the page's own.
 * Pure functions only: the ship (Node) and the app share them.
 */

export type WhatsNewEntry = { entry: string; date: string; note: string };
export type WhatsNewFile = { notes: WhatsNewEntry[] };

/** How many entries the file keeps, oldest dropped first. */
export const KEEP_NOTES = 30;

/** The entries of a file read (an empty note marks a version shipped without one) from the network, oldest first; anything malformed is left out. Never throws. */
export function parseNotes(value: unknown): WhatsNewEntry[] {
  const list = (value as { notes?: unknown } | null)?.notes;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (e): e is WhatsNewEntry =>
      !!e && typeof e.entry === "string" && typeof e.date === "string" && typeof e.note === "string",
  );
}

/** The file with one more entry at the end (replacing an earlier one for the same version), the last KEEP_NOTES kept. */
export function addNote(existing: unknown, add: WhatsNewEntry): WhatsNewFile {
  const rest = parseNotes(existing).filter((e) => e.entry !== add.entry);
  return { notes: [...rest, add].slice(-KEEP_NOTES) };
}

/** The entry script in an index.html (`/assets/index-abc.js`), or undefined. */
export function entryOfHtml(html: string): string | undefined {
  for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
    if (/type="module"/.test(tag)) return /src="([^"]+)"/.exec(tag)?.[1];
  }
  return undefined;
}

/**
 * The sentence for the toast: the notes of the versions newer than `own` (the page's entry script), the newest two
 * joined. If `own` isn't listed (a version shipped without a note, or older than the file's history) only the newest
 * entry counts, since nothing says how far behind the page is. Undefined when there is nothing to say.
 */
export function sentenceFor(notes: WhatsNewEntry[], own: string | null | undefined): string | undefined {
  if (!notes.length) return undefined;
  const at = own ? notes.findIndex((e) => e.entry === own) : -1;
  const newer = at >= 0 ? notes.slice(at + 1) : notes.slice(-1);
  const last = newer
    .map((e) => e.note.trim())
    .filter(Boolean)
    .slice(-2);
  return last.length ? last.join(" ") : undefined;
}
