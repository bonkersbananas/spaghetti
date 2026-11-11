import { asc, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { CHANGES_PAGE, type ChangesResponse } from "../../shared/changes.ts";
import { toApiChange } from "../changes.ts";
import { changes } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";

const query = z.object({ after: z.coerce.number().int().min(0).optional() });

/**
 * GET /api/changes?after=<cursor>: what changed since the cursor (see ChangesResponse in
 * shared/changes.ts). Polled every few seconds, so "nothing new" costs one indexed read.
 */
export const changeRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const parsed = query.safeParse(c.req.query());
  if (!parsed.success) return apiError(c, 400, "invalid", "The cursor must be a whole number.");
  const { after } = parsed.data;
  const db = c.var.db;

  const edge = await db
    .select({
      head: sql<number>`coalesce(max(${changes.seq}), 0)`,
      tail: sql<number>`coalesce(min(${changes.seq}), 0)`,
    })
    .from(changes)
    .get();
  const head = edge?.head ?? 0;
  const tail = edge?.tail ?? 0;
  if (after === undefined) return c.json<ChangesResponse>({ changes: [], cursor: head, more: false, reset: false });
  if (after === head) return c.json<ChangesResponse>({ changes: [], cursor: head, more: false, reset: false });
  // From the future (another database), or from before the oldest row kept: can't be followed.
  if (after > head || (tail > 0 && after < tail - 1)) {
    return c.json<ChangesResponse>({ changes: [], cursor: head, more: false, reset: true });
  }
  const rows = await db
    .select()
    .from(changes)
    .where(gt(changes.seq, after))
    .orderBy(asc(changes.seq))
    .limit(CHANGES_PAGE + 1);
  const page = rows.slice(0, CHANGES_PAGE);
  return c.json<ChangesResponse>({
    changes: page.map(toApiChange),
    cursor: page.at(-1)?.seq ?? after,
    more: rows.length > page.length,
    reset: false,
  });
});

/** For the OpenAPI document (worker/openapi). */
export { query as changesQuery };
