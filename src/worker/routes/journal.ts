import { and, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { JournalEntry, JournalResponse, JournalSummaryResponse } from "../../shared/api.ts";
import type { JournalKind } from "../../shared/journal.ts";
import { items } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { loadItems } from "./items.ts";
import { attemptFilters, type Clause, filters } from "./search.ts";

/** "<at>.<rank>.<id>": where the last page stopped. */
const cursor = z
  .string()
  .regex(/^\d+\.\d\.[\w-]+$/)
  .transform((value) => {
    const [at = "0", rank = "0", ...id] = value.split(".");
    return { at: Number(at), rank: Number(rank), id: id.join(".") };
  });

const journalQuery = filters.extend({
  cursor: cursor.optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
});

const summaryQuery = z.object({
  from: z.coerce.number().int().min(0),
  to: z.coerce.number().int().min(0),
});

/** An idea that became a build more than a minute later was captured as an idea first. */
const CAPTURED_FIRST_MS = 60_000;

/**
 * Within the same millisecond, newest first means: finished after the
 * attempt that finished it, the attempt after the build it started.
 */
const RANK: Record<JournalKind, number> = { finished: 4, shelved: 4, attempt: 3, started: 2, idea: 1 };

interface EventRow {
  kind: JournalKind;
  id: string;
  item_id: string;
  at: number;
  rank: number;
  by: string;
  via: string | null;
}

/** Every event as one query: attempts, ideas captured, builds started, finished or shelved. */
function events(f: z.infer<typeof filters>): Clause {
  const attempt = attemptFilters(f);
  const parts: Clause[] = [
    {
      sql: `SELECT 'attempt' AS kind, a.id AS id, a.item_id AS item_id, a.printed_at AS at, ${RANK.attempt} AS rank, a.created_by AS by, a.created_via AS via
        FROM attempts AS a JOIN items AS i ON i.id = a.item_id
        WHERE a.deleted_at IS NULL AND i.deleted_at IS NULL${attempt.sql}`,
      params: attempt.params,
    },
  ];
  // Outcomes and materials belong to attempts: with one of them on, the journal shows only attempts.
  if (!f.outcome && !f.material) {
    const person = f.person ? " AND created_by = ?" : "";
    const params = f.person ? [f.person] : [];
    parts.push(
      {
        sql: `SELECT 'idea', id, id, created_at, ${RANK.idea}, created_by, created_via FROM items
          WHERE deleted_at IS NULL AND (started_at IS NULL OR started_at - created_at > ${CAPTURED_FIRST_MS})${person}`,
        params,
      },
      {
        sql: `SELECT 'started', id, id, started_at, ${RANK.started}, created_by, created_via FROM items
          WHERE deleted_at IS NULL AND started_at IS NOT NULL${person}`,
        params,
      },
      {
        sql: `SELECT CASE stage WHEN 'done' THEN 'finished' ELSE 'shelved' END, id, id, finished_at, ${RANK.finished}, created_by, created_via
          FROM items WHERE deleted_at IS NULL AND finished_at IS NOT NULL AND stage IN ('done', 'shelved')${person}`,
        params,
      },
    );
  }
  return { sql: parts.map((part) => part.sql).join("\nUNION ALL\n"), params: parts.flatMap((part) => part.params) };
}

/**
 * The journal: everything that happened, newest first, a page at a time
 * (keyset pagination, so a year of prints stays fast to page through).
 */
export const journalRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const parsed = journalQuery.safeParse(c.req.query());
    if (!parsed.success) return apiError(c, 400, "invalid", "Those filters couldn't be read.");
    const { cursor: after, limit = 30, ...f } = parsed.data;
    const source = events(f);
    const page = after
      ? {
          sql: " WHERE at < ? OR (at = ? AND (rank < ? OR (rank = ? AND id < ?)))",
          params: [after.at, after.at, after.rank, after.rank, after.id],
        }
      : { sql: "", params: [] };
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM (${source.sql})${page.sql} ORDER BY at DESC, rank DESC, id DESC LIMIT ?`,
    )
      .bind(...source.params, ...page.params, limit + 1)
      .all<EventRow>();
    const rows = results.slice(0, limit);
    const last = rows.at(-1);
    const entries: JournalEntry[] = rows.map((row) => ({
      key: `${row.kind}:${row.id}`,
      kind: row.kind,
      itemId: row.item_id,
      attemptId: row.kind === "attempt" ? row.id : null,
      at: row.at,
      by: row.by,
      via: row.via,
    }));
    const itemIds = [...new Set(entries.map((entry) => entry.itemId))];
    const list = itemIds.length
      ? await loadItems(c.var.db, and(inArray(items.id, itemIds), isNull(items.deletedAt)))
      : [];
    return c.json<JournalResponse>({
      entries,
      items: list,
      next: results.length > limit && last ? `${last.at}.${last.rank}.${last.id}` : null,
    });
  })

  /** One month (or any span) in numbers, for its heading. */
  .get("/summary", async (c) => {
    const parsed = summaryQuery.safeParse(c.req.query());
    if (!parsed.success) return apiError(c, 400, "invalid", "That month couldn't be read.");
    const { from, to } = parsed.data;
    const [counts, finished] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(
        `SELECT count(*) AS prints,
          coalesce(sum(a.outcome = 'success'), 0) AS worked,
          coalesce(sum(a.outcome = 'partial'), 0) AS partly,
          coalesce(sum(a.outcome = 'failed'), 0) AS spaghetti
        FROM attempts AS a JOIN items AS i ON i.id = a.item_id
        WHERE a.deleted_at IS NULL AND i.deleted_at IS NULL AND a.outcome IS NOT NULL AND a.printed_at BETWEEN ? AND ?`,
      ).bind(from, to),
      c.env.DB.prepare(
        `SELECT id, title FROM items WHERE deleted_at IS NULL AND stage = 'done' AND finished_at BETWEEN ? AND ?
        ORDER BY finished_at DESC`,
      ).bind(from, to),
    ]);
    const row = (counts?.results[0] ?? {}) as Record<string, number>;
    return c.json<JournalSummaryResponse>({
      summary: {
        prints: row.prints ?? 0,
        worked: row.worked ?? 0,
        partly: row.partly ?? 0,
        spaghetti: row.spaghetti ?? 0,
        finished: (finished?.results ?? []) as Array<{ id: string; title: string | null }>,
      },
    });
  });

/** For the OpenAPI document (worker/openapi). */
export { journalQuery, summaryQuery };
