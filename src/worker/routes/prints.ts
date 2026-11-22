/**
 * /api/attempts/:id/…: which build a print belongs to (decision 0076). The builds and ideas it may belong to, moving
 * it to another build (or a new one) with its photos, note, outcome and settings, the undo of that, the answer "it's
 * a new build" to the printer's question, and who started a print the printer recorded. Moving and answering are
 * people's: the printer bridge's token only files its own print (POST /api/items/:id/attempts), and no scope lists
 * these writes.
 */
import { and, eq, isNull, max, type SQL, sql } from "drizzle-orm";
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
  parts,
  photoReads,
  photos,
  printJobs,
  reactions,
  recipes,
  shares,
  users,
} from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { latestMove, ownBuildOf, printerAgents, printFactsOf, suggestFor } from "../prints.ts";
import { loadAttempt } from "./attempts.ts";
import { loadItem, stageDates } from "./items.ts";

const moveAttempt = z
  .object({
    targetId: z.uuid().optional(),
    newBuild: z.object({ id: z.uuid(), title: z.string().trim().max(200).nullable().optional() }).optional(),
  })
  .refine((body) => !!body.targetId !== !!body.newBuild, "Either a build or a new one.");

const updatePrint = z.object({ asking: z.boolean() });

const updateStartedBy = z.object({ startedBy: z.string().min(1).max(64).nullable() });

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
 * Whether a build goes with the print that leaves it: the build the printer made for this very print (its
 * print_jobs row says so), still as the printer left it: its title, nothing else in it and nothing anyone gave it.
 * That is merging it into the build the print goes to. Any other build stays, whoever made it.
 */
async function printerBuildGoes(
  db: Db,
  item: typeof items.$inferSelect,
  attemptId: string,
  job: typeof printJobs.$inferSelect | undefined,
): Promise<boolean> {
  if (!job || ownBuildOf(job) !== item.id) return false;
  if (job.ownTitle === null || item.title !== job.ownTitle) return false;
  return bare(db, item, attemptId);
}

/**
 * Nothing in a build but this attempt: no other attempt, photo, file, part, note, comment, reaction or live link,
 * and nobody it is for and no twist it comes from.
 */
async function bare(db: Db, item: typeof items.$inferSelect, attemptId: string): Promise<boolean> {
  if (item.note.trim() || item.forWhom || item.twistId) return false;
  const found = await Promise.all([
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
    db.select({ id: parts.id }).from(parts).where(eq(parts.itemId, item.id)).get(),
    db
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.itemId, item.id), isNull(comments.deletedAt)))
      .get(),
    db.select({ id: reactions.targetId }).from(reactions).where(eq(reactions.itemId, item.id)).get(),
    db
      .select({ id: shares.id })
      .from(shares)
      .where(and(eq(shares.kind, "item"), eq(shares.targetId, item.id), isNull(shares.revokedAt)))
      .get(),
  ]);
  return found.every((row) => !row);
}

/** The statements that carry an attempt's own rows (its photos' reads, Claude's ideas, a recipe's source) along. */
function followers(db: Db, attemptId: string, itemId: string, guard: SQL) {
  return [
    db
      .update(photoReads)
      .set({ itemId })
      .where(and(eq(photoReads.attemptId, attemptId), guard)),
    db
      .update(coachRuns)
      .set({ itemId })
      .where(and(eq(coachRuns.attemptId, attemptId), guard)),
    db
      .update(recipes)
      .set({ sourceItemId: itemId })
      .where(and(eq(recipes.sourceAttemptId, attemptId), guard)),
  ];
}

/** "This attempt is in that build now": the guard of every statement after a move's (or an undo's) own. */
const attemptIn = (attemptId: string, itemId: string) =>
  sql`EXISTS (SELECT 1 FROM attempts WHERE id = ${attemptId} AND item_id = ${itemId} AND deleted_at IS NULL)`;
const moveRow = (moveId: string) => sql`EXISTS (SELECT 1 FROM attempt_moves WHERE id = ${moveId})`;
const nothingPrintedIn = (itemId: string) =>
  sql`NOT EXISTS (SELECT 1 FROM attempts WHERE item_id = ${itemId} AND deleted_at IS NULL)`;

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
   * the parts it counted (the other build's) are kept for the undo. The build the printer made for the print goes
   * too when nothing else is in it, merged into the target. "A new build" for a print the app matched brings back the
   * printer's own build instead of making another. Moving it where it already is changes nothing (a retry).
   *
   * One batch, claimed by its first statement: the move's row goes in only while the attempt is still where this
   * request found it and the target is as it was, and every later statement runs only if that row is there. Two moves
   * at once: one wins whole, the other changes nothing and is refused.
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
    const moveId = crypto.randomUUID();
    const [moving, last, goes, other] = await Promise.all([
      db.select({ id: photos.id, position: photos.position }).from(photos).where(eq(photos.attemptId, attempt.id)),
      db
        .select({ value: max(photos.position) })
        .from(photos)
        .where(eq(photos.itemId, wantedId))
        .get(),
      printerBuildGoes(db, source, attempt.id, job),
      db
        .select({ id: attempts.id })
        .from(attempts)
        .where(and(eq(attempts.itemId, source.id), isNull(attempts.deletedAt), sql`${attempts.id} <> ${attempt.id}`))
        .get(),
    ]);
    const base = (last?.value ?? -1) + 1;
    const startsIt = !made && existing?.stage === "idea";
    // An idea the app started by matching this print into it is an idea again once the print leaves, in its place in
    // Up next, if nothing else was printed in it (the undo starts it again: an attempt in an idea makes it a build).
    const unstarts = !!job?.startedIdea && job.itemId === source.id && source.stage === "building" && !other;
    const removes = goes && !unstarts;

    // The claim: the attempt is still in the build this request found it in, which is still there, and the target is
    // as this request saw it (a build or idea still there, a new id still free, the printer's build still merged).
    const target =
      made === "new"
        ? sql`EXISTS (SELECT 1 FROM items WHERE id = ${wantedId} AND created_at = ${now.getTime()} AND created_by = ${c.var.user.id})`
        : made === "restored"
          ? sql`EXISTS (SELECT 1 FROM items WHERE id = ${wantedId} AND deleted_at IS NOT NULL AND merged_into IS NOT NULL)`
          : sql`EXISTS (SELECT 1 FROM items WHERE id = ${wantedId} AND deleted_at IS NULL AND stage = ${existing?.stage ?? ""})`;
    const claimed = moveRow(moveId);
    const statements: BatchItem<"sqlite">[] = [];
    if (made === "new") {
      // Made first, so the claim can see it is this request's; taken away again at the end if the claim failed.
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
      );
    }
    // The move's row, in attempt_moves' column order (id … moved_at, to_up_next).
    statements.push(
      db.insert(attemptMoves).select(sql`SELECT ${moveId}, ${attempt.id}, ${source.id}, ${wantedId}, ${source.title},
          ${removes ? 1 : 0}, ${startsIt ? 1 : 0}, ${made ? 1 : 0}, ${JSON.stringify(moving)},
          ${JSON.stringify(attempt.parts)}, ${job ? (job.asking ? 1 : 0) : null}, ${c.var.user.id}, ${c.var.via},
          ${now.getTime()}, ${startsIt ? (existing?.upNext ?? null) : null}
        WHERE ${attemptIn(attempt.id, source.id)}
          AND EXISTS (SELECT 1 FROM items WHERE id = ${source.id} AND deleted_at IS NULL)
          AND ${target}`),
    );
    if (made === "new") {
      statements.push(
        db
          .update(items)
          .set({ updatedAt: now })
          .where(and(eq(items.id, wantedId), claimed)),
        recordChange(db, { entity: "item", id: wantedId, itemId: wantedId, action: "created", actor }),
      );
    } else if (made === "restored") {
      statements.push(
        db
          .update(items)
          .set({ deletedAt: null, mergedInto: null, updatedAt: now })
          .where(and(eq(items.id, wantedId), claimed)),
        recordChange(db, { entity: "item", id: wantedId, itemId: wantedId, action: "restored", actor }),
      );
    }
    statements.push(
      db
        .update(attempts)
        .set({ itemId: wantedId, parts: [], updatedAt: now })
        .where(and(eq(attempts.id, attempt.id), eq(attempts.itemId, source.id), claimed)),
      recordChange(db, { entity: "attempt", id: attempt.id, itemId: wantedId, action: "updated", actor }),
      ...moving.map((photo, index) =>
        db
          .update(photos)
          .set({ itemId: wantedId, position: base + index })
          .where(and(eq(photos.id, photo.id), eq(photos.attemptId, attempt.id), claimed)),
      ),
      ...followers(db, attempt.id, wantedId, claimed),
      db
        .update(items)
        .set({
          ...(existing && startsIt ? { ...stageDates(existing, "building", now), upNext: null } : {}),
          updatedAt: now,
        })
        .where(and(eq(items.id, wantedId), claimed)),
      recordChange(db, { entity: "item", id: wantedId, itemId: wantedId, action: "updated", actor }),
    );
    if (removes) {
      statements.push(
        db
          .update(items)
          .set({ deletedAt: now, mergedInto: wantedId })
          .where(and(eq(items.id, source.id), isNull(items.deletedAt), claimed, nothingPrintedIn(source.id))),
        recordChange(db, { entity: "item", id: source.id, itemId: source.id, action: "deleted", actor }),
      );
    } else {
      statements.push(
        db
          .update(items)
          .set({ updatedAt: now })
          .where(and(eq(items.id, source.id), claimed)),
        recordChange(db, { entity: "item", id: source.id, itemId: source.id, action: "updated", actor }),
      );
      if (unstarts) {
        statements.push(
          db
            .update(items)
            .set({ stage: "idea", startedAt: null, finishedAt: null, upNext: job?.ideaUpNext ?? null })
            .where(and(eq(items.id, source.id), eq(items.stage, "building"), claimed, nothingPrintedIn(source.id))),
        );
      }
    }
    if (job) {
      statements.push(
        db
          .update(printJobs)
          .set({ asking: false, settledAt: now, settledBy: c.var.user.id })
          .where(and(eq(printJobs.attemptId, attempt.id), claimed)),
      );
    }
    if (made === "new") {
      statements.push(
        db
          .delete(items)
          .where(
            and(eq(items.id, wantedId), eq(items.createdAt, now), sql`NOT ${claimed}`, nothingPrintedIn(wantedId)),
          ),
      );
    }
    await db.batch(statements as Batch);

    if (!(await db.select({ id: attemptMoves.id }).from(attemptMoves).where(eq(attemptMoves.id, moveId)).get())) {
      return apiError(c, 409, "moved_since", "It moved meanwhile, or its build changed. Look again.");
    }
    const moved = await db.select().from(attempts).where(eq(attempts.id, attempt.id)).get();
    const [to, from] = await Promise.all([loadItem(db, wantedId), loadItem(db, source.id)]);
    if (!moved || !to) return apiError(c, 404, "not_found", notFound);
    return c.json<MoveAttemptResponse>({ attempt: await loadAttempt(db, moved), from, to });
  })

  /**
   * The undo of the last move: the attempt goes back with its photos in their places and the parts it counted there;
   * a build that went with it comes back, an idea it started is an idea again (in its place in Up next), a build made
   * for it goes again if nobody put anything in it, and the printer's question is asked again if it was. Refused once
   * the attempt has moved on since. Guarded like the move: two undos at once undo it once.
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
    const made = move.toMade ? await db.select().from(items).where(eq(items.id, toId)).get() : undefined;
    const goesAgain = !!made && (await bare(db, made, attempt.id));
    // Before the attempt goes back: the move is still the last, and the attempt still where it put it.
    const pending = sql`${moveRow(move.id)} AND ${attemptIn(attempt.id, toId)}`;
    // After: it is back.
    const back = sql`${moveRow(move.id)} AND ${attemptIn(attempt.id, from.id)}`;
    const statements: BatchItem<"sqlite">[] = [];
    if (move.fromRemoved && from.deletedAt) {
      statements.push(
        db
          .update(items)
          .set({ deletedAt: null, mergedInto: null, updatedAt: now })
          .where(and(eq(items.id, from.id), pending)),
        recordChange(db, { entity: "item", id: from.id, itemId: from.id, action: "restored", actor }),
      );
    }
    statements.push(
      db
        .update(attempts)
        .set({ itemId: from.id, parts: move.parts, updatedAt: now })
        .where(and(eq(attempts.id, attempt.id), eq(attempts.itemId, toId), moveRow(move.id))),
      recordChange(db, { entity: "attempt", id: attempt.id, itemId: from.id, action: "updated", actor }),
      db
        .update(photos)
        .set({ itemId: from.id })
        .where(and(eq(photos.attemptId, attempt.id), back)),
      ...move.photos.map((photo) =>
        db
          .update(photos)
          .set({ position: photo.position })
          .where(and(eq(photos.id, photo.id), eq(photos.attemptId, attempt.id), back)),
      ),
      ...followers(db, attempt.id, from.id, back),
      db
        .update(items)
        .set({
          // An idea the move made an idea again is a build again with its print back.
          ...(from.stage === "idea" ? { ...stageDates(from, "building", now), upNext: null } : {}),
          updatedAt: now,
        })
        .where(and(eq(items.id, from.id), back)),
    );
    if (goesAgain) {
      // A build made (or brought back) for it goes again, if nothing else went into it since.
      statements.push(
        db
          .update(items)
          .set({ deletedAt: now, mergedInto: from.id })
          .where(and(eq(items.id, toId), isNull(items.deletedAt), back, nothingPrintedIn(toId))),
        recordChange(db, { entity: "item", id: toId, itemId: toId, action: "deleted", actor }),
      );
    } else {
      if (move.toStarted) {
        // An idea it started is an idea again, in its place in Up next, if nothing else was printed in it since.
        statements.push(
          db
            .update(items)
            .set({ stage: "idea", startedAt: null, finishedAt: null, upNext: move.toUpNext })
            .where(and(eq(items.id, toId), eq(items.stage, "building"), back, nothingPrintedIn(toId))),
        );
      }
      statements.push(
        db
          .update(items)
          .set({ updatedAt: now })
          .where(and(eq(items.id, toId), back)),
        recordChange(db, { entity: "item", id: toId, itemId: toId, action: "updated", actor }),
      );
    }
    if (move.wasAsking !== null) {
      statements.push(
        db
          .update(printJobs)
          .set(move.wasAsking ? { asking: true, settledAt: null, settledBy: null } : { asking: false })
          .where(and(eq(printJobs.attemptId, attempt.id), back)),
      );
    }
    statements.push(db.delete(attemptMoves).where(and(eq(attemptMoves.id, move.id), attemptIn(attempt.id, from.id))));
    await db.batch(statements as Batch);

    const after = await db.select().from(attempts).where(eq(attempts.id, attempt.id)).get();
    if (!after || after.itemId !== from.id) {
      return apiError(c, 409, "moved_since", "It has moved since. Move it from where it is now.");
    }
    const [to, left] = await Promise.all([loadItem(db, from.id), loadItem(db, toId)]);
    if (!to) return apiError(c, 404, "not_found", notFound);
    return c.json<MoveAttemptResponse>({ attempt: await loadAttempt(db, after), from: left, to });
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
  })

  /**
   * Who started a print from the printer, as a person says afterwards (decision 0076): one of the two of you, or
   * nobody again (Undo). The printer doesn't know, and pairing the bridge didn't start it, so until someone says, the
   * print is the printer's. People only: the bridge's token can't say, and an attempt someone logged is theirs.
   */
  .put("/:id/started-by", async (c) => {
    const parsed = updateStartedBy.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "Say who started it, or nobody.");
    const db = c.var.db;
    const found = await findLive(db, c.req.param("id"));
    if (!found) return apiError(c, 404, "not_found", notFound);
    const { attempt } = found;
    const who = parsed.data.startedBy;
    if (who && !(await db.select({ id: users.id }).from(users).where(eq(users.id, who)).get())) {
      return apiError(c, 400, "invalid", "That isn't one of you.");
    }
    if (!attempt.createdVia || !(await printerAgents(db)).has(attempt.createdVia)) {
      return apiError(c, 409, "not_from_printer", "Only a print from the printer can say who started it.");
    }
    const now = new Date();
    await db.batch([
      db
        .update(attempts)
        .set({ startedBy: who, updatedAt: now })
        .where(and(eq(attempts.id, attempt.id), isNull(attempts.deletedAt))),
      recordChange(db, {
        entity: "attempt",
        id: attempt.id,
        itemId: attempt.itemId,
        action: "updated",
        actor: c.var.actor,
      }),
    ]);
    return c.json<AttemptResponse>({ attempt: await loadAttempt(db, { ...attempt, startedBy: who, updatedAt: now }) });
  });

/** For the OpenAPI document (worker/openapi). */
export { moveAttempt, updatePrint, updateStartedBy };
