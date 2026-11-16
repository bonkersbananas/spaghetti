import type { Item } from "@shared/api";
import { namingUntil } from "@shared/naming";
import { useEffect, useReducer } from "react";

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

/**
 * Whether Claude is naming this idea right now: its card, page and Journal row show "Naming…" in place of the title.
 * It stops by itself: when the title or the end of the job arrives through the change feed, or at the timeout.
 */
export function useNaming(item: Pick<Item, "title" | "titleJob">): boolean {
  const until = namingUntil(item);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (until === null || until <= Date.now()) return;
    // Drawn again when the time is up, so the sign goes even if nothing else changes.
    const timer = setTimeout(tick, until - Date.now() + 50);
    return () => clearTimeout(timer);
  }, [until]);
  return until !== null && until > Date.now();
}
