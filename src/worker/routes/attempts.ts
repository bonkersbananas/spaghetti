import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AttemptResponse, FinishAttemptResponse } from "../../shared/api.ts";
import {
  type AttemptSettings,
  byPrintTime,
  carryOver,
  mergeNote,
  NOZZLES,
  OUTCOMES,
  SUPPORT_TYPES,
  unionTags,
} from "../../shared/attempts.ts";
import type { Db } from "../db/index.ts";
import { type Attempt, attempts, items } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError, toApiAttempts } from "../http.ts";
import { stageDates } from "./items.ts";

const id = z.uuid();
const words = z.string().trim().max(120);
const between = (min: number, max: number) => z.number().min(min).max(max);
const temperature = between(0, 500);

const filament = z.object({
  type: words.optional(),
  brand: words.optional(),
  colorHex: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .transform((value) => value.toLowerCase())
    .optional(),
  colorName: words.optional(),
  profile: words.optional(),
  amsSlot: z.string().trim().max(16).optional(),
});

/** Every field optional; unknown keys are dropped. */
const settings = z.object({
  filaments: z.array(filament).max(32).optional(),
  bedType: words.optional(),
  nozzle: z.enum(NOZZLES).optional(),
  nozzleDiameter: between(0.1, 2).optional(),
  layerHeight: between(0.01, 2).optional(),
  infillDensity: between(0, 100).optional(),
  supportEnabled: z.boolean().optional(),
  supportType: z.enum(SUPPORT_TYPES).optional(),
  brim: z.boolean().optional(),
  processPreset: words.optional(),
  nozzleTemperature: temperature.optional(),
  bedTemperature: temperature.optional(),
  chamberTemperature: temperature.optional(),
  estimatedMinutes: between(0, 100_000).optional(),
  actualMinutes: between(0, 100_000).optional(),
  weightGrams: between(0, 100_000).optional(),
  failedAtPercent: between(0, 100).optional(),
  failedAtLayer: z.number().int().min(0).max(100_000).optional(),
  filamentDried: z.boolean().optional(),
}) satisfies z.ZodType<AttemptSettings>;

/** Tag slugs (built in or people's own), each once, in the order given. */
const slugs = z
  .array(
    z
      .string()
      .max(48)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  )
  .max(40)
  .transform((list) => [...new Set(list)]);

const outcome = z.enum(OUTCOMES).nullable();
const printedAt = z.number().int().positive();
const note = z.string().max(20_000);

const createAttempt = z.object({
  id,
  outcome: outcome.optional(),
  printedAt: printedAt.optional(),
  note: note.optional(),
  failureTags: slugs.optional(),
  successNotes: slugs.optional(),
  settings: settings.optional(),
});

const updateAttempt = z.object({
  outcome: outcome.optional(),
  printedAt: printedAt.optional(),
  note: note.optional(),
  failureTags: slugs.optional(),
  successNotes: slugs.optional(),
  settings: settings.optional(),
});

const finishAttempt = z.object({
  outcome: z.enum(OUTCOMES),
  finishedAt: z.number().int().positive().optional(),
  note: note.optional(),
  failureTags: slugs.optional(),
  successNotes: slugs.optional(),
});

const notFound = "That attempt isn't here any more.";

/** An item's attempts that aren't deleted. */
function liveAttempts(db: Db, itemId: string) {
  return db
    .select()
    .from(attempts)
    .where(and(eq(attempts.itemId, itemId), isNull(attempts.deletedAt)));
}

/** The attempt as the API shows it, compared with the one printed before it. */
async function loadAttempt(db: Db, attempt: Attempt) {
  const siblings = (await liveAttempts(db, attempt.itemId)).filter((row) => row.id !== attempt.id);
  const all = toApiAttempts([...siblings, attempt]);
  const found = all.find((row) => row.id === attempt.id);
  if (!found) throw new Error("The attempt went missing.");
  return found;
}

/** An attempt that isn't deleted, of an item that isn't. */
function findLive(db: Db, attemptId: string) {
  return db
    .select({ attempt: attempts })
    .from(attempts)
    .innerJoin(items, eq(items.id, attempts.itemId))
    .where(and(eq(attempts.id, attemptId), isNull(attempts.deletedAt), isNull(items.deletedAt)))
    .get();
}

/** Never later than now: an attempt logged offline keeps its time, but not one from the future. */
const notFuture = (time: number, now: Date) => new Date(Math.min(time, now.getTime()));

/**
 * POST /api/items/:id/attempts: logs a print attempt. The client picks the
 * id, so a retry gets the same attempt back. Logging one on an idea makes it
 * a build.
 */
export const itemAttemptRoutes = new Hono<AppEnv>().post("/:id/attempts", async (c) => {
  const parsed = createAttempt.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid", "That attempt couldn't be read.");
  const body = parsed.data;
  const itemId = c.req.param("id");
  const db = c.var.db;

  const existing = await db.select().from(attempts).where(eq(attempts.id, body.id)).get();
  if (existing) {
    if (existing.itemId !== itemId) return apiError(c, 409, "conflict", "That attempt belongs to something else.");
    if (existing.deletedAt) return apiError(c, 409, "deleted", "That attempt was deleted.");
    return c.json<AttemptResponse>({ attempt: await loadAttempt(db, existing) }, 201);
  }

  const item = await db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
    .get();
  if (!item) return apiError(c, 404, "not_found", "That isn't here any more.");

  const now = new Date();
  const printed = notFuture(body.printedAt ?? now.getTime(), now);
  let attemptSettings = body.settings;
  if (!attemptSettings) {
    // "Same as last time": start from the attempt printed just before this one.
    const before = byPrintTime(
      (await liveAttempts(db, itemId))
        .filter((row) => row.printedAt <= printed)
        .map((row) => ({ row, id: row.id, printedAt: row.printedAt.getTime(), createdAt: row.createdAt.getTime() })),
    ).at(-1);
    attemptSettings = carryOver(before?.row.settings);
  }
  const outcomeValue = body.outcome ?? null;

  const [inserted] = await db
    .insert(attempts)
    .values({
      id: body.id,
      itemId,
      outcome: outcomeValue,
      printedAt: printed,
      finishedAt: outcomeValue ? now : null,
      finishedBy: outcomeValue ? c.var.user.id : null,
      note: body.note ?? "",
      failureTags: body.failureTags ?? [],
      successNotes: body.successNotes ?? [],
      settings: attemptSettings,
      createdBy: c.var.user.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    await db
      .update(items)
      .set({ ...(item.stage === "idea" ? stageDates(item, "building", now) : {}), updatedAt: now })
      .where(eq(items.id, itemId));
  }
  // A retry that raced the first request finds its attempt there.
  const attempt = inserted ?? (await db.select().from(attempts).where(eq(attempts.id, body.id)).get());
  if (!attempt || attempt.itemId !== itemId) {
    return apiError(c, 409, "conflict", "That attempt belongs to something else.");
  }
  return c.json<AttemptResponse>({ attempt: await loadAttempt(db, attempt) }, 201);
});

/** /api/attempts/:id: change, delete (soft) and restore an attempt. */
export const attemptRoutes = new Hono<AppEnv>()
  .patch("/:id", async (c) => {
    const parsed = updateAttempt.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That change couldn't be read.");
    const db = c.var.db;
    const found = await findLive(db, c.req.param("id"));
    if (!found) return apiError(c, 404, "not_found", notFound);
    const current = found.attempt;
    const { printedAt: printedTime, outcome: nextOutcome, ...changes } = parsed.data;
    const now = new Date();
    let finishedAt = current.finishedAt;
    let finishedBy = current.finishedBy;
    if (nextOutcome === null) {
      finishedAt = null;
      finishedBy = null;
    } else if (nextOutcome && !current.outcome) {
      finishedAt = now;
      finishedBy = c.var.user.id;
    } else if (nextOutcome) finishedAt ??= now;

    const [attempt] = await db
      .update(attempts)
      .set({
        ...changes,
        ...(nextOutcome !== undefined ? { outcome: nextOutcome } : {}),
        ...(printedTime !== undefined ? { printedAt: notFuture(printedTime, now) } : {}),
        finishedAt,
        finishedBy,
        updatedAt: now,
      })
      .where(eq(attempts.id, current.id))
      .returning();
    await db.update(items).set({ updatedAt: now }).where(eq(items.id, current.itemId));
    if (!attempt) return apiError(c, 404, "not_found", notFound);
    return c.json<AttemptResponse>({ attempt: await loadAttempt(db, attempt) });
  })

  /**
   * A print finished on a device without signal, sent when it is back. It only
   * fills what was empty: a print still printing is finished; one someone else
   * finished keeps their outcome and gets this note added. Repeating it changes nothing.
   */
  .post("/:id/finish", async (c) => {
    const parsed = finishAttempt.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That finish couldn't be read.");
    const body = parsed.data;
    const db = c.var.db;
    const found = await findLive(db, c.req.param("id"));
    if (!found) return apiError(c, 404, "not_found", notFound);
    const current = found.attempt;
    const now = new Date();
    const note = mergeNote(current.note, body.note ?? "");
    const finishing = current.outcome === null;
    // The same outcome again (a retry, or the same answer) counts as finished: nothing new to say.
    const finished = finishing || current.outcome === body.outcome;
    const tags =
      finished && body.outcome
        ? {
            failureTags:
              body.outcome === "success" ? current.failureTags : unionTags(current.failureTags, body.failureTags ?? []),
            successNotes:
              body.outcome === "failed"
                ? current.successNotes
                : unionTags(current.successNotes, body.successNotes ?? []),
          }
        : {};
    const [attempt] = await db
      .update(attempts)
      .set({
        note,
        ...tags,
        ...(finishing
          ? {
              outcome: body.outcome,
              finishedAt: new Date(
                Math.min(Math.max(body.finishedAt ?? now.getTime(), current.printedAt.getTime()), now.getTime()),
              ),
              finishedBy: c.var.user.id,
            }
          : {}),
        updatedAt: note !== current.note || finishing ? now : current.updatedAt,
      })
      .where(eq(attempts.id, current.id))
      .returning();
    if (!attempt) return apiError(c, 404, "not_found", notFound);
    if (finishing || note !== current.note) {
      await db.update(items).set({ updatedAt: now }).where(eq(items.id, current.itemId));
    }
    return c.json<FinishAttemptResponse>({ attempt: await loadAttempt(db, attempt), finished });
  })

  /** Hides the attempt and its photos at once; restore is the undo. */
  .delete("/:id", async (c) => {
    const now = new Date();
    const [result] = await c.var.db
      .update(attempts)
      .set({ deletedAt: now })
      .where(and(eq(attempts.id, c.req.param("id")), isNull(attempts.deletedAt)))
      .returning({ itemId: attempts.itemId });
    if (!result) return apiError(c, 404, "not_found", notFound);
    await c.var.db.update(items).set({ updatedAt: now }).where(eq(items.id, result.itemId));
    return c.body(null, 204);
  })

  .post("/:id/restore", async (c) => {
    const db = c.var.db;
    const attemptId = c.req.param("id");
    const [restored] = await db
      .update(attempts)
      .set({ deletedAt: null })
      .where(and(eq(attempts.id, attemptId), isNotNull(attempts.deletedAt)))
      .returning();
    const attempt = restored ?? (await db.select().from(attempts).where(eq(attempts.id, attemptId)).get());
    if (!attempt) return apiError(c, 404, "not_found", "That attempt is gone for good.");
    if (restored) await db.update(items).set({ updatedAt: new Date() }).where(eq(items.id, attempt.itemId));
    return c.json<AttemptResponse>({ attempt: await loadAttempt(db, attempt) });
  });
