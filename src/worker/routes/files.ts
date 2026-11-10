import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import { z } from "zod";
import { type AttemptResponse, MAX_FILE_THUMB_BYTES, MAX_SLICER_FILE_BYTES } from "../../shared/api.ts";
import { afterChange, fileOfAttempt, itemOfAttempt, recordChange } from "../changes.ts";
import { attemptFiles, attempts, items } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
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

/** "bracket v2.gcode.3mf" as a download name, safe in a header. */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** A file's bytes never change (a new file gets a new id). */
const IMMUTABLE = "private, max-age=31536000, immutable";

/** /api/files/:id: the bytes and the plate's picture, for signed-in people, while the attempt is there. */
export const fileRoutes = new Hono<AppEnv>().get("/:id/:part?", async (c) => {
  const part = c.req.param("part") ?? "file";
  if (part !== "file" && part !== "thumb") return apiError(c, 404, "not_found", "No such part.");
  const row = await c.var.db
    .select({ file: attemptFiles })
    .from(attemptFiles)
    .innerJoin(attempts, eq(attempts.id, attemptFiles.attemptId))
    .innerJoin(items, eq(items.id, attempts.itemId))
    .where(
      and(
        eq(attemptFiles.id, c.req.param("id")),
        isNull(attemptFiles.deletedAt),
        isNull(attempts.deletedAt),
        isNull(items.deletedAt),
      ),
    )
    .get();
  const kept = part === "file" ? row?.file.stored : row?.file.hasThumb;
  if (!row || !kept) return apiError(c, 404, "not_found", "That file isn't here.");
  const object = await c.env.PHOTOS.get(fileKey(row.file.id, part), { onlyIf: c.req.raw.headers });
  if (!object) return apiError(c, 404, "not_found", "That file isn't here.");
  c.header("Cache-Control", IMMUTABLE);
  c.header("ETag", object.httpEtag);
  if (!("body" in object)) return c.body(null, 304);
  c.header("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
  if (part === "file") c.header("Content-Disposition", disposition(row.file.name));
  c.header("Content-Length", String(object.size));
  return c.body(object.body);
});
