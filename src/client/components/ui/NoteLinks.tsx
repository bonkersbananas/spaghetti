import { findLinks } from "@shared/links";
import { useSettled } from "@/lib/use-settled";
import { LinkCard } from "./LinkCard";

/** At most this many cards under a note. */
const MAX_CARDS = 3;

/**
 * The links in a note as cards under it, one per distinct address, in the
 * order they appear, three at most. The links inside the note stay as they
 * are. Nothing when the note has none. The cards follow the note once it has
 * stopped changing: typing an address would otherwise ask for a preview of
 * every half-typed prefix of it.
 */
export function NoteLinks({
  note: typing,
  label = "Links in the note",
  skip,
}: {
  note: string;
  label?: string;
  skip?: string;
}) {
  const note = useSettled(typing);
  const urls = [...new Set(findLinks(note).map((link) => link.url))]
    .filter((url) => !skip || new URL(url).href !== skip)
    .slice(0, MAX_CARDS);
  if (urls.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-2" aria-label={label}>
      {urls.map((url) => (
        <li key={url}>
          <LinkCard url={url} />
        </li>
      ))}
    </ul>
  );
}
