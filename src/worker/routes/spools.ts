import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  type Spool as ApiSpool,
  MAX_PHOTO_BYTES,
  PHOTO_CONTENT_TYPES,
  type SpoolAttemptsResponse,
  type SpoolResponse,
  type SpoolsResponse,
  type SpoolUsageResponse,
} from "../../shared/api.ts";
import { gramsFromScale, levelOf, MAX_SPOOL_GRAMS, type SpoolGrams } from "../../shared/ledger.ts";
import { REMAINING } from "../../shared/spools.ts";
import { recordChange } from "../changes.ts";
import type { Db } from "../db/index.ts";
import { amsSlots, type Spool, spools, spoolWeighings } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { gramsFor, loadUsage, loadWeighings } from "../ledger.ts";
import { photoKey } from "../photos.ts";
import { attemptHits } from "./search.ts";

const id = z.uuid();
const words = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable();
const color = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .transform((value) => value.toLowerCase())
  .nullable();

const fields = {
  material: z.string().trim().min(1).max(40),
  brand: words(60).optional(),
  colorName: words(60).optional(),
  colorHex: color.optional(),
  finish: words(40).optional(),
  remaining: z.enum(REMAINING).optional(),
  note: z.string().max(20_000).optional(),
  driedAt: z.number().int().positive().nullable().optional(),
  trayUuid: words(80).optional(),
};

const grams = z.number().int().min(1).max(MAX_SPOOL_GRAMS);
const tare = z.number().int().min(0).max(MAX_SPOOL_GRAMS);
const createSpool = z.object({
  id,
  ...fields,
  netGrams: grams.nullable().optional(),
  tareGrams: tare.nullable().optional(),
  createdAt: z.number().int().positive().optional(),
});
const weightBody = z.object({ netGrams: grams.nullable().optional(), tareGrams: tare.nullable().optional() });
const weighBody = z
  .object({
    id,
    onScale: z
      .number()
      .min(0)
      .max(MAX_SPOOL_GRAMS * 2)
      .optional(),
    gramsLeft: z.number().min(0).max(MAX_SPOOL_GRAMS).optional(),
    tareGrams: tare.nullable().optional(),
    at: z.number().int().positive().optional(),
  })
  .refine((body) => body.onScale !== undefined || body.gramsLeft !== undefined);
const updateSpool = z.object({ ...fields, material: fields.material.optional() });

const photoFields = z.object({
  width: z.coerce.number().int().min(1).max(10_000),
  height: z.coerce.number().int().min(1).max(10_000),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .transform((value) => value.toLowerCase()),
});

const notFound = "That spool isn't on the shelf any more.";

export function toApiSpool(spool: Spool, slot: string | null, ledger?: SpoolGrams): ApiSpool {
  const gramsLeft = ledger?.gramsLeft ?? null;
  return {
    id: spool.id,
    material: spool.material,
    brand: spool.brand,
    colorName: spool.colorName,
    colorHex: spool.colorHex,
    finish: spool.finish,
    remaining: levelOf({ remaining: spool.remaining, gramsLeft, netGrams: spool.netGrams }),
    netGrams: spool.netGrams,
    tareGrams: spool.tareGrams,
    gramsLeft,
    gramsApproximate: ledger?.approximate ?? false,
    weighedAt: ledger?.weighedAt ?? null,
    note: spool.note,
    driedAt: spool.driedAt?.getTime() ?? null,
    photo:
      spool.photoId && spool.photoWidth && spool.photoHeight
        ? { id: spool.photoId, width: spool.photoWidth, height: spool.photoHeight, color: spool.photoColor ?? "" }
        : null,
    slot,
    trayUuid: spool.trayUuid,
    createdBy: spool.createdBy,
    createdAt: spool.createdAt.getTime(),
    updatedAt: spool.updatedAt.getTime(),
  };
}

async function loadSpool(db: Db, d1: D1Database, spoolId: string) {
  const row = await db
    .select({ spool: spools, slot: amsSlots.slot })
    .from(spools)
    .leftJoin(amsSlots, eq(amsSlots.spoolId, spools.id))
    .where(and(eq(spools.id, spoolId), isNull(spools.deletedAt)))
    .get();
  if (!row) return null;
  const ledger = (await gramsFor(db, d1, [row.spool])).get(row.spool.id);
  return toApiSpool(row.spool, row.slot, ledger);
}

/** /api/spools: the filament library. */
export const spoolRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await c.var.db
      .select({ spool: spools, slot: amsSlots.slot })
      .from(spools)
      .leftJoin(amsSlots, eq(amsSlots.spoolId, spools.id))
      .where(isNull(spools.deletedAt));
    const ledger = await gramsFor(
      c.var.db,
      c.env.DB,
      rows.map((row) => row.spool),
    );
    const list = rows
      .map((row) => toApiSpool(row.spool, row.slot, ledger.get(row.spool.id)))
      .sort((a, b) => a.material.localeCompare(b.material) || b.createdAt - a.createdAt);
    return c.json<SpoolsResponse>({ spools: list });
  })

  .post("/", async (c) => {
    const parsed = createSpool.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That spool couldn't be read.");
    const { id: spoolId, createdAt, driedAt, ...values } = parsed.data;
    const now = Date.now();
    const created = new Date(Math.min(createdAt ?? now, now));
    await c.var.db.batch([
      c.var.db
        .insert(spools)
        .values({
          id: spoolId,
          ...values,
          driedAt: driedAt ? new Date(Math.min(driedAt, now)) : null,
          createdBy: c.var.user.id,
          createdAt: created,
          updatedAt: created,
        })
        .onConflictDoNothing(),
      recordChange(c.var.db, { entity: "spool", id: spoolId, action: "created", actor: c.var.actor }),
    ]);
    const spool = await loadSpool(c.var.db, c.env.DB, spoolId);
    if (!spool) return apiError(c, 409, "deleted", "That spool was deleted.");
    return c.json<SpoolResponse>({ spool }, 201);
  })

  .get("/:id", async (c) => {
    const spool = await loadSpool(c.var.db, c.env.DB, c.req.param("id"));
    if (!spool) return apiError(c, 404, "not_found", notFound);
    return c.json<SpoolResponse>({ spool });
  })

  .patch("/:id", async (c) => {
    const parsed = updateSpool.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That change couldn't be read.");
    const { driedAt, ...values } = parsed.data;
    const now = new Date();
    const spoolId = c.req.param("id");
    // Grams win: once a spool has gram data its level follows them, so a level set by hand or reported by the
    // AMS (the printer bridge sends one on every sync) is left out, and a request with nothing else changes nothing.
    if (values.remaining !== undefined) {
      const known = await loadSpool(c.var.db, c.env.DB, spoolId);
      if (known && known.gramsLeft !== null) {
        delete values.remaining;
        if (!Object.keys(values).length && driedAt === undefined) return c.json<SpoolResponse>({ spool: known });
      }
    }
    const [[row]] = await c.var.db.batch([
      c.var.db
        .update(spools)
        .set({
          ...values,
          ...(driedAt !== undefined ? { driedAt: driedAt ? new Date(Math.min(driedAt, now.getTime())) : null } : {}),
          updatedAt: now,
        })
        .where(and(eq(spools.id, spoolId), isNull(spools.deletedAt)))
        .returning({ id: spools.id }),
      recordChange(c.var.db, { entity: "spool", id: spoolId, action: "updated", actor: c.var.actor }),
    ]);
    if (!row) return apiError(c, 404, "not_found", notFound);
    const spool = await loadSpool(c.var.db, c.env.DB, row.id);
    if (!spool) return apiError(c, 404, "not_found", notFound);
    return c.json<SpoolResponse>({ spool });
  })

  /** Takes it off the shelf at once (its slot reads as empty); restore is the undo. */
  .delete("/:id", async (c) => {
    const spoolId = c.req.param("id");
    const [[row]] = await c.var.db.batch([
      c.var.db
        .update(spools)
        .set({ deletedAt: new Date() })
        .where(and(eq(spools.id, spoolId), isNull(spools.deletedAt)))
        .returning({ id: spools.id }),
      recordChange(c.var.db, { entity: "spool", id: spoolId, action: "deleted", actor: c.var.actor }),
    ]);
    if (!row) return apiError(c, 404, "not_found", notFound);
    return c.body(null, 204);
  })

  .post("/:id/restore", async (c) => {
    const spoolId = c.req.param("id");
    await c.var.db.batch([
      c.var.db
        .update(spools)
        .set({ deletedAt: null })
        .where(and(eq(spools.id, spoolId), isNotNull(spools.deletedAt))),
      recordChange(c.var.db, { entity: "spool", id: spoolId, action: "restored", actor: c.var.actor }),
    ]);
    const spool = await loadSpool(c.var.db, c.env.DB, spoolId);
    if (!spool) return apiError(c, 404, "not_found", "That spool is gone for good.");
    return c.json<SpoolResponse>({ spool });
  })

  /** What it held when new and what the empty spool weighs. Null clears it: back to a hand-set level. */
  .put("/:id/weight", async (c) => {
    const parsed = weightBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That weight couldn't be read.");
    const spoolId = c.req.param("id");
    const update = c.var.db
      .update(spools)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(spools.id, spoolId), isNull(spools.deletedAt)))
      .returning({ id: spools.id });
    const change = recordChange(c.var.db, { entity: "spool", id: spoolId, action: "updated", actor: c.var.actor });
    // Clearing the net weight stops counting in grams altogether: the weighings go in the same batch, or they
    // would keep the grams (and a refetch between two writes would see the old ones).
    const [[row]] =
      parsed.data.netGrams === null
        ? await c.var.db.batch([
            update,
            c.var.db
              .delete(spoolWeighings)
              .where(
                and(
                  eq(spoolWeighings.spoolId, spoolId),
                  inArray(
                    spoolWeighings.spoolId,
                    c.var.db.select({ id: spools.id }).from(spools).where(isNull(spools.deletedAt)),
                  ),
                ),
              ),
            change,
          ])
        : await c.var.db.batch([update, change]);
    if (!row) return apiError(c, 404, "not_found", notFound);
    const spool = await loadSpool(c.var.db, c.env.DB, spoolId);
    if (!spool) return apiError(c, 404, "not_found", notFound);
    return c.json<SpoolResponse>({ spool });
  })

  /** A weighing: a fresh baseline. A retry with the same id changes nothing. */
  .post("/:id/weighings", async (c) => {
    const parsed = weighBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That weighing couldn't be read.");
    const spoolId = c.req.param("id");
    const db = c.var.db;
    const current = await db
      .select()
      .from(spools)
      .where(and(eq(spools.id, spoolId), isNull(spools.deletedAt)))
      .get();
    if (!current) return apiError(c, 404, "not_found", notFound);
    const { id: weighingId, onScale, tareGrams, at } = parsed.data;
    const emptySpool = tareGrams !== undefined ? tareGrams : current.tareGrams;
    const left = parsed.data.gramsLeft ?? gramsFromScale(onScale ?? 0, emptySpool);
    const now = Date.now();
    await db.batch([
      db
        .insert(spoolWeighings)
        .values({
          id: weighingId,
          spoolId,
          gramsLeft: Math.round(left),
          onScale: onScale === undefined ? null : Math.round(onScale),
          weighedAt: new Date(Math.min(at ?? now, now)),
          createdBy: c.var.user.id,
        })
        .onConflictDoNothing(),
      db
        .update(spools)
        .set({ ...(tareGrams !== undefined ? { tareGrams } : {}), updatedAt: new Date(now) })
        .where(eq(spools.id, spoolId)),
      recordChange(db, { entity: "spool", id: spoolId, action: "updated", actor: c.var.actor }),
    ]);
    const spool = await loadSpool(db, c.env.DB, spoolId);
    if (!spool) return apiError(c, 404, "not_found", notFound);
    return c.json<SpoolResponse>({ spool }, 201);
  })

  /** Takes a weighing back (the undo of a mistyped one): person only. */
  .delete("/:id/weighings/:weighingId", async (c) => {
    const spoolId = c.req.param("id");
    await c.var.db.batch([
      c.var.db
        .delete(spoolWeighings)
        .where(and(eq(spoolWeighings.id, c.req.param("weighingId")), eq(spoolWeighings.spoolId, spoolId))),
      recordChange(c.var.db, { entity: "spool", id: spoolId, action: "updated", actor: c.var.actor }),
    ]);
    const spool = await loadSpool(c.var.db, c.env.DB, spoolId);
    if (!spool) return apiError(c, 404, "not_found", notFound);
    return c.json<SpoolResponse>({ spool });
  })

  /** What used it, newest first, and its weighings: the history on the spool page. */
  .get("/:id/usage", async (c) => {
    const spoolId = c.req.param("id");
    const spool = await loadSpool(c.var.db, c.env.DB, spoolId);
    if (!spool) return apiError(c, 404, "not_found", notFound);
    const [entries, weighed] = await Promise.all([loadUsage(c.env.DB, spoolId), loadWeighings(c.var.db, [spoolId])]);
    const weighings = [...(weighed.get(spoolId) ?? [])].sort((a, b) => b.at - a.at);
    const latest = weighings[0]?.at ?? Number.NEGATIVE_INFINITY;
    const hits = await attemptHits(
      c.var.db,
      entries.map((entry) => entry.attemptId),
    );
    return c.json<SpoolUsageResponse>({
      usage: entries
        .sort((a, b) => b.at - a.at)
        .flatMap((entry) => {
          const hit = hits.find((h) => h.attempt.id === entry.attemptId);
          if (!hit?.attempt.outcome) return [];
          return [
            {
              attemptId: entry.attemptId,
              itemId: entry.itemId,
              title: hit.item.title,
              number: hit.number,
              outcome: hit.attempt.outcome,
              grams: entry.grams,
              approximate: entry.approximate,
              at: entry.at,
              counted: entry.at > latest,
            },
          ];
        }),
      weighings,
    });
  })

  /**
   * The spool's photo (its label), resized in the browser like any photo and
   * stored as photos/<photoId>/large and /thumb. A new photo replaces the old.
   */
  .put("/:id/photo/:photoId", async (c) => {
    const spoolId = c.req.param("id");
    const photoId = c.req.param("photoId");
    if (!id.safeParse(photoId).success) return apiError(c, 400, "invalid", "That photo id isn't valid.");
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > 2 * MAX_PHOTO_BYTES) return apiError(c, 413, "too_large", "That photo is too large.");
    const db = c.var.db;
    const current = await db
      .select()
      .from(spools)
      .where(and(eq(spools.id, spoolId), isNull(spools.deletedAt)))
      .get();
    if (!current) return apiError(c, 404, "not_found", notFound);
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
        .update(spools)
        .set({
          photoId,
          photoWidth: parsed.data.width,
          photoHeight: parsed.data.height,
          photoColor: parsed.data.color,
          updatedAt: new Date(),
        })
        .where(and(eq(spools.id, spoolId), isNull(spools.deletedAt))),
      recordChange(db, { entity: "spool", id: spoolId, action: "updated", actor: c.var.actor }),
    ]);
    // The photo it replaces (a retry of the same upload keeps it).
    if (current.photoId && current.photoId !== photoId) {
      await c.env.PHOTOS.delete([photoKey(current.photoId, "large"), photoKey(current.photoId, "thumb")]);
    }
    const spool = await loadSpool(db, c.env.DB, spoolId);
    if (!spool) return apiError(c, 404, "not_found", notFound);
    return c.json<SpoolResponse>({ spool });
  })

  /** The attempts printed with this spool, newest first: "how does this silk PLA behave". */
  .get("/:id/attempts", async (c) => {
    const spoolId = c.req.param("id");
    const { results } = await c.env.DB.prepare(
      `SELECT a.id FROM attempts AS a JOIN items AS i ON i.id = a.item_id
        WHERE a.deleted_at IS NULL AND i.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM json_each(a.settings, '$.filaments') AS f WHERE json_extract(f.value, '$.spoolId') = ?)
        ORDER BY a.printed_at DESC LIMIT 100`,
    )
      .bind(spoolId)
      .all<{ id: string }>();
    return c.json<SpoolAttemptsResponse>({
      attempts: await attemptHits(
        c.var.db,
        results.map((row) => row.id),
      ),
    });
  });

/** For the OpenAPI document (worker/openapi). */
export { createSpool, photoFields as spoolPhotoFields, updateSpool, weighBody, weightBody };
