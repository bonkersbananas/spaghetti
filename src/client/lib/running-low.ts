import type { Spool } from "@shared/api";
import { gramsText, isRunningLow, notEnough } from "@shared/ledger";
import { spoolName } from "@shared/spools";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useBuilds } from "./items";
import { spoolsQuery } from "./pantry";

export interface LowSpool {
  spool: Spool;
  /** Why: the level, or a print that needs more than is left ("needs 66 g"). */
  needs: number | null;
}

/**
 * The spools to restock: the low and empty ones, anything at 100 g or less, and any that a print still
 * on the bed needs more of than is left. Most urgent (fewest grams, then the lowest level) first.
 */
export function useRunningLow(): { low: LowSpool[]; isPending: boolean } {
  const { data: spools, isPending } = useQuery(spoolsQuery);
  const { items: builds } = useBuilds();
  const low = useMemo(() => {
    const needed = new Map<string, number>();
    for (const build of builds) {
      for (const attempt of build.attempts) {
        if (attempt.outcome !== null || attempt.endedAt) continue;
        for (const entry of notEnough(attempt.settings, spools ?? [])) {
          needed.set(entry.spoolId, Math.max(needed.get(entry.spoolId) ?? 0, entry.need));
        }
      }
    }
    const rank = (spool: Spool) =>
      spool.gramsLeft ?? ({ empty: 0, low: 60, half: 400, full: 900 } as const)[spool.remaining];
    return (spools ?? [])
      .filter((spool) => isRunningLow(spool) || needed.has(spool.id))
      .map((spool) => ({ spool, needs: needed.get(spool.id) ?? null }))
      .sort((a, b) => rank(a.spool) - rank(b.spool));
  }, [spools, builds]);
  return { low, isPending };
}

/** The shopping list as text: "Running low\n- Sunflower yellow, Bambu PLA Matte: about 40 g left". */
export function shoppingList(low: readonly LowSpool[]): string {
  const lines = low.map(({ spool, needs }) => {
    const name = spoolName(spool);
    const left =
      spool.gramsLeft !== null
        ? spool.gramsLeft <= 0
          ? "none left"
          : `about ${gramsText(spool.gramsLeft)} left`
        : spool.remaining === "empty"
          ? "empty"
          : "running low";
    return `- ${[name.title, name.detail].filter(Boolean).join(", ")}: ${left}${needs ? `, a print needs ${gramsText(needs)}` : ""}`;
  });
  return ["Filament to buy:", ...lines].join("\n");
}
