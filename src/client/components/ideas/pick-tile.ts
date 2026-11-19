import { linkWords } from "@shared/links";
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
  /** The line under the tile, left out when the face already says it: never a raw address, never the same words twice. */
  caption?: string;
  /** The tile's name for a screen reader, whatever it shows. */
  label: string;
}

/** The first line of a note, an address said in words. */
function firstLine(note: string): string | undefined {
  const line = note
    .split("\n")
    .find((l) => l.trim())
    ?.trim();
  if (!line) return undefined;
  return (/^https?:\/\/\S+$/.test(line) ? linkWords(line)?.words : undefined) ?? shortenLinks(line);
}

/** The cover by the one rule (coverOf), and the name the Ideas grid card gives it. */
export function ideaTile(idea: ItemView): IdeaTile {
  const cover = coverOf(idea);
  const photo = coverPhoto(cover, "");
  const title = idea.title?.trim();
  const name = title || firstLine(idea.note) || "An idea without words";
  if (photo) return { photo, caption: name, label: name };
  // A note card: an idea whose note is only its model link and that has a name shows the name, as the grid card does.
  const namedLink = !!title && modelOf(idea)?.kind === "page" && /^https?:\/\/\S+$/.test(idea.note.trim());
  const face = namedLink ? title : idea.note.trim() ? shortenLinks(idea.note.trim()) : (title ?? "");
  return { note: face, caption: title && title !== face ? title : undefined, label: name };
}
