import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Outcome } from "../../shared/attempts.ts";
import { isRunningLow } from "../../shared/ledger.ts";
import { spoolName } from "../../shared/spools.ts";
import {
  attemptGrams,
  mondayOf,
  sundayOf,
  type Week,
  type WeekNote,
  type WeekPhoto,
  type WeekPrint,
  type WeekThread,
  type WeekWaiting,
  WORKSPACE_TIME_ZONE,
  weekBounds,
} from "../../shared/week.ts";
import { type Db, getDb } from "../db/index.ts";
import { attempts, comments, items, photos, spools, weeks } from "../db/schema.ts";
import { gramsFor } from "../ledger.ts";
import { toApiSpool } from "../routes/spools.ts";
import { loadUpkeep } from "../routes/upkeep.ts";

/** An idea that became a build more than a minute later was captured as an idea first (the journal's rule). */
const CAPTURED_FIRST_MS = 60_000;
/** A claim older than this is taken to be gone (the Worker was recycled after the response). */
export const WEEK_CLAIM_STALE_MS = 4 * 60 * 1000;
const WAITING_SHOWN = 3;
const OUTCOME_ORDER: Record<Outcome, number> = { success: 0, partial: 1, failed: 2 };

const startOfNote = (note: string) => note.trim().replace(/\s+/g, " ").slice(0, 120);

/** The week's paragraph by Claude, as the page may see it: written, or being written. Nothing else is shown. */
export async function loadWeekNote(db: Db, monday: string, now: number): Promise<WeekNote | null> {
  const row = await db.select().from(weeks).where(eq(weeks.monday, monday)).get();
  if (!row) return null;
  if (row.status === "done" && row.text) return { status: "done", text: row.text };
  if (row.status === "thinking" && row.claimedAt && now - row.claimedAt.getTime() < WEEK_CLAIM_STALE_MS) {
    return { status: "thinking", text: null };
  }
  return null;
}

/**
 * Everything the week page says, worked out from the notebook (nothing about it is stored except Claude's
 * paragraph). A print belongs to the week it was printed in, by the workspace's clock, like the journal's;
 * deleted prints, builds, ideas, comments and photos are left out. `waiting` is what is waiting right now, so
 * only the current week has it.
 */
export async function loadWeek(env: Env, monday: string, now = Date.now(), db: Db = getDb(env.DB)): Promise<Week> {
  const timeZone = WORKSPACE_TIME_ZONE;
  const { start, end } = weekBounds(monday, timeZone);
  const startDate = new Date(start);
  const endDate = new Date(end);
  const current = mondayOf(now, timeZone) === monday;

  const rows = await db
    .select({
      id: attempts.id,
      itemId: attempts.itemId,
      outcome: attempts.outcome,
      printedAt: attempts.printedAt,
      settings: attempts.settings,
      createdBy: attempts.createdBy,
      title: items.title,
    })
    .from(attempts)
    .innerJoin(items, eq(items.id, attempts.itemId))
    .where(
      and(
        isNull(attempts.deletedAt),
        isNull(items.deletedAt),
        gte(attempts.printedAt, startDate),
        lt(attempts.printedAt, endDate),
      ),
    )
    .orderBy(desc(attempts.printedAt));

  // "Attempt 3" of its build: the place among the build's attempts, not among the week's.
  const itemIds = [...new Set(rows.map((row) => row.itemId))];
  const numbering = new Map<string, number>();
  for (let i = 0; i < itemIds.length; i += 50) {
    const all = await db
      .select({ id: attempts.id, itemId: attempts.itemId })
      .from(attempts)
      .where(and(inArray(attempts.itemId, itemIds.slice(i, i + 50)), isNull(attempts.deletedAt)))
      .orderBy(asc(attempts.printedAt), asc(attempts.id));
    const seen = new Map<string, number>();
    for (const entry of all) {
      const n = (seen.get(entry.itemId) ?? 0) + 1;
      seen.set(entry.itemId, n);
      numbering.set(entry.id, n);
    }
  }

  // The final photo of each finished print: its newest.
  const finishedIds = rows.filter((row) => row.outcome).map((row) => row.id);
  const finalPhoto = new Map<string, WeekPhoto>();
  for (let i = 0; i < finishedIds.length; i += 50) {
    const pictures = await db
      .select()
      .from(photos)
      .where(and(inArray(photos.attemptId, finishedIds.slice(i, i + 50)), isNull(photos.deletedAt)));
    const sorted = pictures.sort(
      (a, b) => (b.takenAt ?? b.createdAt).getTime() - (a.takenAt ?? a.createdAt).getTime() || b.position - a.position,
    );
    for (const photo of sorted) {
      if (photo.attemptId && !finalPhoto.has(photo.attemptId)) {
        finalPhoto.set(photo.attemptId, {
          id: photo.id,
          color: photo.color,
          width: photo.width,
          height: photo.height,
        });
      }
    }
  }

  const prints: WeekPrint[] = rows.map((row) => ({
    attemptId: row.id,
    itemId: row.itemId,
    title: row.title,
    attempt: numbering.get(row.id) ?? 1,
    outcome: row.outcome,
    at: row.printedAt.getTime(),
    by: row.createdBy,
    photo: finalPhoto.get(row.id) ?? null,
  }));
  const made = prints
    .filter((print) => print.outcome)
    .sort(
      (a, b) =>
        OUTCOME_ORDER[a.outcome as Outcome] - OUTCOME_ORDER[b.outcome as Outcome] ||
        // Those with a picture lead within an outcome: the page is photos first.
        Number(b.photo !== null) - Number(a.photo !== null) ||
        b.at - a.at,
    );
  const onTheBed = prints.filter((print) => !print.outcome);
  const count = (outcome: Outcome) => made.filter((print) => print.outcome === outcome).length;

  let grams = 0;
  let gramsKnown = false;
  let gramsApproximate = false;
  for (const row of rows) {
    const used = attemptGrams(row.outcome, row.settings);
    if (!used) continue;
    gramsKnown = true;
    grams += used.grams;
    gramsApproximate ||= used.approximate;
  }

  const [finished, captured, talk] = await Promise.all([
    db
      .select({ id: items.id, title: items.title, at: items.finishedAt })
      .from(items)
      .where(
        and(
          isNull(items.deletedAt),
          eq(items.stage, "done"),
          isNotNull(items.finishedAt),
          gte(items.finishedAt, startDate),
          lt(items.finishedAt, endDate),
        ),
      )
      .orderBy(desc(items.finishedAt)),
    db
      .select({
        id: items.id,
        stage: items.stage,
        title: items.title,
        note: items.note,
        by: items.createdBy,
        at: items.createdAt,
      })
      .from(items)
      .where(
        and(
          isNull(items.deletedAt),
          gte(items.createdAt, startDate),
          lt(items.createdAt, endDate),
          sql`(${items.startedAt} IS NULL OR ${items.startedAt} - ${items.createdAt} > ${CAPTURED_FIRST_MS})`,
        ),
      )
      .orderBy(desc(items.createdAt)),
    db
      .select({ itemId: comments.itemId, authorId: comments.authorId, title: items.title, stage: items.stage })
      .from(comments)
      .innerJoin(items, eq(items.id, comments.itemId))
      .where(
        and(
          isNull(comments.deletedAt),
          isNull(items.deletedAt),
          gte(comments.createdAt, startDate),
          lt(comments.createdAt, endDate),
        ),
      ),
  ]);

  const byPerson: Record<string, number> = {};
  const threads = new Map<string, WeekThread>();
  for (const comment of talk) {
    byPerson[comment.authorId] = (byPerson[comment.authorId] ?? 0) + 1;
    const thread = threads.get(comment.itemId) ?? {
      itemId: comment.itemId,
      stage: comment.stage,
      title: comment.title,
      count: 0,
    };
    thread.count += 1;
    threads.set(comment.itemId, thread);
  }

  const week: Week = {
    monday,
    sunday: sundayOf(monday),
    timeZone,
    start,
    end,
    current,
    prints: {
      total: prints.length,
      worked: count("success"),
      partly: count("partial"),
      spaghetti: count("failed"),
      printing: onTheBed.length,
    },
    made,
    onTheBed,
    buildsFinished: finished.map((row) => ({ id: row.id, title: row.title, at: row.at?.getTime() ?? 0 })),
    ideas: captured.map((row) => ({
      id: row.id,
      stage: row.stage,
      title: row.title,
      note: startOfNote(row.note),
      by: row.by,
      at: row.at.getTime(),
    })),
    comments: {
      total: talk.length,
      byPerson,
      threads: [...threads.values()].sort((a, b) => b.count - a.count),
    },
    grams: gramsKnown ? Math.round(grams) : null,
    gramsApproximate,
    waiting: current ? await loadWaiting(env, db, now) : null,
    note: await loadWeekNote(db, monday, now),
    empty: false,
  };
  week.empty = !week.prints.total && !week.buildsFinished.length && !week.ideas.length && !week.comments.total;
  // A quiet week has nothing for Claude to say; whatever a row holds, the page doesn't show it.
  if (week.empty) week.note = null;
  return week;
}

/** What is waiting right now: the queue, builds whose last print failed, spools running low, upkeep due. */
async function loadWaiting(env: Env, db: Db, now: number): Promise<WeekWaiting> {
  const [upNext, failedLast, spoolRows, upkeep] = await Promise.all([
    db
      .select({ id: items.id, title: items.title })
      .from(items)
      .where(and(isNull(items.deletedAt), eq(items.stage, "idea"), isNotNull(items.upNext)))
      .orderBy(asc(items.upNext))
      .limit(WAITING_SHOWN),
    env.DB.prepare(
      `SELECT i.id AS id, i.title AS title FROM items AS i
        WHERE i.deleted_at IS NULL AND i.stage = 'building'
          AND (SELECT a.outcome FROM attempts AS a WHERE a.item_id = i.id AND a.deleted_at IS NULL
                ORDER BY a.printed_at DESC LIMIT 1) = 'failed'
        ORDER BY i.updated_at DESC LIMIT ?`,
    )
      .bind(WAITING_SHOWN)
      .all<{ id: string; title: string | null }>(),
    db.select().from(spools).where(isNull(spools.deletedAt)),
    loadUpkeep(db, now),
  ]);
  const ledger = await gramsFor(db, env.DB, spoolRows);
  const low = spoolRows
    .map((row) => toApiSpool(row, null, ledger.get(row.id)))
    .filter((spool) => isRunningLow(spool))
    .sort((a, b) => (a.gramsLeft ?? 1e9) - (b.gramsLeft ?? 1e9))
    .slice(0, WAITING_SHOWN)
    .map((spool) => ({ id: spool.id, name: spoolName(spool).title, gramsLeft: spool.gramsLeft }));
  return {
    upNext,
    failedLast: failedLast.results,
    low,
    upkeep: upkeep.tasks
      .filter((task) => task.due)
      .slice(0, WAITING_SHOWN)
      .map((task) => ({ id: task.id, name: task.name })),
  };
}
