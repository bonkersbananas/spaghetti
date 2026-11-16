import type { Item } from "@shared/api";
import { namingUntil } from "@shared/naming";
import { useEffect, useReducer } from "react";
import { ClaudeLine } from "./ClaudeLine";

/**
 * Whether Claude is naming this idea right now (decision 0072), from what the server says (`titleJob`), and for 15
 * seconds at most: then it is drawn again without it. (The server reports the job as done past the timeout too, so
 * the next copy of the idea the screens fetch drops it as well.)
 */
export function useNaming(item: Pick<Item, "title" | "titleJob">): boolean {
  const until = namingUntil(item);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (until === null || until <= Date.now()) return;
    const timer = setTimeout(tick, until - Date.now() + 50);
    return () => clearTimeout(timer);
  }, [until]);
  return until !== null && until > Date.now();
}

/**
 * Claude naming an idea, on a card or a Journal row: its sparkle, breathing, and "Naming…", as `ClaudeLine working`
 * says it, where the title will land. The lists show the words at once and load this, with its timeout, only while an
 * idea is being named (they check `titleJob` themselves), so it costs their first load next to nothing.
 */
export default function NamingSign({ item }: { item: Pick<Item, "title" | "titleJob"> }) {
  if (!useNaming(item)) return null;
  return (
    <ClaudeLine working className="min-h-6">
      Naming…
    </ClaudeLine>
  );
}
