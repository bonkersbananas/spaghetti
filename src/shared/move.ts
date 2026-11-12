/** What goes between a note and the words added after it. */
export const NOTE_JOIN = "\n\n";

/** What a moved idea leaves in the note of the build or attempt it joins: its title, if it has one, and its note. */
export function movedText(idea: { title: string | null; note: string }): string {
  return [idea.title?.trim(), idea.note.trim()].filter(Boolean).join(NOTE_JOIN);
}

/** `note` with the moved words added after it, never over it. */
export function withMoved(note: string, added: string): string {
  if (!added) return note;
  return note.trim() ? `${note}${NOTE_JOIN}${added}` : added;
}

/** The undo of `withMoved`: the words come off the end again, unless the note was edited since. */
export function withoutMoved(note: string, added: string): string {
  if (!added) return note;
  if (note === added) return "";
  return note.endsWith(`${NOTE_JOIN}${added}`) ? note.slice(0, note.length - NOTE_JOIN.length - added.length) : note;
}
