import { findLinks } from "@shared/links";
import { cleanModelUrl, linkKey, type ModelMark, sameModel } from "@shared/model-mark";
import { useSettled } from "@/lib/use-settled";
import { LinkCard } from "./LinkCard";

/** At most this many cards under a note. */
const MAX_CARDS = 3;

/**
 * The links in a note as cards under it, one per distinct address (and one per model, however its address is
 * written), in the order they appear, three at most. The links inside the note stay as they are. Nothing when the
 * note has none. The cards follow the note once it has stopped changing: typing an address would otherwise ask for a
 * preview of every half-typed prefix of it.
 *
 * `model` is the model the page is about: its link is shown as the model's card ("Model on MakerWorld"), or not at
 * all with `modelShownElsewhere`, when the page draws that card itself.
 */
export function NoteLinks({
  note: typing,
  label = "Links in the note",
  model,
  modelShownElsewhere,
}: {
  note: string;
  label?: string;
  model?: ModelMark | null;
  modelShownElsewhere?: boolean;
}) {
  const note = useSettled(typing);
  const page = model?.kind === "page" ? model : null;
  const seen = new Set<string>();
  const urls = findLinks(note)
    .map((link) => cleanModelUrl(link.url))
    .filter((url) => {
      const key = linkKey(url);
      if (seen.has(key)) return false;
      seen.add(key);
      return !(modelShownElsewhere && model && (sameModel(url, model.url) || url === model.url));
    })
    .slice(0, MAX_CARDS);
  if (urls.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-2" aria-label={label}>
      {urls.map((url) => (
        <li key={url}>
          <LinkCard url={url} model={page && sameModel(url, page.url) ? page : undefined} />
        </li>
      ))}
    </ul>
  );
}
