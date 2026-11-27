import { itemName } from "@shared/item-name";
import { modelOf } from "@shared/model-mark";
import { coverPhoto } from "@/components/ui/Card";
import type { ItemView } from "@/lib/items";
import { coverOf } from "@/lib/previews";
import { shortenLinks } from "@/lib/short-links";

/** What a picker's tile shows for an idea: the Ideas grid card's cover and name, at tile size. */
export interface IdeaTile {
  photo?: { src: string; color?: string; fit?: "cover" | "contain" };
  /** The face of a tile without a picture: the same words the Ideas card's note card has. */
  note?: string;
  /** The line under the tile: never a raw address. */
  caption?: string;
  /** The name for a tile whose face is the name itself: shown only once the face cuts it short, so no words appear twice. */
  cutCaption?: string;
  /** The tile's name for a screen reader, whatever it shows. */
  label: string;
}

/** The cover by the one rule (coverOf), and the name the Ideas grid card gives it (shared/item-name.ts). */
export function ideaTile(idea: ItemView): IdeaTile {
  const cover = coverOf(idea);
  const photo = coverPhoto(cover, "");
  const name = itemName(idea);
  if (photo) return { photo, caption: name.text, label: name.text };
  // A note card: an idea whose note is only its link, and that link names it, shows the name, as the grid card does.
  const onlyLink = /^https?:\/\/\S+$/.test(idea.note.trim());
  const namedLink = onlyLink && (name.from === "link" || (name.from === "title" && modelOf(idea)?.kind === "page"));
  if (name.from === "none") return { note: "", caption: name.text, label: name.text };
  const face = namedLink ? name.text : idea.note.trim() ? shortenLinks(idea.note.trim()) : name.text;
  if (name.titled && name.text !== face) return { note: face, caption: name.text, label: name.text };
  return { note: face, cutCaption: name.text, label: name.text };
}
