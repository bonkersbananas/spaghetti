import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import { z } from "zod";
import {
  type AttemptResponse,
  type ItemFileResponse,
  MAX_FILE_THUMB_BYTES,
  MAX_MODEL_FILE_BYTES,
  MAX_SLICER_FILE_BYTES,
} from "../../shared/api.ts";
import { isStlName, slicedName } from "../../shared/slicing/files.ts";
import { afterChange, fileOfAttempt, itemOfAttempt, recordChange } from "../changes.ts";
import { type AttemptFileRow, attemptFiles, attempts, type ItemFileRow, itemFiles, items } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError, toApiFile } from "../http.ts";
import { fileKey } from "../photos.ts";
import { loadAttempt, settings } from "./attempts.ts";

const THUMB_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** The 3MF package type: a slicer file, or a model's sliced .gcode.3mf. */
const THREEMF_TYPE = "application/vnd.ms-package.3dmanufacturing-3dmodel+xml";

/** The most a file upload's body may hold before it is read: a model, its picture and the fields. */
const MAX_UPLOAD = MAX_MODEL_FILE_BYTES + MAX_FILE_THUMB_BYTES + 256 * 1024;

/** A JSON form field, checked by `schema`. */
const jsonField = <T extends z.ZodType>(schema: T) =>
  z
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
    .pipe(schema);

const millimetres = z.number().min(0).max(100_000);

/** How a model was sliced (shared/slicing/types.ts SliceSettings). */
const sliceSettings = z.object({
  machine: z.string().max(120),
  process: z.string().max(120),
  filaments: z.array(z.string().max(120)).max(16),
  layerHeight: z.number().min(0).max(10),
  materials: z.array(z.string().max(40)).max(16),
  bedType: z.string().max(80),
  supports: z.boolean(),
  scale: z.number().int().min(1).max(100),
  project: z.enum(["own", "some"]).optional(),
  engine: z.string().max(40),
  orca: z.string().max(40),
});

/** A model's slicing (shared/slicing/types.ts FileSlice), as the browser that sliced it says. */
const fileSlice = z.object({
  status: z.enum(["sliced", "failed"]),
  settings: sliceSettings,
  bytes: z.number().int().min(0).max(MAX_SLICER_FILE_BYTES).optional(),
  cautions: z
    .array(z.enum(["floating"]))
    .max(4)
    .optional(),
  problem: z
    .enum(["too-big", "too-tall", "too-many", "no-model", "unreadable", "memory", "engine", "orca", "too-large"])
    .optional(),
  message: z.string().max(300).optional(),
  dimensions: z.tuple([millimetres, millimetres, millimetres]).optional(),
  volume: z.tuple([millimetres, millimetres, millimetres]).optional(),
  fitScale: z.number().int().min(1).max(100).optional(),
  device: z.enum(["phone", "computer"]).optional(),
  at: z.number().int().min(0),
});

/** The fields of PUT /api/files/:id/sliced (multipart, beside the `sliced` file and its `thumb`). */
const slicedFields = z.object({
  slice: jsonField(fileSlice),
  /** What the app's reader makes of the sliced file (attempt settings), when it was sliced. */
  prefill: jsonField(settings).optional(),
  objects: jsonField(z.array(z.string().trim().min(1).max(200)).max(500)).optional(),
  slicer: z.string().trim().max(80).optional(),
});

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
  /** "model" for an .stl or plain .3mf Spaghetti slices (its bytes are required, up to MAX_MODEL_FILE_BYTES). */
  kind: z.enum(["slicer", "model"]).default("slicer"),
});

/**
 * Why a file's upload can't be kept, or null: a slicer file is kept up to MAX_SLICER_FILE_BYTES (only what it said,
 * above), a model only with its bytes, up to MAX_MODEL_FILE_BYTES; the plate's picture is a small image.
 */
function uploadProblem(kind: "slicer" | "model", file: unknown, thumb: unknown) {
  if (kind === "model" && !(file instanceof File)) return { status: 400 as const, message: "A model needs its file." };
  const cap = kind === "model" ? MAX_MODEL_FILE_BYTES : MAX_SLICER_FILE_BYTES;
  if (file instanceof File && file.size > cap)
    return { status: 413 as const, message: "That file is too large to keep." };
  if (thumb instanceof File && (thumb.size > MAX_FILE_THUMB_BYTES || !THUMB_TYPES.includes(thumb.type))) {
    return { status: 415 as const, message: "The plate's picture couldn't be kept." };
  }
  return null;
}

/** How R2 keeps a file's bytes: a model as what it is, anything else as a 3MF. */
function fileMetadata(kind: "slicer" | "model", name: string) {
  return {
    contentType: kind === "model" ? (isStlName(name) ? "model/stl" : "model/3mf") : THREEMF_TYPE,
    contentDisposition: disposition(name),
  };
}

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
    if (length > MAX_UPLOAD) return apiError(c, 413, "too_large", "That file is too large to keep.");
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
    const refused = uploadProblem(fields.kind, file, thumb);
    if (refused) return refuse(c, refused);
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
            httpMetadata: fileMetadata(fields.kind, fields.name),
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
      await c.env.PHOTOS.delete(
        others.flatMap((row) => [fileKey(row.id, "file"), fileKey(row.id, "thumb"), fileKey(row.id, "sliced")]),
      );
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
      kind: fields.kind,
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
    if (length > MAX_UPLOAD) return apiError(c, 413, "too_large", "That file is too large to keep.");
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
    const refused = uploadProblem(fields.kind, file, thumb);
    if (refused) return refuse(c, refused);
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
            httpMetadata: fileMetadata(fields.kind, fields.name),
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
      kind: fields.kind,
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

/** The answer for an upload that can't be kept (uploadProblem). */
function refuse(c: Parameters<typeof apiError>[0], refused: NonNullable<ReturnType<typeof uploadProblem>>) {
  const code = refused.status === 413 ? "too_large" : refused.status === 415 ? "unsupported" : "invalid";
  return apiError(c, refused.status, code, refused.message);
}

/** "bracket v2.gcode.3mf" as a download name, safe in a header. */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** A file's bytes never change (a new file gets a new id). */
const IMMUTABLE = "private, max-age=31536000, immutable";

/**
 * A file that is there to be served or sliced: kept on a live attempt of a live item, or on a live item. Says which
 * table it is in and its item, for the change feed.
 */
async function liveFile(
  c: { var: AppEnv["Variables"] },
  id: string,
): Promise<{ row: AttemptFileRow | ItemFileRow; table: "attempt" | "item"; itemId: string } | undefined> {
  const db = c.var.db;
  const [onAttempt, onItem] = await Promise.all([
    db
      .select({ file: attemptFiles, itemId: attempts.itemId })
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
  if (onAttempt) return { row: onAttempt.file, table: "attempt", itemId: onAttempt.itemId };
  if (onItem) return { row: onItem.file, table: "item", itemId: onItem.file.itemId };
  return undefined;
}

/**
 * /api/files/:id: the bytes, the plate's picture (`/thumb`) and a model's sliced .gcode.3mf (`/sliced`), for
 * signed-in people, while the attempt or item is there; and the sliced part's upload.
 */
export const fileRoutes = new Hono<AppEnv>()
  .get("/:id/:part?", async (c) => {
    const part = c.req.param("part") ?? "file";
    if (part !== "file" && part !== "thumb" && part !== "sliced") {
      return apiError(c, 404, "not_found", "No such part.");
    }
    const file = (await liveFile(c, c.req.param("id")))?.row;
    const kept =
      part === "file"
        ? file?.stored
        : part === "thumb"
          ? file?.hasThumb
          : file?.kind === "model" && file.slice?.status === "sliced";
    if (!file || !kept) return apiError(c, 404, "not_found", "That file isn't here.");
    const object = await c.env.PHOTOS.get(fileKey(file.id, part), { onlyIf: c.req.raw.headers });
    if (!object) return apiError(c, 404, "not_found", "That file isn't here.");
    // A model's picture and sliced file change when it is sliced again: they are checked, not kept for a year.
    c.header("Cache-Control", file.kind === "model" && part !== "file" ? "private, no-cache" : IMMUTABLE);
    c.header("ETag", object.httpEtag);
    if (!("body" in object)) return c.body(null, 304);
    c.header("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
    if (part === "file") c.header("Content-Disposition", disposition(file.name));
    if (part === "sliced") c.header("Content-Disposition", disposition(slicedName(file.name)));
    c.header("Content-Length", String(object.size));
    return c.body(object.body);
  })

  /**
   * Multipart: `slice` (how it went, JSON), and when it was sliced the `sliced` .gcode.3mf (up to
   * MAX_SLICER_FILE_BYTES), what the reader made of it (`prefill`, `objects`, `slicer`) and the plate's `thumb`. A
   * failed slice may send its picture too. Slicing again replaces it; only a model is sliced.
   */
  .put("/:id/sliced", async (c) => {
    const id = c.req.param("id");
    if (!z.uuid().safeParse(id).success) return apiError(c, 400, "invalid", "That file's id isn't valid.");
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > MAX_SLICER_FILE_BYTES + MAX_FILE_THUMB_BYTES + 256 * 1024) {
      return apiError(c, 413, "too_large", "That sliced file is too large to keep.");
    }
    const found = await liveFile(c, id);
    // 404 tells the slicing job its model was removed meanwhile (or isn't saved yet: it tries again).
    if (!found) return apiError(c, 404, "not_found", "That file isn't here.");
    if (found.row.kind !== "model") return apiError(c, 409, "conflict", "Only a model is sliced.");
    const form = await c.req.formData().catch(() => null);
    const parsed = slicedFields.safeParse(
      form ? Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string")) : null,
    );
    if (!parsed.success) return apiError(c, 400, "invalid", "That slice's details couldn't be read.");
    const fields = parsed.data;
    const sliced = form?.get("sliced");
    const thumb = form?.get("thumb");
    const done = fields.slice.status === "sliced";
    if (done && !(sliced instanceof File)) return apiError(c, 400, "invalid", "A sliced model needs its file.");
    if (sliced instanceof File && sliced.size > MAX_SLICER_FILE_BYTES) {
      return apiError(c, 413, "too_large", "That sliced file is too large to keep.");
    }
    if (thumb instanceof File && (thumb.size > MAX_FILE_THUMB_BYTES || !THUMB_TYPES.includes(thumb.type))) {
      return apiError(c, 415, "unsupported", "The plate's picture couldn't be kept.");
    }
    const { row, table, itemId } = found;
    await Promise.all([
      done && sliced instanceof File
        ? c.env.PHOTOS.put(fileKey(id, "sliced"), sliced.stream(), {
            httpMetadata: { contentType: THREEMF_TYPE, contentDisposition: disposition(slicedName(row.name)) },
          })
        : c.env.PHOTOS.delete(fileKey(id, "sliced")),
      thumb instanceof File
        ? c.env.PHOTOS.put(fileKey(id, "thumb"), thumb.stream(), { httpMetadata: { contentType: thumb.type } })
        : null,
    ]);
    const values = {
      slice: { ...fields.slice, ...(done && sliced instanceof File ? { bytes: sliced.size } : {}) },
      hasThumb: row.hasThumb || thumb instanceof File,
      // What the sliced file says replaces what the model said (nothing); a failure leaves it.
      ...(done ? { prefill: fields.prefill ?? {}, objects: fields.objects ?? [], slicer: fields.slicer || null } : {}),
    };
    const db = c.var.db;
    const target = table === "attempt" ? attemptFiles : itemFiles;
    await db.batch([
      db.update(target).set(values).where(eq(target.id, id)),
      recordChange(db, { entity: "file", id, itemId, action: "updated", actor: c.var.actor }),
      db
        .update(items)
        .set({ updatedAt: new Date() })
        .where(and(eq(items.id, itemId), afterChange)),
    ]);
    const updated = await db.select().from(target).where(eq(target.id, id)).get();
    return c.json<ItemFileResponse>({ file: toApiFile(updated as NonNullable<typeof updated>) });
  });

/** For the OpenAPI document (worker/openapi). */
export { fileFields, fileSlice, slicedFields };
