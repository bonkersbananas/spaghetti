import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
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
  SETTING_KEYS,
  SUPPORT_TYPES,
  unionTags,
} from "../../shared/attempts.ts";
import { type AttemptPart, MAX_PART_QUANTITY, MAX_PARTS, zeroCounts } from "../../shared/parts.ts";
import { afterChange, itemOfAttempt, recordChange } from "../changes.ts";
import type { Db } from "../db/index.ts";
import { type Attempt, attemptFiles, attempts, items } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError, toApiAttempts } from "../http.ts";
import { readsByAttempt, toApiPhotoRead } from "../photo-read/run.ts";
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
  spoolId: z.uuid().optional(),
  grams: between(0, 100_000).optional(),
});

/** Every field optional; unknown keys are dropped. */
export const settings = z.object({
  filaments: z.array(filament).max(32).optional(),
  bedType: words.optional(),
  nozzle: z.enum(NOZZLES).optional(),
  nozzleDiameter: between(0.1, 2).optional(),
  layerHeight: between(0.01, 2).optional(),
  infillDensity: between(0, 100).optional(),
  wallLoops: z.number().int().min(0).max(100).optional(),
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
const slug = z
  .string()
  .max(48)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const slugs = z
  .array(slug)
  .max(40)
  .transform((list) => [...new Set(list)]);

/** What an attempt printed: a part and its good pieces, each part once. */
const attemptParts = z
  .array(z.object({ partId: id, count: z.number().int().min(0).max(MAX_PART_QUANTITY) }))
  .max(MAX_PARTS)
  .transform((list) => [...new Map(list.map((part) => [part.partId, part])).values()]) satisfies z.ZodType<
  AttemptPart[],
  unknown
>;

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
  parts: attemptParts.optional(),
});

const updateAttempt = z.object({
  outcome: outcome.optional(),
  printedAt: printedAt.optional(),
  endedAt: z.number().int().positive().nullable().optional(),
  suggestedFailureTag: slug.nullable().optional(),
  note: note.optional(),
  failureTags: slugs.optional(),
  successNotes: slugs.optional(),
  settings: settings.optional(),
  parts: attemptParts.optional(),
  /** Change some settings and leave the rest as the server has them (the sheet, which follows the other person's edits). */
  settingsMerge: z
    .object({ set: settings.optional(), unset: z.array(z.enum(SETTING_KEYS)).max(40).optional() })
    .optional(),
});

const finishAttempt = z.object({
  outcome: z.enum(OUTCOMES),
  finishedAt: z.number().int().positive().optional(),
  note: note.optional(),
  failureTags: slugs.optional(),
  successNotes: slugs.optional(),
  parts: attemptParts.optional(),
});

const notFound = "That attempt isn't here any more.";

const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((tag, index) => tag === b[index]);

/** An item's attempts that aren't deleted. */
function liveAttempts(db: Db, itemId: string) {
  return db
    .select()
    .from(attempts)
    .where(and(eq(attempts.itemId, itemId), isNull(attempts.deletedAt)));
}

/** The attempt as the API shows it, compared with the one printed before it, with its file. */
export async function loadAttempt(db: Db, attempt: Attempt) {
  const [siblingRows, file] = await Promise.all([
    liveAttempts(db, attempt.itemId),
    db
      .select()
      .from(attemptFiles)
      .where(and(eq(attemptFiles.attemptId, attempt.id), isNull(attemptFiles.deletedAt)))
      .get(),
  ]);
  const siblings = siblingRows.filter((row) => row.id !== attempt.id);
  const read = toApiPhotoRead((await readsByAttempt(db, [attempt.id])).get(attempt.id) ?? []);
  const all = toApiAttempts(
    [...siblings, attempt],
    new Map(file ? [[attempt.id, file]] : []),
    new Map(read ? [[attempt.id, read]] : []),
  );
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

  const [[inserted]] = await db.batch([
    db
      .insert(attempts)
      .values({
        id: body.id,
        itemId,
        outcome: outcomeValue,
        printedAt: printed,
        finishedAt: outcomeValue ? now : null,
        finishedBy: outcomeValue ? c.var.user.id : null,
        createdVia: c.var.via,
        finishedVia: outcomeValue ? c.var.via : null,
        note: body.note ?? "",
        failureTags: body.failureTags ?? [],
        successNotes: body.successNotes ?? [],
        settings: attemptSettings,
        // A spaghetti counts none unless counts are given.
        parts: body.parts ?? [],
        createdBy: c.var.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning(),
    recordChange(db, { entity: "attempt", id: body.id, itemId, action: "created", actor: c.var.actor }),
    // Logging an attempt on an idea makes it a build: only if this request's insert landed.
    db
      .update(items)
      .set({ ...(item.stage === "idea" ? stageDates(item, "building", now) : {}), updatedAt: now })
      .where(and(eq(items.id, itemId), afterChange)),
  ]);
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
    const {
      printedAt: printedTime,
      endedAt: endedTime,
      outcome: nextOutcome,
      settingsMerge,
      parts: nextParts,
      ...changes
    } = parsed.data;
    // Counts the person sent stand; a print that comes out as spaghetti counts none unless they say otherwise.
    const partsValue =
      nextParts ?? (nextOutcome === "failed" && current.outcome !== "failed" ? zeroCounts(current.parts) : undefined);
    // A merge applies to the settings as they are now (or to the whole replacement sent with it).
    const mergedSettings = settingsMerge
      ? Object.fromEntries(
          Object.entries({ ...(changes.settings ?? current.settings), ...settingsMerge.set }).filter(
            ([key]) => !(settingsMerge.unset as string[] | undefined)?.includes(key),
          ),
        )
      : undefined;
    const now = new Date();
    let finishedAt = current.finishedAt;
    let finishedBy = current.finishedBy;
    let finishedVia = current.finishedVia;
    if (nextOutcome === null) {
      finishedAt = null;
      finishedBy = null;
      finishedVia = null;
    } else if (nextOutcome && !current.outcome) {
      finishedAt = now;
      finishedBy = c.var.user.id;
      finishedVia = c.var.via;
    } else if (nextOutcome) finishedAt ??= now;

    const [[attempt]] = await db.batch([
      db
        .update(attempts)
        .set({
          ...changes,
          ...(mergedSettings ? { settings: mergedSettings } : {}),
          ...(partsValue ? { parts: partsValue } : {}),
          ...(nextOutcome !== undefined ? { outcome: nextOutcome } : {}),
          ...(printedTime !== undefined ? { printedAt: notFuture(printedTime, now) } : {}),
          ...(endedTime !== undefined ? { endedAt: endedTime === null ? null : notFuture(endedTime, now) } : {}),
          finishedAt,
          finishedBy,
          finishedVia,
          updatedAt: now,
        })
        .where(and(eq(attempts.id, current.id), isNull(attempts.deletedAt)))
        .returning(),
      recordChange(db, {
        entity: "attempt",
        id: current.id,
        itemId: current.itemId,
        action: "updated",
        actor: c.var.actor,
      }),
      db
        .update(items)
        .set({ updatedAt: now })
        .where(and(eq(items.id, current.itemId), afterChange)),
    ]);
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
    const now = new Date();
    let current = found.attempt;
    // The write only goes through if the attempt is still as it was read (its outcome, note and tags): if another
    // device's finish or edit landed in between, read again and decide again, so no one's outcome is replaced.
    for (let tries = 0; tries < 4; tries++) {
      const note = mergeNote(current.note, body.note ?? "");
      const finishing = current.outcome === null;
      // The same outcome again (a retry, or the same answer) counts as finished: nothing new to say.
      const finished = finishing || current.outcome === body.outcome;
      const tags =
        finished && body.outcome
          ? {
              failureTags:
                body.outcome === "success"
                  ? current.failureTags
                  : unionTags(current.failureTags, body.failureTags ?? []),
              successNotes:
                body.outcome === "failed"
                  ? current.successNotes
                  : unionTags(current.successNotes, body.successNotes ?? []),
            }
          : {};
      // Only a write that changed something is a change (a repeated finish says nothing new).
      const modified =
        finishing ||
        note !== current.note ||
        (tags.failureTags !== undefined && !sameTags(tags.failureTags, current.failureTags)) ||
        (tags.successNotes !== undefined && !sameTags(tags.successNotes, current.successNotes));
      const write = db
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
                finishedVia: c.var.via,
                parts: body.parts ?? (body.outcome === "failed" ? zeroCounts(current.parts) : current.parts),
              }
            : {}),
          updatedAt: note !== current.note || finishing ? now : current.updatedAt,
        })
        .where(
          and(
            eq(attempts.id, current.id),
            isNull(attempts.deletedAt),
            eq(attempts.note, current.note),
            eq(attempts.failureTags, current.failureTags),
            eq(attempts.successNotes, current.successNotes),
            current.outcome === null ? isNull(attempts.outcome) : eq(attempts.outcome, current.outcome),
          ),
        )
        .returning();
      const statements: BatchItem<"sqlite">[] = [write];
      if (modified) {
        statements.push(
          recordChange(db, {
            entity: "attempt",
            id: current.id,
            itemId: current.itemId,
            action: "updated",
            actor: c.var.actor,
          }),
          db
            .update(items)
            .set({ updatedAt: now })
            .where(and(eq(items.id, current.itemId), afterChange)),
        );
      }
      const [attempt] = (await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]))[0] as Attempt[];
      if (attempt) {
        return c.json<FinishAttemptResponse>({ attempt: await loadAttempt(db, attempt), finished });
      }
      const again = await findLive(db, current.id);
      if (!again) return apiError(c, 404, "not_found", notFound);
      current = again.attempt;
    }
    return apiError(c, 409, "conflict", "That attempt keeps changing. Try again in a moment.");
  })

  /** Hides the attempt and its photos at once; restore is the undo. */
  .delete("/:id", async (c) => {
    const now = new Date();
    const attemptId = c.req.param("id");
    const db = c.var.db;
    const [[result]] = await db.batch([
      db
        .update(attempts)
        .set({ deletedAt: now })
        .where(and(eq(attempts.id, attemptId), isNull(attempts.deletedAt)))
        .returning({ itemId: attempts.itemId }),
      recordChange(db, {
        entity: "attempt",
        id: attemptId,
        itemId: itemOfAttempt(attemptId),
        action: "deleted",
        actor: c.var.actor,
      }),
      db
        .update(items)
        .set({ updatedAt: now })
        .where(and(sql`${items.id} = ${itemOfAttempt(attemptId)}`, afterChange)),
    ]);
    if (!result) return apiError(c, 404, "not_found", notFound);
    return c.body(null, 204);
  })

  .post("/:id/restore", async (c) => {
    const db = c.var.db;
    const attemptId = c.req.param("id");
    const [[restored]] = await db.batch([
      db
        .update(attempts)
        .set({ deletedAt: null })
        .where(and(eq(attempts.id, attemptId), isNotNull(attempts.deletedAt)))
        .returning(),
      recordChange(db, {
        entity: "attempt",
        id: attemptId,
        itemId: itemOfAttempt(attemptId),
        action: "restored",
        actor: c.var.actor,
      }),
      db
        .update(items)
        .set({ updatedAt: new Date() })
        .where(and(sql`${items.id} = ${itemOfAttempt(attemptId)}`, afterChange)),
    ]);
    const attempt = restored ?? (await db.select().from(attempts).where(eq(attempts.id, attemptId)).get());
    if (!attempt) return apiError(c, 404, "not_found", "That attempt is gone for good.");
    return c.json<AttemptResponse>({ attempt: await loadAttempt(db, attempt) });
  });
