import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  MAX_PHOTO_BYTES,
  PHOTO_CONTENT_TYPES,
  type UpkeepLog,
  type UpkeepResponse,
  type UpkeepTask,
} from "../../shared/api.ts";
import { type HoursAttempt, printHours, sinceDone, upkeepStatus } from "../../shared/upkeep.ts";
import { DEFAULT_UPKEEP } from "../../shared/upkeep-defaults.ts";
import { recordChange } from "../changes.ts";
import type { Db } from "../db/index.ts";
import { attempts, items, upkeepLogs, upkeepTasks } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { photoKey } from "../photos.ts";

const HISTORY = 5;
const id = z.uuid();
const hours = z.number().int().min(1).max(100_000).nullable();
const days = z.number().int().min(1).max(3650).nullable();
const name = z.string().trim().min(1).max(80);
const note = z.string().max(2000);

const createTask = z
  .object({
    id: z.string().min(1).max(40),
    name,
    note: note.optional(),
    intervalHours: hours.optional(),
    intervalDays: days.optional(),
  })
  .refine((task) => task.intervalHours || task.intervalDays, "A task needs an interval in print hours or days.");
const updateTask = z.object({
  name: name.optional(),
  note: note.optional(),
  intervalHours: hours.optional(),
  intervalDays: days.optional(),
});
const logBody = z.object({ id, note: note.optional(), at: z.number().int().positive().optional() });
const photoFields = z.object({
  width: z.coerce.number().int().min(1).max(10_000),
  height: z.coerce.number().int().min(1).max(10_000),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .transform((value) => value.toLowerCase()),
});

const notFound = "That task isn't on the list any more.";

/** Every attempt that counts toward the printer's hours. */
export async function loadHoursAttempts(db: Db): Promise<HoursAttempt[]> {
  const rows = await db
    .select({
      printedAt: attempts.printedAt,
      endedAt: attempts.endedAt,
      outcome: attempts.outcome,
      settings: attempts.settings,
    })
    .from(attempts)
    .innerJoin(items, eq(items.id, attempts.itemId))
    .where(and(isNull(attempts.deletedAt), isNull(items.deletedAt)));
  return rows.map((row) => ({
    printedAt: row.printedAt.getTime(),
    endedAt: row.endedAt?.getTime() ?? null,
    outcome: row.outcome,
    settings: row.settings,
  }));
}

/** The first read puts the starting list in (once: the ids are fixed, and removed tasks stay as soft-deleted rows). */
async function seedIfEmpty(db: Db, now: number) {
  const any = await db.select({ id: upkeepTasks.id }).from(upkeepTasks).limit(1).get();
  if (any) return;
  await db
    .insert(upkeepTasks)
    .values(
      DEFAULT_UPKEEP.map((task, position) => ({
        id: task.id,
        name: task.name,
        note: task.note,
        intervalHours: task.intervalHours,
        intervalDays: task.intervalDays,
        position,
        createdAt: new Date(now),
      })),
    )
    .onConflictDoNothing();
}

const toLog = (row: typeof upkeepLogs.$inferSelect): UpkeepLog => ({
  id: row.id,
  taskId: row.taskId,
  doneBy: row.doneBy,
  via: row.doneVia,
  doneAt: row.doneAt.getTime(),
  printerHours: row.printerHours,
  note: row.note,
  photo:
    row.photoId && row.photoWidth && row.photoHeight
      ? { id: row.photoId, width: row.photoWidth, height: row.photoHeight, color: row.photoColor ?? "" }
      : null,
});

/** The tasks as the API shows them, most due first, with how long since each was done. */
export async function loadUpkeep(db: Db, now = Date.now()): Promise<UpkeepResponse> {
  await seedIfEmpty(db, now);
  const [tasks, logs, hoursAttempts] = await Promise.all([
    db.select().from(upkeepTasks).where(isNull(upkeepTasks.deletedAt)).orderBy(upkeepTasks.position),
    db.select().from(upkeepLogs).where(isNull(upkeepLogs.deletedAt)).orderBy(desc(upkeepLogs.doneAt)),
    loadHoursAttempts(db),
  ]);
  const byTask = new Map<string, UpkeepLog[]>();
  for (const row of logs) byTask.set(row.taskId, [...(byTask.get(row.taskId) ?? []), toLog(row)]);
  const result: UpkeepTask[] = tasks.map((task) => {
    const history = byTask.get(task.id) ?? [];
    const lastDone = history[0] ?? null;
    const since = sinceDone(
      {
        intervalHours: task.intervalHours,
        intervalDays: task.intervalDays,
        lastHours: lastDone?.printerHours ?? null,
        lastAt: lastDone?.doneAt ?? null,
        createdAt: task.createdAt.getTime(),
      },
      hoursAttempts,
      now,
    );
    const status = upkeepStatus(task, since.sinceHours, since.sinceDays);
    return {
      id: task.id,
      name: task.name,
      note: task.note,
      intervalHours: task.intervalHours,
      intervalDays: task.intervalDays,
      createdAt: task.createdAt.getTime(),
      ...since,
      ...status,
      lastDone,
      history: history.slice(0, HISTORY),
    };
  });
  result.sort((a, b) => b.fraction - a.fraction);
  return { printHours: printHours(hoursAttempts, now), tasks: result };
}

/** Task rows a person asked for, after they changed: one interval at least must be left. */
const hasInterval = (task: { intervalHours: number | null; intervalDays: number | null }) =>
  Boolean(task.intervalHours || task.intervalDays);

/** /api/printer/upkeep: what the printer needs now and then, and the log of doing it. */
export const upkeepRoutes = new Hono<AppEnv>()
  // Whatever is asked first, the starting list is there.
  .use(async (c, next) => {
    await seedIfEmpty(c.var.db, Date.now());
    await next();
  })
  .get("/", async (c) => c.json<UpkeepResponse>(await loadUpkeep(c.var.db)))

  .post("/", async (c) => {
    const parsed = createTask.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return apiError(c, 400, "invalid", "A task needs a name and an interval in print hours or days.");
    const db = c.var.db;
    const last = await db
      .select({ position: upkeepTasks.position })
      .from(upkeepTasks)
      .orderBy(desc(upkeepTasks.position))
      .limit(1)
      .get();
    await db.batch([
      db
        .insert(upkeepTasks)
        .values({
          id: parsed.data.id,
          name: parsed.data.name,
          note: parsed.data.note ?? "",
          intervalHours: parsed.data.intervalHours ?? null,
          intervalDays: parsed.data.intervalDays ?? null,
          position: (last?.position ?? -1) + 1,
          createdAt: new Date(),
        })
        .onConflictDoNothing(),
      recordChange(db, { entity: "printer", id: "upkeep", action: "updated", actor: c.var.actor }),
    ]);
    return c.json<UpkeepResponse>(await loadUpkeep(db));
  })

  .patch("/:id", async (c) => {
    const taskId = c.req.param("id");
    const parsed = updateTask.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That change couldn't be read.");
    const db = c.var.db;
    const current = await db
      .select()
      .from(upkeepTasks)
      .where(and(eq(upkeepTasks.id, taskId), isNull(upkeepTasks.deletedAt)))
      .get();
    if (!current) return apiError(c, 404, "not_found", notFound);
    if (!Object.keys(parsed.data).length) return apiError(c, 400, "invalid", "Nothing to change.");
    const next = { ...current, ...parsed.data };
    if (!hasInterval(next)) return apiError(c, 400, "invalid", "A task needs an interval in print hours or days.");
    await db.batch([
      db.update(upkeepTasks).set(parsed.data).where(eq(upkeepTasks.id, taskId)),
      recordChange(db, { entity: "printer", id: "upkeep", action: "updated", actor: c.var.actor }),
    ]);
    return c.json<UpkeepResponse>(await loadUpkeep(db));
  })

  /** Takes it off the list; restore is the undo. */
  .delete("/:id", async (c) => {
    const taskId = c.req.param("id");
    const [[row]] = await c.var.db.batch([
      c.var.db
        .update(upkeepTasks)
        .set({ deletedAt: new Date() })
        .where(and(eq(upkeepTasks.id, taskId), isNull(upkeepTasks.deletedAt)))
        .returning({ id: upkeepTasks.id }),
      recordChange(c.var.db, { entity: "printer", id: "upkeep", action: "deleted", actor: c.var.actor }),
    ]);
    if (!row) return apiError(c, 404, "not_found", notFound);
    return c.body(null, 204);
  })

  .post("/:id/restore", async (c) => {
    const taskId = c.req.param("id");
    await c.var.db.batch([
      c.var.db
        .update(upkeepTasks)
        .set({ deletedAt: null })
        .where(and(eq(upkeepTasks.id, taskId), isNotNull(upkeepTasks.deletedAt))),
      recordChange(c.var.db, { entity: "printer", id: "upkeep", action: "restored", actor: c.var.actor }),
    ]);
    return c.json<UpkeepResponse>(await loadUpkeep(c.var.db));
  })

  /** "Done": who, when, the printer's hours at that moment. Resets the task. A retry with the same id records nothing twice. */
  .post("/:id/done", async (c) => {
    const taskId = c.req.param("id");
    const parsed = logBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That couldn't be read.");
    const db = c.var.db;
    const task = await db
      .select({ id: upkeepTasks.id })
      .from(upkeepTasks)
      .where(and(eq(upkeepTasks.id, taskId), isNull(upkeepTasks.deletedAt)))
      .get();
    if (!task) return apiError(c, 404, "not_found", notFound);
    const now = Date.now();
    const at = Math.min(parsed.data.at ?? now, now);
    const printerHours = printHours(await loadHoursAttempts(db), now, at);
    await db.batch([
      db
        .insert(upkeepLogs)
        .values({
          id: parsed.data.id,
          taskId,
          doneBy: c.var.user.id,
          doneVia: c.var.via,
          doneAt: new Date(at),
          printerHours,
          note: parsed.data.note?.trim() ?? "",
        })
        .onConflictDoNothing(),
      recordChange(db, { entity: "printer", id: "upkeep", action: "updated", actor: c.var.actor }),
      // Done resets the nudge too: the next time it is due, it may nudge again.
      db.update(upkeepTasks).set({ nudgedAt: null }).where(eq(upkeepTasks.id, taskId)),
    ]);
    return c.json<UpkeepResponse>(await loadUpkeep(db));
  })

  /** A photo of what was done, resized in the browser like any photo. */
  .put("/logs/:logId/photo/:photoId", async (c) => {
    const logId = c.req.param("logId");
    const photoId = c.req.param("photoId");
    if (!id.safeParse(photoId).success) return apiError(c, 400, "invalid", "That photo id isn't valid.");
    if (Number(c.req.header("content-length") ?? 0) > 2 * MAX_PHOTO_BYTES) {
      return apiError(c, 413, "too_large", "That photo is too large.");
    }
    const db = c.var.db;
    const current = await db
      .select()
      .from(upkeepLogs)
      .where(and(eq(upkeepLogs.id, logId), isNull(upkeepLogs.deletedAt)))
      .get();
    if (!current) return apiError(c, 404, "not_found", "That entry isn't in the log any more.");
    const form = await c.req.formData().catch(() => null);
    const parsed = photoFields.safeParse(form ? Object.fromEntries(form) : null);
    const large = form?.get("large");
    const thumb = form?.get("thumb");
    if (!parsed.success || !(large instanceof File) || !(thumb instanceof File)) {
      return apiError(c, 400, "invalid", "That photo couldn't be read.");
    }
    if (!(PHOTO_CONTENT_TYPES as readonly string[]).includes(large.type) || thumb.type !== large.type) {
      return apiError(c, 415, "unsupported", "Photos are uploaded as WebP or JPEG.");
    }
    if (large.size > MAX_PHOTO_BYTES || thumb.size > MAX_PHOTO_BYTES) {
      return apiError(c, 413, "too_large", "That photo is too large.");
    }
    const httpMetadata = { contentType: large.type };
    await Promise.all([
      c.env.PHOTOS.put(photoKey(photoId, "large"), large.stream(), { httpMetadata }),
      c.env.PHOTOS.put(photoKey(photoId, "thumb"), thumb.stream(), { httpMetadata }),
    ]);
    await db.batch([
      db
        .update(upkeepLogs)
        .set({
          photoId,
          photoWidth: parsed.data.width,
          photoHeight: parsed.data.height,
          photoColor: parsed.data.color,
        })
        .where(eq(upkeepLogs.id, logId)),
      recordChange(db, { entity: "printer", id: "upkeep", action: "updated", actor: c.var.actor }),
    ]);
    if (current.photoId && current.photoId !== photoId) {
      await c.env.PHOTOS.delete([photoKey(current.photoId, "large"), photoKey(current.photoId, "thumb")]);
    }
    return c.json<UpkeepResponse>(await loadUpkeep(db));
  })

  /** Takes a "Done" back (the undo of marking it by mistake). People only. */
  .delete("/logs/:logId", async (c) => {
    const logId = c.req.param("logId");
    const [[row]] = await c.var.db.batch([
      c.var.db
        .update(upkeepLogs)
        .set({ deletedAt: new Date() })
        .where(and(eq(upkeepLogs.id, logId), isNull(upkeepLogs.deletedAt)))
        .returning({ id: upkeepLogs.id }),
      recordChange(c.var.db, { entity: "printer", id: "upkeep", action: "updated", actor: c.var.actor }),
    ]);
    if (!row) return apiError(c, 404, "not_found", "That entry isn't in the log any more.");
    return c.body(null, 204);
  });

/** For the OpenAPI document (worker/openapi). */
export { createTask, logBody, photoFields as upkeepPhotoFields, updateTask };
