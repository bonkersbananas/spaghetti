import { useEffect } from "react";

const KEY = "sg-recent-items";
const MAX = 6;

/** An idea or build someone opened, kept on this device for the palette's "Recent". */
export interface RecentItem {
  id: string;
  kind: "idea" | "build";
  title: string;
  /** Its leading photo, for the thumbnail. */
  photo: { id: string; color: string } | null;
}

export function recentItems(): RecentItem[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list)
      ? list.filter((entry): entry is RecentItem => typeof entry?.id === "string" && typeof entry?.title === "string")
      : [];
  } catch {
    return [];
  }
}

/** Puts an item first in the list (and refreshes its name and photo). */
export function rememberItem(entry: RecentItem) {
  const list = recentItems();
  if (JSON.stringify(list[0]) === JSON.stringify(entry)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([entry, ...list.filter((other) => other.id !== entry.id)].slice(0, MAX)));
  } catch {
    // Private mode: nothing remembered.
  }
}

export function forgetItem(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(recentItems().filter((entry) => entry.id !== id)));
  } catch {
    // Nothing to forget.
  }
}

/** What an idea or build is called in lists: its title, else the first line of its note. */
export function itemName(item: { title: string | null; note?: string }, kind: "idea" | "build"): string {
  return item.title?.trim() || item.note?.trim().split("\n")[0]?.slice(0, 80) || `Untitled ${kind}`;
}

/** Remembers the idea or build on screen. */
export function useRememberItem(entry: RecentItem) {
  const { id, kind, title, photo } = entry;
  const photoId = photo?.id;
  const color = photo?.color;
  useEffect(
    () => rememberItem({ id, kind, title, photo: photoId ? { id: photoId, color: color ?? "" } : null }),
    [id, kind, title, photoId, color],
  );
}
