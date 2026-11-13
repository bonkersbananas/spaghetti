import { Hono } from "hono";
import { z } from "zod";
import {
  MAX_MODEL_FILE_BYTES,
  MAX_SLICER_FILE_BYTES,
  type StartUploadResponse,
  UPLOAD_PART_BYTES,
} from "../../shared/api.ts";
import { isStlName } from "../../shared/slicing/files.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { fileKey } from "../photos.ts";
import { disposition, liveFile, THREEMF_TYPE } from "./files.ts";

/**
 * /api/uploads: a big file (over ONE_REQUEST_FILE_BYTES) sent in parts, because one request body may hold 100 MB at
 * most. Each part is streamed into an R2 multipart upload for the file's key (files/<id>/file or …/sliced); once
 * complete the browser saves the file's row as usual, with `uploaded` in place of the bytes. Nothing is visible
 * until the upload completes, and an upload that is never finished is dropped by R2 itself (incomplete multipart
 * uploads are aborted after 7 days), so no sweep of ours is needed.
 */

/** The most parts any file can have: its cap over the part size, rounded up. */
const MAX_PARTS = Math.ceil(Math.max(MAX_MODEL_FILE_BYTES, MAX_SLICER_FILE_BYTES) / UPLOAD_PART_BYTES);

const ids = z.object({
  id: z.uuid(),
  part: z.enum(["file", "sliced"]),
  uploadId: z.string().min(1).max(2000),
});

const start = z.object({
  id: z.uuid(),
  part: z.enum(["file", "sliced"]),
  kind: z.enum(["slicer", "model"]),
  name: z.string().trim().min(1).max(200),
  size: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});

const finish = z.object({
  size: z.number().int().min(1),
  parts: z
    .array(z.object({ n: z.number().int().min(1).max(MAX_PARTS), etag: z.string().min(1).max(200) }))
    .min(1)
    .max(MAX_PARTS),
});

/** The most a file of this kind and part may hold. */
const capOf = (part: "file" | "sliced", kind: "slicer" | "model") =>
  part === "file" && kind === "model" ? MAX_MODEL_FILE_BYTES : MAX_SLICER_FILE_BYTES;

export const uploadRoutes = new Hono<AppEnv>()
  /** Starts an upload for a file's bytes (`file`) or a model's sliced file (`sliced`, people only). */
  .post("/", async (c) => {
    const parsed = start.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That upload's details couldn't be read.");
    const { id, part, kind, name, size } = parsed.data;
    if (size > capOf(part, kind)) return apiError(c, 413, "too_large", "That file is too large to keep.");
    if (part === "sliced") {
      // Only people slice, and only a model that is there.
      if (c.var.via) return apiError(c, 403, "forbidden", "Only a person can send a sliced file.");
      const found = await liveFile(c, id);
      if (!found) return apiError(c, 404, "not_found", "That file isn't here.");
      if (found.row.kind !== "model") return apiError(c, 409, "conflict", "Only a model is sliced.");
    }
    const contentType =
      part === "sliced" || kind === "slicer" ? THREEMF_TYPE : isStlName(name) ? "model/stl" : "model/3mf";
    const upload = await c.env.PHOTOS.createMultipartUpload(fileKey(id, part), {
      httpMetadata: { contentType, contentDisposition: disposition(name) },
    });
    return c.json<StartUploadResponse>({ uploadId: upload.uploadId, partSize: UPLOAD_PART_BYTES }, 201);
  })

  /** One part, streamed into R2 as it arrives. Sending the same part again replaces it. */
  .put("/:id/:part/:uploadId/:n", async (c) => {
    const where = ids.safeParse(c.req.param());
    const n = Number(c.req.param("n"));
    if (!where.success || !Number.isInteger(n) || n < 1 || n > MAX_PARTS) {
      return apiError(c, 400, "invalid", "That part isn't valid.");
    }
    const length = Number(c.req.header("content-length") ?? Number.NaN);
    if (!Number.isInteger(length) || length < 1) return apiError(c, 411, "length_required", "A part needs its size.");
    if (length > UPLOAD_PART_BYTES) return apiError(c, 413, "too_large", "That part is too large.");
    if (!c.req.raw.body) return apiError(c, 400, "invalid", "That part is empty.");
    const { id, part, uploadId } = where.data;
    try {
      const upload = c.env.PHOTOS.resumeMultipartUpload(fileKey(id, part), uploadId);
      const uploaded = await upload.uploadPart(n, c.req.raw.body);
      return c.json({ n, etag: uploaded.etag });
    } catch {
      // Unknown or finished upload: the browser starts a new one.
      return apiError(c, 404, "not_found", "That upload isn't open any more.");
    }
  })

  /**
   * Puts the parts together. Idempotent: if the answer was lost and the file is already there with this size, it is
   * done. A file of another size than the one said (or over its cap) is removed again.
   */
  .post("/:id/:part/:uploadId/complete", async (c) => {
    const where = ids.safeParse(c.req.param());
    const body = finish.safeParse(await c.req.json().catch(() => null));
    if (!where.success || !body.success) return apiError(c, 400, "invalid", "That upload's parts couldn't be read.");
    const { id, part, uploadId } = where.data;
    const key = fileKey(id, part);
    const parts = [...body.data.parts].sort((a, b) => a.n - b.n);
    let size: number;
    try {
      const object = await c.env.PHOTOS.resumeMultipartUpload(key, uploadId).complete(
        parts.map((p) => ({ partNumber: p.n, etag: p.etag })),
      );
      size = object.size;
    } catch {
      const done = await c.env.PHOTOS.head(key);
      if (!done || done.size !== body.data.size) {
        return apiError(c, 409, "conflict", "That upload couldn't be put together. Send it again.");
      }
      size = done.size;
    }
    const cap = part === "file" ? Math.max(MAX_MODEL_FILE_BYTES, MAX_SLICER_FILE_BYTES) : MAX_SLICER_FILE_BYTES;
    if (size !== body.data.size || size > cap) {
      await c.env.PHOTOS.delete(key);
      return apiError(
        c,
        size > cap ? 413 : 409,
        size > cap ? "too_large" : "conflict",
        "That file didn't arrive whole.",
      );
    }
    return c.json({ size });
  })

  /** Drops an upload that failed or was cancelled. Harmless when it is already gone. */
  .delete("/:id/:part/:uploadId", async (c) => {
    const where = ids.safeParse(c.req.param());
    if (!where.success) return apiError(c, 400, "invalid", "That upload isn't valid.");
    const { id, part, uploadId } = where.data;
    await c.env.PHOTOS.resumeMultipartUpload(fileKey(id, part), uploadId)
      .abort()
      .catch(() => undefined);
    return c.body(null, 204);
  });

/** For the OpenAPI document (worker/openapi). */
export { finish as finishUpload, start as startUpload };
