import { and, desc, eq, gt, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { Hono } from "hono";
import type { DeletedAttempt, DeletedItem, DeletedResponse } from "../../shared/api.ts";
import { PURGE_AFTER_MS } from "../../shared/deleted.ts";
import { attempts, items, photos } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";

/** Most that are listed of each kind: a month of two people's deletes is far fewer. */
const LIMIT = 200;

/**
 * Recently deleted: ideas, builds and attempts that can still be restored (each has a restore endpoint,
 * decision 0006). People only. An empty idea or build, deleted untouched (a stray tap on "New build"),
 * is left out: there is nothing in it to bring back. An attempt is listed only while its build is
 * still there: restoring the build brings its attempts back with it.
 */
export const deletedRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const db = c.var.db;
  const since = new Date(Date.now() - PURGE_AFTER_MS);
  const itemRows = await db
    .select()
    .from(items)
    .where(and(isNotNull(items.deletedAt), gt(items.deletedAt, since)))
    .orderBy(desc(items.deletedAt))
    .limit(LIMIT);
  const ids = itemRows.map((row) => row.id);
  const firstPhoto = new Map<string, string>();
  const hasAttempts = new Set<string>();
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    const photoRows = await db
      .select({ id: photos.id, itemId: photos.itemId })
      .from(photos)
      .where(and(inArray(photos.itemId, slice), isNull(photos.attemptId)))
      .orderBy(photos.position);
    for (const row of photoRows) if (!firstPhoto.has(row.itemId)) firstPhoto.set(row.itemId, row.id);
    const attemptRows = await db
      .selectDistinct({ itemId: attempts.itemId })
      .from(attempts)
      .where(inArray(attempts.itemId, slice));
    for (const row of attemptRows) hasAttempts.add(row.itemId);
  }
  const listed: DeletedItem[] = itemRows
    .filter((row) => row.title || row.note || firstPhoto.has(row.id) || hasAttempts.has(row.id))
    .map((row) => ({
      id: row.id,
      stage: row.stage,
      title: row.title,
      note: row.note,
      deletedAt: row.deletedAt?.getTime() ?? 0,
      photoId: firstPhoto.get(row.id) ?? null,
    }));
  const attemptRows = await db
    .select({
      id: attempts.id,
      itemId: attempts.itemId,
      itemTitle: items.title,
      outcome: attempts.outcome,
      printedAt: attempts.printedAt,
      deletedAt: attempts.deletedAt,
    })
    .from(attempts)
    .innerJoin(items, eq(items.id, attempts.itemId))
    .where(
      and(
        isNotNull(attempts.deletedAt),
        gt(attempts.deletedAt, since),
        isNull(items.deletedAt),
        ne(items.stage, "idea"),
      ),
    )
    .orderBy(desc(attempts.deletedAt))
    .limit(LIMIT);
  // Attempts of a build scrapped back to an idea are not listed (stage idea): the build's undo toast restores them, and
  // a lone attempt on an idea would make no sense.
  const listedAttempts: DeletedAttempt[] = attemptRows.map((row) => ({
    id: row.id,
    itemId: row.itemId,
    itemTitle: row.itemTitle,
    outcome: row.outcome,
    printedAt: row.printedAt.getTime(),
    deletedAt: row.deletedAt?.getTime() ?? 0,
  }));
  return c.json<DeletedResponse>({ items: listed, attempts: listedAttempts });
});
