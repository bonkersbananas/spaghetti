import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import { z } from "zod";
import {
  type AttemptResponse,
  type ItemFileResponse,
  MAX_FILE_THUMB_BYTES,
  MAX_SLICER_FILE_BYTES,
} from "../../shared/api.ts";
import { afterChange, fileOfAttempt, itemOfAttempt, recordChange } from "../changes.ts";
import { attemptFiles, attempts, itemFiles, items } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError, toApiFile } from "../http.ts";
import { fileKey } from "../photos.ts";
import { loadAttempt, settings } from "./attempts.ts";

const THUMB_TYPES = ["image/png", "image/jpeg", "image/webp"];

const fileFields = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  size: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  plate: z.coerce.number().int().min(1).max(1_000),
  plateCount: z.coerce.number().int().min(1).max(1_000),
  slicer: z.string().trim().max(80).optional(),
  prefill: z
    .string()
    .max(64_000)
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Not JSON." });
        return z.NEVER;
      }
    })
    .pipe(settings),
  /** The object names on the plate (JSON array), for a build's parts; left out when the file said none. */
  objects: z
    .string()
    .max(64_000)
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return [];
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Not JSON." });
        return z.NEVER;
      }
    })
    .pipe(z.array(z.string().trim().min(1).max(200)).max(500)),
});

/** An attempt that isn't deleted, of an item that isn't. */
function liveAttempt(c: { var: AppEnv["Variables"] }, attemptId: string) {
  return c.var.db
    .select({ attempt: attempts })
    .from(attempts)
    .innerJoin(items, eq(items.id, attempts.itemId))
    .where(and(eq(attempts.id, attemptId), isNull(attempts.deletedAt), isNull(items.deletedAt)))
    .get();
}

/**
 * /api/attempts/:id/file: the slicer file an attempt was printed from. The
 * browser reads the file and sends what it found with the bytes; the Worker
 * only stores and serves them.
 */
export const attemptFileRoutes = new Hono<AppEnv>()
  /**
   * Multipart: id, name, size, plate, plateCount, slicer, prefill (JSON), and
   * optionally `thumb` (the plate's picture) and `file` (the bytes, left out
   * when over MAX_SLICER_FILE_BYTES). Replaces the attempt's file; a retry
   * with the same id is harmless.
   */
  .put("/:id/file", async (c) => {
    const attemptId = c.req.param("id");
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > MAX_SLICER_FILE_BYTES + MAX_FILE_THUMB_BYTES + 256 * 1024) {
      return apiError(c, 413, "too_large", "That file is too large to keep.");
    }
    const found = await liveAttempt(c, attemptId);
    // 404 tells the outbox to drop the file: its attempt was deleted or never existed.
    if (!found) return apiError(c, 404, "not_found", "That attempt isn't here any more.");
    const form = await c.req.formData().catch(() => null);
    const parsed = fileFields.safeParse(
      form ? Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string")) : null,
    );
    if (!parsed.success) return apiError(c, 400, "invalid", "That file's details couldn't be read.");
    const fields = parsed.data;
    const file = form?.get("file");
    const thumb = form?.get("thumb");
    if (file instanceof File && file.size > MAX_SLICER_FILE_BYTES) {
      return apiError(c, 413, "too_large", "That file is too large to keep.");
    }
    if (thumb instanceof File && (thumb.size > MAX_FILE_THUMB_BYTES || !THUMB_TYPES.includes(thumb.type))) {
      return apiError(c, 415, "unsupported", "The plate's picture couldn't be kept.");
    }
    const db = c.var.db;
    const existing = await db.select().from(attemptFiles).where(eq(attemptFiles.id, fields.id)).get();
    if (existing && existing.attemptId !== attemptId) {
      return apiError(c, 409, "conflict", "That file belongs to another attempt.");
    }

    const stored = file instanceof File;
    const hasThumb = thumb instanceof File;
    await Promise.all([
      stored
        ? c.env.PHOTOS.put(fileKey(fields.id, "file"), file.stream(), {
            httpMetadata: {
              contentType: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
              contentDisposition: disposition(fields.name),
            },
          })
        : null,
      hasThumb
        ? c.env.PHOTOS.put(fileKey(fields.id, "thumb"), thumb.stream(), { httpMetadata: { contentType: thumb.type } })
        : null,
    ]);

    // The file it replaces, with its bytes.
    const others = (await db.select().from(attemptFiles).where(eq(attemptFiles.attemptId, attemptId))).filter(
      (row) => row.id !== fields.id,
    );
    if (others.length) {
      await c.env.PHOTOS.delete(others.flatMap((row) => [fileKey(row.id, "file"), fileKey(row.id, "thumb")]));
    }

    const values = {
      name: fields.name,
      size: fields.size,
      stored,
      hasThumb,
      plate: fields.plate,
      plateCount: fields.plateCount,
      slicer: fields.slicer || null,
      prefill: fields.prefill,
      objects: fields.objects,
      deletedAt: null,
    };
    const itemId = found.attempt.itemId;
    const statements: BatchItem<"sqlite">[] = [
      // The files it replaces, then the new one, its change and the item's date: together.
      ...others.map((row) => db.delete(attemptFiles).where(eq(attemptFiles.id, row.id))),
      db
        .insert(attemptFiles)
        .values({ id: fields.id, attemptId, ...values, createdBy: c.var.user.id, createdAt: new Date() })
        .onConflictDoUpdate({ target: attemptFiles.id, set: values }),
      recordChange(db, {
        entity: "file",
        id: fields.id,
        itemId,
        action: existing ? "updated" : "created",
        actor: c.var.actor,
      }),
      db
        .update(items)
        .set({ updatedAt: new Date() })
        .where(and(eq(items.id, itemId), afterChange)),
    ];
    await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    return c.json<AttemptResponse>({ attempt: await loadAttempt(db, found.attempt) }, existing ? 200 : 201);
  })

  /** Takes the file off the attempt at once; restore is the undo. */
  .delete("/:id/file", async (c) => {
    const attemptId = c.req.param("id");
    const db = c.var.db;
    const [[row]] = await db.batch([
      db
        .update(attemptFiles)
        .set({ deletedAt: new Date() })
        .where(and(eq(attemptFiles.attemptId, attemptId), isNull(attemptFiles.deletedAt)))
        .returning({ id: attemptFiles.id }),
      recordChange(db, {
        entity: "file",
        id: fileOfAttempt(attemptId),
        itemId: itemOfAttempt(attemptId),
        action: "deleted",
        actor: c.var.actor,
      }),
    ]);
    if (!row) return apiError(c, 404, "not_found", "That attempt has no file.");
    return c.body(null, 204);
  })

  .post("/:id/file/restore", async (c) => {
    const attemptId = c.req.param("id");
    const found = await liveAttempt(c, attemptId);
    if (!found) return apiError(c, 404, "not_found", "That attempt isn't here any more.");
    const [[row]] = await c.var.db.batch([
      c.var.db
        .update(attemptFiles)
        .set({ deletedAt: null })
        .where(and(eq(attemptFiles.attemptId, attemptId), isNotNull(attemptFiles.deletedAt)))
        .returning({ id: attemptFiles.id }),
      recordChange(c.var.db, {
        entity: "file",
        id: fileOfAttempt(attemptId),
        itemId: found.attempt.itemId,
        action: "restored",
        actor: c.var.actor,
      }),
    ]);
    if (!row) return apiError(c, 404, "not_found", "That file is gone for good.");
    return c.json<AttemptResponse>({ attempt: await loadAttempt(c.var.db, found.attempt) });
  });

/** An item (idea or build) that isn't deleted. */
const liveItem = (c: { var: AppEnv["Variables"] }, itemId: string) =>
  c.var.db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
    .get();

/** How many files an item keeps now (not removed). */
const liveFileCount = async (c: { var: AppEnv["Variables"] }, itemId: string) =>
  (
    await c.var.db
      .select({ id: itemFiles.id })
      .from(itemFiles)
      .where(and(eq(itemFiles.itemId, itemId), isNull(itemFiles.deletedAt)))
  ).length;

/** The most files an idea or build keeps. */
export const MAX_ITEM_FILES = 20;

/**
 * /api/items/:id/files/:fileId: slicer files kept with an idea (and on its build). The same multipart body as an
 * attempt's file; several may be live at once, and a retry with the same id is harmless.
 */
export const itemFileRoutes = new Hono<AppEnv>()
  .put("/:id/files/:fileId", async (c) => {
    const itemId = c.req.param("id");
    const fileId = c.req.param("fileId");
    if (!z.uuid().safeParse(fileId).success) return apiError(c, 400, "invalid", "That file's id isn't valid.");
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > MAX_SLICER_FILE_BYTES + MAX_FILE_THUMB_BYTES + 256 * 1024) {
      return apiError(c, 413, "too_large", "That file is too large to keep.");
    }
    if (!(await liveItem(c, itemId))) return apiError(c, 404, "not_found", "That idea isn't here any more.");
    const form = await c.req.formData().catch(() => null);
    const parsed = fileFields.safeParse(
      form
        ? { ...Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string")), id: fileId }
        : null,
    );
    if (!parsed.success) return apiError(c, 400, "invalid", "That file's details couldn't be read.");
    const fields = parsed.data;
    const file = form?.get("file");
    const thumb = form?.get("thumb");
    if (file instanceof File && file.size > MAX_SLICER_FILE_BYTES) {
      return apiError(c, 413, "too_large", "That file is too large to keep.");
    }
    if (thumb instanceof File && (thumb.size > MAX_FILE_THUMB_BYTES || !THUMB_TYPES.includes(thumb.type))) {
      return apiError(c, 415, "unsupported", "The plate's picture couldn't be kept.");
    }
    const db = c.var.db;
    const existing = await db.select().from(itemFiles).where(eq(itemFiles.id, fileId)).get();
    if (existing && existing.itemId !== itemId) {
      return apiError(c, 409, "conflict", "That file belongs to another idea.");
    }
    // A new file, or a removed one coming back by its id, takes a place: the limit counts the live ones.
    if ((!existing || existing.deletedAt) && (await liveFileCount(c, itemId)) >= MAX_ITEM_FILES) {
      return apiError(c, 409, "too_many", `An idea keeps at most ${MAX_ITEM_FILES} files.`);
    }
    const stored = file instanceof File;
    const hasThumb = thumb instanceof File;
    await Promise.all([
      stored
        ? c.env.PHOTOS.put(fileKey(fileId, "file"), file.stream(), {
            httpMetadata: {
              contentType: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
              contentDisposition: disposition(fields.name),
            },
          })
        : null,
      hasThumb
        ? c.env.PHOTOS.put(fileKey(fileId, "thumb"), thumb.stream(), { httpMetadata: { contentType: thumb.type } })
        : null,
    ]);
    const values = {
      name: fields.name,
      size: fields.size,
      stored,
      hasThumb,
      plate: fields.plate,
      plateCount: fields.plateCount,
      slicer: fields.slicer || null,
      prefill: fields.prefill,
      objects: fields.objects,
      deletedAt: null,
    };
    await db.batch([
      db
        .insert(itemFiles)
        .values({ id: fileId, itemId, ...values, createdBy: c.var.user.id, createdAt: new Date() })
        .onConflictDoUpdate({ target: itemFiles.id, set: values }),
      recordChange(db, {
        entity: "file",
        id: fileId,
        itemId,
        action: existing ? "updated" : "created",
        actor: c.var.actor,
      }),
      db
        .update(items)
        .set({ updatedAt: new Date() })
        .where(and(eq(items.id, itemId), afterChange)),
    ]);
    const row = await db.select().from(itemFiles).where(eq(itemFiles.id, fileId)).get();
    return c.json<ItemFileResponse>({ file: toApiFile(row as NonNullable<typeof row>) }, existing ? 200 : 201);
  })

  /** Takes the file off at once; restore is the undo. */
  .delete("/:id/files/:fileId", async (c) => {
    const itemId = c.req.param("id");
    const fileId = c.req.param("fileId");
    const db = c.var.db;
    const [[row]] = await db.batch([
      db
        .update(itemFiles)
        .set({ deletedAt: new Date() })
        .where(and(eq(itemFiles.id, fileId), eq(itemFiles.itemId, itemId), isNull(itemFiles.deletedAt)))
        .returning({ id: itemFiles.id }),
      recordChange(db, { entity: "file", id: fileId, itemId, action: "deleted", actor: c.var.actor }),
    ]);
    if (!row) return apiError(c, 404, "not_found", "That file isn't here.");
    return c.body(null, 204);
  })

  .post("/:id/files/:fileId/restore", async (c) => {
    const itemId = c.req.param("id");
    const fileId = c.req.param("fileId");
    if (!(await liveItem(c, itemId))) return apiError(c, 404, "not_found", "That idea isn't here any more.");
    if ((await liveFileCount(c, itemId)) >= MAX_ITEM_FILES) {
      return apiError(c, 409, "too_many", `An idea keeps at most ${MAX_ITEM_FILES} files.`);
    }
    const db = c.var.db;
    const [[row]] = await db.batch([
      db
        .update(itemFiles)
        .set({ deletedAt: null })
        .where(and(eq(itemFiles.id, fileId), eq(itemFiles.itemId, itemId), isNotNull(itemFiles.deletedAt)))
        .returning(),
      recordChange(db, { entity: "file", id: fileId, itemId, action: "restored", actor: c.var.actor }),
    ]);
    if (!row) return apiError(c, 404, "not_found", "That file is gone for good.");
    return c.json<ItemFileResponse>({ file: toApiFile(row) });
  });

/** "bracket v2.gcode.3mf" as a download name, safe in a header. */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** A file's bytes never change (a new file gets a new id). */
const IMMUTABLE = "private, max-age=31536000, immutable";

/** The file as the bytes route needs it: kept on a live attempt of a live item, or on a live item. */
async function servableFile(c: { var: AppEnv["Variables"] }, id: string) {
  const db = c.var.db;
  const [onAttempt, onItem] = await Promise.all([
    db
      .select({ file: attemptFiles })
      .from(attemptFiles)
      .innerJoin(attempts, eq(attempts.id, attemptFiles.attemptId))
      .innerJoin(items, eq(items.id, attempts.itemId))
      .where(
        and(
          eq(attemptFiles.id, id),
          isNull(attemptFiles.deletedAt),
          isNull(attempts.deletedAt),
          isNull(items.deletedAt),
        ),
      )
      .get(),
    db
      .select({ file: itemFiles })
      .from(itemFiles)
      .innerJoin(items, eq(items.id, itemFiles.itemId))
      .where(and(eq(itemFiles.id, id), isNull(itemFiles.deletedAt), isNull(items.deletedAt)))
      .get(),
  ]);
  return onAttempt?.file ?? onItem?.file;
}

/** /api/files/:id: the bytes and the plate's picture, for signed-in people, while the attempt or item is there. */
export const fileRoutes = new Hono<AppEnv>().get("/:id/:part?", async (c) => {
  const part = c.req.param("part") ?? "file";
  if (part !== "file" && part !== "thumb") return apiError(c, 404, "not_found", "No such part.");
  const file = await servableFile(c, c.req.param("id"));
  const kept = part === "file" ? file?.stored : file?.hasThumb;
  if (!file || !kept) return apiError(c, 404, "not_found", "That file isn't here.");
  const object = await c.env.PHOTOS.get(fileKey(file.id, part), { onlyIf: c.req.raw.headers });
  if (!object) return apiError(c, 404, "not_found", "That file isn't here.");
  c.header("Cache-Control", IMMUTABLE);
  c.header("ETag", object.httpEtag);
  if (!("body" in object)) return c.body(null, 304);
  c.header("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
  if (part === "file") c.header("Content-Disposition", disposition(file.name));
  c.header("Content-Length", String(object.size));
  return c.body(object.body);
});

/** For the OpenAPI document (worker/openapi). */
export { fileFields };
