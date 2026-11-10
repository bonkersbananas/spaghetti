import { findLinks } from "@shared/links";
import { LinkCard } from "./LinkCard";

/** At most this many cards under a note. */
const MAX_CARDS = 3;

/**
 * The links in a note as cards under it, one per distinct address, in the
 * order they appear, three at most. The links inside the note stay as they
 * are. Nothing when the note has none.
 */
export function NoteLinks({ note }: { note: string }) {
  const urls = [...new Set(findLinks(note).map((link) => link.url))].slice(0, MAX_CARDS);
  if (urls.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-2" aria-label="Links in the note">
      {urls.map((url) => (
        <li key={url}>
          <LinkCard url={url} />
        </li>
      ))}
    </ul>
  );
}
