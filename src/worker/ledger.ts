import { asc, inArray } from "drizzle-orm";
import type { AttemptSettings, Outcome } from "../shared/attempts.ts";
import { attemptUsage, type SpoolGrams, spoolGrams, type Usage, type Weighing } from "../shared/ledger.ts";
import type { Db } from "./db/index.ts";
import { type Spool, spoolWeighings } from "./db/schema.ts";

interface UsageRow {
  id: string;
  item_id: string;
  outcome: Outcome;
  finished_at: number | null;
  printed_at: number;
  settings: string;
}

/** An attempt that used a spool, with what it used (decision 0009: nothing is stored, usage is read off the attempts). */
export interface SpoolUsage extends Usage {
  itemId: string;
}

/**
 * The usage of every finished attempt that is still around (neither it nor its build deleted)
 * and linked a spool; for one spool, or for all. An attempt edited, deleted or restored just reads differently.
 */
export async function loadUsage(d1: D1Database, spoolId?: string): Promise<SpoolUsage[]> {
  const { results } = await d1
    .prepare(
      `SELECT a.id, a.item_id, a.outcome, a.finished_at, a.printed_at, a.settings
         FROM attempts AS a JOIN items AS i ON i.id = a.item_id
        WHERE a.deleted_at IS NULL AND i.deleted_at IS NULL AND a.outcome IS NOT NULL
          AND instr(a.settings, '"spoolId"') > 0
          AND (?1 IS NULL OR instr(a.settings, ?1) > 0)`,
    )
    .bind(spoolId ?? null)
    .all<UsageRow>();
  return results.flatMap((row) => {
    let settings: AttemptSettings;
    try {
      settings = JSON.parse(row.settings) as AttemptSettings;
    } catch {
      return [];
    }
    return attemptUsage({ id: row.id, outcome: row.outcome, at: row.finished_at ?? row.printed_at, settings })
      .filter((entry) => !spoolId || entry.spoolId === spoolId)
      .map((entry) => ({ ...entry, itemId: row.item_id }));
  });
}

export async function loadWeighings(db: Db, spoolIds?: readonly string[]): Promise<Map<string, Weighing[]>> {
  const rows = await (spoolIds
    ? db
        .select()
        .from(spoolWeighings)
        .where(inArray(spoolWeighings.spoolId, [...spoolIds]))
    : db.select().from(spoolWeighings)
  ).orderBy(asc(spoolWeighings.weighedAt));
  const bySpool = new Map<string, Weighing[]>();
  for (const row of rows) {
    const list = bySpool.get(row.spoolId) ?? [];
    list.push({ id: row.id, gramsLeft: row.gramsLeft, onScale: row.onScale, at: row.weighedAt.getTime() });
    bySpool.set(row.spoolId, list);
  }
  return bySpool;
}

/** Grams for each of the given spools. */
export async function gramsFor(
  db: Db,
  d1: D1Database,
  spools: readonly Spool[],
): Promise<Map<string, SpoolGrams & { weighings: Weighing[] }>> {
  const single = spools.length === 1 ? spools[0]?.id : undefined;
  const [usage, weighings] = await Promise.all([
    loadUsage(d1, single),
    single ? loadWeighings(db, [single]) : loadWeighings(db),
  ]);
  return new Map(
    spools.map((spool) => {
      const own = weighings.get(spool.id) ?? [];
      return [
        spool.id,
        {
          ...spoolGrams(
            spool,
            own,
            usage.filter((entry) => entry.spoolId === spool.id),
          ),
          weighings: own,
        },
      ];
    }),
  );
}
