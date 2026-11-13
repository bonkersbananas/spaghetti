import type { Item } from "@shared/api";

/**
 * A build's or idea's name: its title, else the first line of its note. Its own file, because the shell (the
 * now-printing strip) needs it on every screen and the journal's cards, which import a lot, do not.
 */
export function itemName(item: Pick<Item, "title" | "note" | "stage">): { text: string; titled: boolean } {
  if (item.title?.trim()) return { text: item.title.trim(), titled: true };
  const line = item.note.split("\n").find((l) => l.trim());
  if (line) return { text: line.trim(), titled: false };
  return { text: item.stage === "idea" ? "An idea without words" : "Untitled build", titled: false };
}
