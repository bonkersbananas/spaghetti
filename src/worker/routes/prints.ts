/**
 * /api/attempts/:id/…: which build a print belongs to (decision 0076). The builds and ideas it may belong to, moving
 * it to another build (or a new one) with its photos, note, outcome and settings, the undo of that, and the answer
 * "it's a new build" to the printer's question. Moving and answering are people's: the printer bridge's token only
 * files its own print (POST /api/items/:id/attempts), and no scope lists these writes.
 */
import { and, eq, isNull, max, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import { z } from "zod";
import type { AttemptResponse, MoveAttemptResponse, PrintSuggestionsResponse } from "../../shared/api.ts";
import { MAX_SUGGESTIONS, SUGGEST_SCORE } from "../../shared/print-match.ts";
import { recordChange } from "../changes.ts";
import type { Db } from "../db/index.ts";
import {
  attemptMoves,
  attempts,
  coachRuns,
  comments,
  itemFiles,
  items,
  photoReads,
  photos,
  printJobs,
  reactions,
  recipes,
} from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { latestMove, ownBuildOf, printFactsOf, suggestFor } from "../prints.ts";
import { loadAttempt } from "./attempts.ts";
import { loadItem, stageDates } from "./items.ts";

const moveAttempt = z
  .object({
    targetId: z.uuid().optional(),
    newBuild: z.object({ id: z.uuid(), title: z.string().trim().max(200).nullable().optional() }).optional(),
  })
  .refine((body) => !!body.targetId !== !!body.newBuild, "Either a build or a new one.");

const updatePrint = z.object({ asking: z.boolean() });

const notFound = "That attempt isn't here any more.";

type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

/** An attempt that isn't deleted, with its build, which isn't either. */
function findLive(db: Db, attemptId: string) {
  return db
    .select({ attempt: attempts, item: items })
    .from(attempts)
    .innerJoin(items, eq(items.id, attempts.itemId))
    .where(and(eq(attempts.id, attemptId), isNull(attempts.deletedAt), isNull(items.deletedAt)))
    .get();
}

/**
 * Whether a build goes with the print that leaves it: one the printer made (an agent's), with nothing else in it, no
 * attempt, photo, file, note, comment or reaction of its own. That is merging it into the build the print goes to.
 */
async function leftEmpty(db: Db, item: typeof items.$inferSelect, attemptId: string): Promise<boolean> {
  if (!item.createdVia || item.note.trim()) return false;
  const [attempt, photo, file, said, reacted] = await Promise.all([
    db
      .select({ id: attempts.id })
      .from(attempts)
      .where(and(eq(attempts.itemId, item.id), isNull(attempts.deletedAt), sql`${attempts.id} <> ${attemptId}`))
      .get(),
    db
      .select({ id: photos.id })
      .from(photos)
      .where(
        and(
          eq(photos.itemId, item.id),
          isNull(photos.deletedAt),
          sql`(${photos.attemptId} IS NULL OR ${photos.attemptId} <> ${attemptId})`,
        ),
      )
      .get(),
    db
      .select({ id: itemFiles.id })
      .from(itemFiles)
      .where(and(eq(itemFiles.itemId, item.id), isNull(itemFiles.deletedAt)))
      .get(),
    db
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.itemId, item.id), isNull(comments.deletedAt)))
      .get(),
    db.select({ id: reactions.targetId }).from(reactions).where(eq(reactions.itemId, item.id)).get(),
  ]);
  return !attempt && !photo && !file && !said && !reacted;
}

/** The statements that carry an attempt's own rows (its photos' reads, Claude's ideas, a recipe's source) along. */
function followers(db: Db, attemptId: string, itemId: string) {
  return [
    db.update(photoReads).set({ itemId }).where(eq(photoReads.attemptId, attemptId)),
    db.update(coachRuns).set({ itemId }).where(eq(coachRuns.attemptId, attemptId)),
    db.update(recipes).set({ sourceItemId: itemId }).where(eq(recipes.sourceAttemptId, attemptId)),
  ];
}

export const attemptPrintRoutes = new Hono<AppEnv>()
  /** The builds and ideas a print (or any attempt) may belong to, best first, with why. */
  .get("/:id/suggestions", async (c) => {
    const db = c.var.db;
    const found = await findLive(db, c.req.param("id"));
    if (!found) return apiError(c, 404, "not_found", notFound);
    const facts = await printFactsOf(db, found.attempt);
    const scored = facts.name || facts.fileId ? await suggestFor(db, facts, [found.attempt.itemId]) : [];
    return c.json<PrintSuggestionsResponse>({
      suggestions: scored.filter((one) => one.score >= SUGGEST_SCORE).slice(0, MAX_SUGGESTIONS),
    });
  })

  /**
   * Moves an attempt to another build or idea (an idea becomes a build by it), or to a new build: its photos keep
   * their order after the target's own, its note, outcome, tags, settings, file and Claude's notes go with it, and
   * the parts it counted (the other build's) are kept for the undo. A printer's build left with nothing goes too,
   * merged into the target. "A new build" for a print the app matched brings back the printer's own build instead
   * of making another. Moving it where it already is changes nothing (a retry).
   */
  .post("/:id/move", async (c) => {
    const parsed = moveAttempt.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That move couldn't be read.");
    const body = parsed.data;
    const db = c.var.db;
    const found = await findLive(db, c.req.param("id"));
    if (!found) return apiError(c, 404, "not_found", notFound);
    const { attempt, item: source } = found;
    const job = await db.select().from(printJobs).where(eq(printJobs.attemptId, attempt.id)).get();
    const own = job ? ownBuildOf(job) : null;
    // "A new build" for a print the printer filed is the build it made for it, wherever that is now.
    const wantedId = body.newBuild && own && own !== source.id ? own : (body.targetId ?? body.newBuild?.id ?? "");

    if (attempt.itemId === wantedId) {
      const to = await loadItem(db, wantedId);
      if (!to) return apiError(c, 404, "not_found", notFound);
      return c.json<MoveAttemptResponse>({ attempt: await loadAttempt(db, attempt), from: null, to });
    }

    const existing = await db.select().from(items).where(eq(items.id, wantedId)).get();
    let made: "new" | "restored" | null = null;
    if (!existing) {
      if (!body.newBuild) return apiError(c, 404, "not_found", "That build isn't here any more.");
      made = "new";
    } else if (existing.deletedAt) {
      // The printer's own build, merged away when its print was matched: brought back for it.
      if (!(existing.id === own && existing.mergedInto)) return apiError(c, 404, "not_found", "That build is gone.");
      made = "restored";
    }

    const now = new Date();
    const actor = c.var.actor;
    const [moving, last, goes] = await Promise.all([
      db.select({ id: photos.id, position: photos.position }).from(photos).where(eq(photos.attemptId, attempt.id)),
      db
        .select({ value: max(photos.position) })
        .from(photos)
        .where(eq(photos.itemId, wantedId))
        .get(),
      leftEmpty(db, source, attempt.id),
    ]);
    const base = (last?.value ?? -1) + 1;
    const startsIt = existing?.stage === "idea";

    const statements: BatchItem<"sqlite">[] = [];
    if (made === "new") {
      statements.push(
        db
          .insert(items)
          .values({
            id: wantedId,
            title: body.newBuild?.title?.trim() || null,
            stage: "building",
            startedAt: now,
            createdBy: c.var.user.id,
            createdVia: c.var.via,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing(),
        recordChange(db, { entity: "item", id: wantedId, itemId: wantedId, action: "created", actor }),
      );
    } else if (made === "restored") {
      statements.push(
        db.update(items).set({ deletedAt: null, mergedInto: null, updatedAt: now }).where(eq(items.id, wantedId)),
        recordChange(db, { entity: "item", id: wantedId, itemId: wantedId, action: "restored", actor }),
      );
    }
    statements.push(
      db
        .update(attempts)
        .set({ itemId: wantedId, parts: [], updatedAt: now })
        .where(and(eq(attempts.id, attempt.id), eq(attempts.itemId, source.id))),
      recordChange(db, { entity: "attempt", id: attempt.id, itemId: wantedId, action: "updated", actor }),
      ...moving.map((photo, index) =>
        db
          .update(photos)
          .set({ itemId: wantedId, position: base + index })
          .where(and(eq(photos.id, photo.id), eq(photos.attemptId, attempt.id))),
      ),
      ...followers(db, attempt.id, wantedId),
      db
        .update(items)
        .set({
          ...(existing && startsIt ? { ...stageDates(existing, "building", now), upNext: null } : {}),
          updatedAt: now,
        })
        .where(eq(items.id, wantedId)),
      recordChange(db, { entity: "item", id: wantedId, itemId: wantedId, action: "updated", actor }),
    );
    if (goes) {
      statements.push(
        db
          .update(items)
          .set({ deletedAt: now, mergedInto: wantedId })
          .where(and(eq(items.id, source.id), isNull(items.deletedAt))),
        recordChange(db, { entity: "item", id: source.id, itemId: source.id, action: "deleted", actor }),
      );
    } else {
      statements.push(
        db.update(items).set({ updatedAt: now }).where(eq(items.id, source.id)),
        recordChange(db, { entity: "item", id: source.id, itemId: source.id, action: "updated", actor }),
      );
    }
    statements.push(
      db.insert(attemptMoves).values({
        id: crypto.randomUUID(),
        attemptId: attempt.id,
        fromItemId: source.id,
        toItemId: wantedId,
        fromTitle: source.title,
        fromRemoved: goes,
        toStarted: startsIt,
        toMade: made !== null,
        photos: moving,
        parts: attempt.parts,
        wasAsking: job ? job.asking : null,
        movedBy: c.var.user.id,
        movedVia: c.var.via,
        movedAt: now,
      }),
    );
    if (job) {
      statements.push(
        db
          .update(printJobs)
          .set({ asking: false, settledAt: now, settledBy: c.var.user.id })
          .where(eq(printJobs.attemptId, attempt.id)),
      );
    }
    await db.batch(statements as Batch);

    const moved = await db.select().from(attempts).where(eq(attempts.id, attempt.id)).get();
    const [to, from] = await Promise.all([loadItem(db, wantedId), goes ? null : loadItem(db, source.id)]);
    if (!moved || !to) return apiError(c, 404, "not_found", notFound);
    return c.json<MoveAttemptResponse>({ attempt: await loadAttempt(db, moved), from, to });
  })

  /**
   * The undo of the last move: the attempt goes back with its photos in their places and the parts it counted there;
   * a build that went with it comes back, an idea it started is an idea again, a build made for it goes again, and
   * the printer's question is asked again if it was. Refused once the attempt has moved on since.
   */
  .post("/:id/unmove", async (c) => {
    const db = c.var.db;
    const found = await findLive(db, c.req.param("id"));
    if (!found) return apiError(c, 404, "not_found", notFound);
    const { attempt } = found;
    const move = await latestMove(db, attempt.id);
    if (!move || move.toItemId !== attempt.itemId) {
      return apiError(c, 409, "moved_since", "It has moved since. Move it from where it is now.");
    }
    const from = await db.select().from(items).where(eq(items.id, move.fromItemId)).get();
    if (!from || (from.deletedAt && !move.fromRemoved)) return apiError(c, 404, "not_found", "That build is gone.");

    const now = new Date();
    const actor = c.var.actor;
    const toId = move.toItemId;
    const statements: BatchItem<"sqlite">[] = [];
    if (move.fromRemoved && from.deletedAt) {
      statements.push(
        db.update(items).set({ deletedAt: null, mergedInto: null, updatedAt: now }).where(eq(items.id, from.id)),
        recordChange(db, { entity: "item", id: from.id, itemId: from.id, action: "restored", actor }),
      );
    }
    statements.push(
      db
        .update(attempts)
        .set({ itemId: from.id, parts: move.parts, updatedAt: now })
        .where(and(eq(attempts.id, attempt.id), eq(attempts.itemId, toId))),
      recordChange(db, { entity: "attempt", id: attempt.id, itemId: from.id, action: "updated", actor }),
      db.update(photos).set({ itemId: from.id }).where(eq(photos.attemptId, attempt.id)),
      ...move.photos.map((photo) =>
        db
          .update(photos)
          .set({ position: photo.position })
          .where(and(eq(photos.id, photo.id), eq(photos.attemptId, attempt.id))),
      ),
      ...followers(db, attempt.id, from.id),
      db.update(items).set({ updatedAt: now }).where(eq(items.id, from.id)),
    );
    const emptyNow = sql`NOT EXISTS (SELECT 1 FROM attempts WHERE item_id = ${toId} AND deleted_at IS NULL)`;
    if (move.toMade) {
      // A build made (or brought back) for it goes again, if nothing else went into it since.
      statements.push(
        db
          .update(items)
          .set({ deletedAt: now, mergedInto: from.id })
          .where(and(eq(items.id, toId), isNull(items.deletedAt), emptyNow)),
        recordChange(db, { entity: "item", id: toId, itemId: toId, action: "deleted", actor }),
      );
    } else {
      if (move.toStarted) {
        // An idea it started is an idea again, if nothing else was printed in it since.
        statements.push(
          db
            .update(items)
            .set({ stage: "idea", startedAt: null, finishedAt: null })
            .where(and(eq(items.id, toId), eq(items.stage, "building"), emptyNow)),
        );
      }
      statements.push(
        db.update(items).set({ updatedAt: now }).where(eq(items.id, toId)),
        recordChange(db, { entity: "item", id: toId, itemId: toId, action: "updated", actor }),
      );
    }
    statements.push(db.delete(attemptMoves).where(eq(attemptMoves.id, move.id)));
    if (move.wasAsking !== null) {
      statements.push(
        db
          .update(printJobs)
          .set(move.wasAsking ? { asking: true, settledAt: null, settledBy: null } : { asking: false })
          .where(eq(printJobs.attemptId, attempt.id)),
      );
    }
    await db.batch(statements as Batch);

    const back = await db.select().from(attempts).where(eq(attempts.id, attempt.id)).get();
    const [to, left] = await Promise.all([loadItem(db, from.id), loadItem(db, toId)]);
    if (!back || !to) return apiError(c, 404, "not_found", notFound);
    return c.json<MoveAttemptResponse>({ attempt: await loadAttempt(db, back), from: left, to });
  })

  /** Answers the printer's "which build is this?" with "a new one" (`asking: false`), or asks again (the undo). */
  .put("/:id/print", async (c) => {
    const parsed = updatePrint.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That couldn't be read.");
    const db = c.var.db;
    const found = await findLive(db, c.req.param("id"));
    if (!found) return apiError(c, 404, "not_found", notFound);
    const { attempt } = found;
    const asking = parsed.data.asking;
    const now = new Date();
    const [changed] = await db.batch([
      db
        .update(printJobs)
        .set(
          asking ? { asking, settledAt: null, settledBy: null } : { asking, settledAt: now, settledBy: c.var.user.id },
        )
        .where(
          and(
            eq(printJobs.attemptId, attempt.id),
            eq(printJobs.asking, !asking),
            // Only a print still in the build the printer put it in asks.
            eq(printJobs.itemId, attempt.itemId),
          ),
        )
        .returning({ id: printJobs.attemptId }),
      recordChange(db, {
        entity: "attempt",
        id: attempt.id,
        itemId: attempt.itemId,
        action: "updated",
        actor: c.var.actor,
      }),
    ]);
    if (!changed.length) {
      const job = await db.select().from(printJobs).where(eq(printJobs.attemptId, attempt.id)).get();
      if (!job) return apiError(c, 404, "not_found", "The printer didn't file that print.");
    }
    return c.json<AttemptResponse>({ attempt: await loadAttempt(db, attempt) });
  });

/** For the OpenAPI document (worker/openapi). */
export { moveAttempt, updatePrint };
