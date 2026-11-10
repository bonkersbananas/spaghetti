import { and, asc, desc, eq, inArray, isNotNull, isNull, max, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import { z } from "zod";
import {
  type ItemResponse,
  type ItemsResponse,
  MAX_PHOTO_BYTES,
  PHOTO_CONTENT_TYPES,
  type PhotoResponse,
} from "../../shared/api.ts";
import { beganAsIdea } from "../../shared/deleted.ts";
import { canUse, missingScope } from "../auth/scopes.ts";
import { afterChange, recordChange } from "../changes.ts";
import type { Db } from "../db/index.ts";
import {
  type Attempt,
  attemptFiles,
  attempts,
  ITEM_STAGES,
  type Item,
  type ItemStage,
  itemDrafts,
  items,
  type Photo,
  photos,
} from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError, toApiItem, toApiPhoto } from "../http.ts";
import { photoKey } from "../photos.ts";

const id = z.uuid();
const title = z
  .string()
  .max(200)
  .transform((value) => value.trim() || null)
  .nullable();
const note = z.string().max(20_000);

const createItem = z.object({
  id,
  title: title.optional(),
  note: note.optional(),
  createdAt: z.number().int().positive().optional(),
  stage: z.enum(["idea", "building"]).optional(),
});
const updateItem = z.object({
  title: title.optional(),
  note: note.optional(),
  stage: z.enum(ITEM_STAGES).optional(),
  coverPhotoId: id.nullable().optional(),
  /** true: at the end of the queue; false or null: off it; a number: that place (the undo of taking it off). */
  upNext: z.union([z.boolean(), z.number().int().min(1).max(10_000), z.null()]).optional(),
  /** Who it is for; empty clears it. */
  forWhom: z
    .string()
    .max(80)
    .transform((value) => value.trim() || null)
    .nullable()
    .optional(),
});
const upNextOrder = z.object({ ids: z.array(id).max(500) });
const reorder = z.object({ photoIds: z.array(id).max(200) });
const unscrap = z.object({
  stage: z.enum(["building", "done", "shelved"]),
  startedAt: z.number().int().positive(),
  finishedAt: z.number().int().positive().nullable(),
  coverPhotoId: id.nullable(),
  attemptIds: z.array(id).max(500),
});
/** `?stage=building,done,shelved`: one stage or several. */
const listQuery = z.object({
  stage: z
    .string()
    .transform((value) => value.split(","))
    .pipe(z.array(z.enum(ITEM_STAGES)).min(1))
    .optional(),
});

const photoFields = z.object({
  width: z.coerce.number().int().min(1).max(10_000),
  height: z.coerce.number().int().min(1).max(10_000),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .transform((value) => value.toLowerCase()),
  takenAt: z.coerce.number().int().positive().optional(),
  position: z.coerce.number().int().min(0).max(10_000).optional(),
  /** The print attempt the photo shows. */
  attemptId: id.optional(),
  /**
   * "1" from something that couldn't resize (an agent, the printer bridge): `large` and `thumb` are the same
   * original. It is stored as is and flagged for the next browser to resize (see photos.needs_resize).
   */
  needsResize: z
    .enum(["1", "true"])
    .optional()
    .transform((value) => value !== undefined),
});

/** D1 binds at most 100 parameters per query, so long id lists are looked up in slices. */
const CHUNK = 90;

function chunked<T>(list: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));
  return chunks;
}

function groupBy<T extends { itemId: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.itemId);
    if (group) group.push(row);
    else groups.set(row.itemId, [row]);
  }
  return groups;
}

/**
 * Items with their photos and print attempts: three queries however many
 * items (more past D1's parameter limit). Photos of deleted attempts are left
 * out, so they come back when the attempt is restored.
 */
export async function loadItems(db: Db, where: ReturnType<typeof and>) {
  const rows = await db.select().from(items).where(where).orderBy(desc(items.createdAt), desc(items.id));
  if (!rows.length) return [];
  const slices = chunked(rows.map((row) => row.id));
  const [draftSlices, photoSlices, attemptSlices] = await Promise.all([
    Promise.all(slices.map((ids) => db.select().from(itemDrafts).where(inArray(itemDrafts.itemId, ids)))),
    Promise.all(
      slices.map((ids) =>
        db
          .select()
          .from(photos)
          .where(and(inArray(photos.itemId, ids), isNull(photos.deletedAt)))
          .orderBy(asc(photos.position), asc(photos.createdAt)),
      ),
    ),
    Promise.all(
      slices.map((ids) =>
        db
          .select()
          .from(attempts)
          .where(and(inArray(attempts.itemId, ids), isNull(attempts.deletedAt))),
      ),
    ),
  ]);
  const attemptsByItem = groupBy<Attempt>(attemptSlices.flat());
  const liveAttempts = new Set(attemptSlices.flat().map((attempt) => attempt.id));
  const fileRows = (
    await Promise.all(
      chunked([...liveAttempts]).map((ids) =>
        db
          .select()
          .from(attemptFiles)
          .where(and(inArray(attemptFiles.attemptId, ids), isNull(attemptFiles.deletedAt))),
      ),
    )
  ).flat();
  const draftsByItem = new Map(draftSlices.flat().map((draft) => [draft.itemId, draft]));
  const files = new Map(fileRows.map((file) => [file.attemptId, file]));
  const photosByItem = groupBy<Photo>(
    photoSlices.flat().filter((photo) => photo.attemptId === null || liveAttempts.has(photo.attemptId)),
  );
  return rows.map((row) => {
    const itemPhotos = photosByItem.get(row.id) ?? [];
    // A cover that was removed (or whose attempt was) reads as none, and returns with undo.
    const coverPhotoId = itemPhotos.some((photo) => photo.id === row.coverPhotoId) ? row.coverPhotoId : null;
    return toApiItem(
      { ...row, coverPhotoId },
      itemPhotos,
      attemptsByItem.get(row.id) ?? [],
      files,
      draftsByItem.get(row.id),
    );
  });
}

export async function loadItem(db: Db, itemId: string) {
  const [item] = await loadItems(db, and(eq(items.id, itemId), isNull(items.deletedAt)));
  return item ?? null;
}

/** The queue column for a requested change: the end of the queue is worked out by the database. */
const upNextValue = (change: boolean | number | null) =>
  change === true
    ? sql<number>`(SELECT coalesce(max(up_next), 0) + 1 FROM items WHERE up_next IS NOT NULL)`
    : change === false || change === null
      ? null
      : change;

const notFound = "That isn't here any more.";
const goneForGood = "That's gone for good.";

/**
 * The dates that go with a move to `stage`: becoming a build starts it,
 * finishing or shelving it finishes it, and going back to an idea (the undo
 * of "start building") clears both. Moving to the stage it is already in
 * keeps its dates.
 */
export function stageDates(item: Pick<Item, "stage" | "startedAt" | "finishedAt">, stage: ItemStage, now: Date) {
  if (stage === "idea") return { stage, startedAt: null, finishedAt: null };
  const startedAt = item.startedAt ?? now;
  if (stage === "building") return { stage, startedAt, finishedAt: null };
  return { stage, startedAt, finishedAt: item.stage === stage ? (item.finishedAt ?? now) : now };
}

/**
 * Ideas and builds: one record that moves through stages.
 * Writes are idempotent where a retried upload could repeat them.
 */
export const itemRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const query = listQuery.safeParse(c.req.query());
    if (!query.success) return apiError(c, 400, "invalid", "Unknown stage.");
    const stages = query.data.stage;
    const list = await loadItems(
      c.var.db,
      and(isNull(items.deletedAt), stages ? inArray(items.stage, [...new Set(stages)]) : undefined),
    );
    return c.json<ItemsResponse>({ items: list });
  })

  .post("/", async (c) => {
    const parsed = createItem.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That couldn't be read.");
    // Capture adds ideas; an item that starts as a build is work on attempts.
    const starts = parsed.data.stage === "building";
    if (!canUse(c, starts ? "attempts" : "capture")) return missingScope(c, [starts ? "attempts" : "capture"]);
    const now = Date.now();
    const { id: itemId, title: itemTitle, note: itemNote, createdAt, stage = "idea" } = parsed.data;
    // A capture made offline keeps the time it was made, but never one in the future.
    const created = new Date(Math.min(createdAt ?? now, now));
    // A retried capture finds its item already there and gets it back unchanged.
    await c.var.db.batch([
      c.var.db
        .insert(items)
        .values({
          id: itemId,
          title: itemTitle ?? null,
          note: itemNote ?? "",
          stage,
          // A build started from scratch starts when it was made.
          startedAt: stage === "building" ? created : null,
          createdBy: c.var.user.id,
          createdVia: c.var.via,
          createdAt: created,
          updatedAt: created,
        })
        .onConflictDoNothing(),
      recordChange(c.var.db, {
        entity: "item",
        id: itemId,
        itemId,
        action: "created",
        actor: c.var.actor,
      }),
    ]);
    const item = await loadItem(c.var.db, itemId);
    if (!item) return apiError(c, 409, "deleted", "That was deleted.");
    return c.json<ItemResponse>({ item }, 201);
  })

  /** The Up next queue's order: these ideas first, in this order; any queued one not mentioned keeps its turn after them. */
  .put("/up-next/order", async (c) => {
    const parsed = upNextOrder.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That order couldn't be read.");
    if (!canUse(c, "capture")) return missingScope(c, ["capture"]);
    const db = c.var.db;
    const queued = await db
      .select({ id: items.id })
      .from(items)
      .where(and(isNotNull(items.upNext), isNull(items.deletedAt)))
      .orderBy(asc(items.upNext), asc(items.id));
    const known = new Set(queued.map((row) => row.id));
    const order = [
      ...new Set(parsed.data.ids.filter((itemId) => known.has(itemId))),
      ...queued.map((row) => row.id).filter((itemId) => !parsed.data.ids.includes(itemId)),
    ];
    if (order.length) {
      const now = new Date();
      await db.batch([
        ...order.map((itemId, index) =>
          db
            .update(items)
            .set({ upNext: index + 1, updatedAt: now })
            .where(eq(items.id, itemId)),
        ),
        recordChange(db, {
          entity: "item",
          id: order[0] as string,
          itemId: order[0] as string,
          action: "updated",
          actor: c.var.actor,
        }),
      ] as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    }
    const list = await loadItems(db, and(isNull(items.deletedAt), isNotNull(items.upNext)));
    return c.json<ItemsResponse>({ items: list.sort((a, b) => (a.upNext ?? 0) - (b.upNext ?? 0)) });
  })

  .get("/:id", async (c) => {
    const item = await loadItem(c.var.db, c.req.param("id"));
    if (!item) return apiError(c, 404, "not_found", notFound);
    return c.json<ItemResponse>({ item });
  })

  .patch("/:id", async (c) => {
    const parsed = updateItem.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That change couldn't be read.");
    const { stage, coverPhotoId, upNext, ...changes } = parsed.data;
    // Title and note are "capture"; moving a build along or picking its final photo is work on its attempts.
    if ((stage !== undefined || coverPhotoId !== undefined) && !canUse(c, "attempts")) {
      return missingScope(c, ["attempts"]);
    }
    if (
      (changes.title !== undefined ||
        changes.note !== undefined ||
        changes.forWhom !== undefined ||
        upNext !== undefined) &&
      !canUse(c, "capture")
    ) {
      return missingScope(c, ["capture"]);
    }
    const itemId = c.req.param("id");
    const db = c.var.db;
    const current = await db
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
      .get();
    if (!current) return apiError(c, 404, "not_found", notFound);
    if (coverPhotoId) {
      // The cover is one of the item's photos that is shown: not removed, and not of a removed attempt.
      const photo = await db
        .select({ id: photos.id })
        .from(photos)
        .leftJoin(attempts, eq(attempts.id, photos.attemptId))
        .where(
          and(
            eq(photos.id, coverPhotoId),
            eq(photos.itemId, itemId),
            isNull(photos.deletedAt),
            or(isNull(photos.attemptId), isNull(attempts.deletedAt)),
          ),
        )
        .get();
      if (!photo) return apiError(c, 400, "invalid", "That photo isn't one of this build's.");
    }
    const now = new Date();
    await db.batch([
      db
        .update(items)
        .set({
          ...changes,
          ...(stage ? stageDates(current, stage, now) : {}),
          // Starting a build takes the idea off the queue (unless this same change puts it back: the undo).
          ...(stage && stage !== "idea" ? { upNext: null } : {}),
          ...(upNext !== undefined && (stage ?? current.stage) === "idea" ? { upNext: upNextValue(upNext) } : {}),
          ...(coverPhotoId !== undefined ? { coverPhotoId } : {}),
          updatedAt: now,
        })
        .where(and(eq(items.id, itemId), isNull(items.deletedAt))),
      recordChange(db, { entity: "item", id: itemId, itemId, action: "updated", actor: c.var.actor }),
    ]);
    const item = await loadItem(db, itemId);
    if (!item) return apiError(c, 404, "not_found", notFound);
    return c.json<ItemResponse>({ item });
  })

  .delete("/:id", async (c) => {
    const itemId = c.req.param("id");
    const [result] = await c.var.db.batch([
      c.var.db
        .update(items)
        .set({ deletedAt: new Date() })
        .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
        .returning({ id: items.id }),
      recordChange(c.var.db, { entity: "item", id: itemId, itemId, action: "deleted", actor: c.var.actor }),
    ]);
    if (!result.length) return apiError(c, 404, "not_found", notFound);
    return c.body(null, 204);
  })

  /**
   * Scrapping a build that began as an idea: it goes back to Ideas (stage idea, not started) and its attempts
   * are deleted with it (soft, like any delete). Anything else is refused: delete it instead.
   */
  .post("/:id/scrap", async (c) => {
    if (!canUse(c, "attempts")) return missingScope(c, ["attempts"]);
    const itemId = c.req.param("id");
    const db = c.var.db;
    const current = await db
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
      .get();
    if (!current) return apiError(c, 404, "not_found", notFound);
    if (
      !beganAsIdea({
        stage: current.stage,
        createdAt: current.createdAt.getTime(),
        startedAt: current.startedAt?.getTime() ?? null,
      })
    ) {
      return apiError(c, 409, "not_an_idea", "That build didn't begin as an idea. Delete it instead.");
    }
    const now = new Date();
    await db.batch([
      db
        .update(attempts)
        .set({ deletedAt: now })
        .where(and(eq(attempts.itemId, itemId), isNull(attempts.deletedAt))),
      db
        .update(items)
        .set({ stage: "idea", startedAt: null, finishedAt: null, coverPhotoId: null, upNext: null, updatedAt: now })
        .where(eq(items.id, itemId)),
      recordChange(db, { entity: "item", id: itemId, itemId, action: "updated", actor: c.var.actor }),
    ]);
    const item = await loadItem(db, itemId);
    if (!item) return apiError(c, 404, "not_found", notFound);
    return c.json<ItemResponse>({ item });
  })

  /** Undo for a scrap: the build comes back as the request describes, with the attempts it listed. */
  .post("/:id/unscrap", async (c) => {
    const parsed = unscrap.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That couldn't be read.");
    if (!canUse(c, "attempts")) return missingScope(c, ["attempts"]);
    const itemId = c.req.param("id");
    const db = c.var.db;
    const { stage, startedAt, finishedAt, coverPhotoId, attemptIds } = parsed.data;
    const now = new Date();
    // One batch, so it is all or nothing: the attempts come back only while the item is a live idea (checked in
    // the statement itself), then the item moves on, then the change is recorded only if that moved it.
    const [, moved] = await db.batch([
      db
        .update(attempts)
        .set({ deletedAt: null })
        .where(
          and(
            eq(attempts.itemId, itemId),
            inArray(attempts.id, attemptIds),
            sql`exists (select 1 from items where id = ${itemId} and deleted_at is null and stage = 'idea')`,
          ),
        ),
      db
        .update(items)
        .set({
          stage,
          startedAt: new Date(startedAt),
          finishedAt: finishedAt === null ? null : new Date(finishedAt),
          coverPhotoId,
          upNext: null,
          updatedAt: now,
        })
        .where(and(eq(items.id, itemId), isNull(items.deletedAt), eq(items.stage, "idea")))
        .returning({ id: items.id }),
      recordChange(db, { entity: "item", id: itemId, itemId, action: "updated", actor: c.var.actor }),
    ]);
    // Nothing was changed if the item wasn't a live idea: it is still deleted or already a build.
    if (!moved.length) return apiError(c, 404, "not_found", goneForGood);
    const item = await loadItem(db, itemId);
    if (!item) return apiError(c, 404, "not_found", goneForGood);
    return c.json<ItemResponse>({ item });
  })

  /** Undo for a delete: the item and its photos come back as they were. */
  .post("/:id/restore", async (c) => {
    const itemId = c.req.param("id");
    const [restored] = await c.var.db.batch([
      c.var.db
        .update(items)
        .set({ deletedAt: null })
        .where(and(eq(items.id, itemId), isNotNull(items.deletedAt)))
        .returning({ id: items.id }),
      recordChange(c.var.db, { entity: "item", id: itemId, itemId, action: "restored", actor: c.var.actor }),
    ]);
    // Restoring something that isn't deleted is harmless and records nothing.
    const item = await loadItem(c.var.db, itemId);
    if (!restored.length && !item) return apiError(c, 404, "not_found", goneForGood);
    if (!item) return apiError(c, 404, "not_found", goneForGood);
    return c.json<ItemResponse>({ item });
  })

  /** Sets the order of an item's photos; the first becomes the cover. */
  .put("/:id/photos/order", async (c) => {
    const parsed = reorder.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That order couldn't be read.");
    const itemId = c.req.param("id");
    const db = c.var.db;
    const item = await loadItem(db, itemId);
    if (!item) return apiError(c, 404, "not_found", notFound);
    const known = new Set(item.photos.map((photo) => photo.id));
    // Photos the client didn't mention (one uploaded meanwhile) keep their place at the end.
    const order = [
      ...parsed.data.photoIds.filter((photoId) => known.has(photoId)),
      ...item.photos.map((photo) => photo.id).filter((photoId) => !parsed.data.photoIds.includes(photoId)),
    ];
    const statements = order.map((photoId, position) =>
      db
        .update(photos)
        .set({ position })
        .where(and(eq(photos.id, photoId), eq(photos.itemId, itemId))),
    );
    await db.batch([
      ...statements,
      db.update(items).set({ updatedAt: new Date() }).where(eq(items.id, itemId)),
      recordChange(db, { entity: "item", id: itemId, itemId, action: "updated", actor: c.var.actor }),
    ] as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    return c.json<ItemResponse>({ item: (await loadItem(db, itemId)) ?? item });
  })

  /**
   * Stores a photo's two variants, resized in the browser, in R2. The client
   * picks the photo's id, so a retried upload replaces the same objects.
   */
  .put("/:id/photos/:photoId", async (c) => {
    const itemId = c.req.param("id");
    const photoId = c.req.param("photoId");
    if (!id.safeParse(photoId).success) return apiError(c, 400, "invalid", "That photo id isn't valid.");
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > 2 * MAX_PHOTO_BYTES) return apiError(c, 413, "too_large", "That photo is too large.");

    const item = await c.var.db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
      .get();
    if (!item) return apiError(c, 404, "not_found", notFound);

    const form = await c.req.formData().catch(() => null);
    const fields = photoFields.safeParse(form ? Object.fromEntries(form) : null);
    const large = form?.get("large");
    const thumb = form?.get("thumb");
    if (!fields.success || !(large instanceof File) || !(thumb instanceof File)) {
      return apiError(c, 400, "invalid", "That photo couldn't be read.");
    }
    const contentType = large.type;
    if (!(PHOTO_CONTENT_TYPES as readonly string[]).includes(contentType) || thumb.type !== contentType) {
      return apiError(c, 415, "unsupported", "Photos are uploaded as WebP or JPEG.");
    }
    if (large.size > MAX_PHOTO_BYTES || thumb.size > MAX_PHOTO_BYTES) {
      return apiError(c, 413, "too_large", "That photo is too large.");
    }

    const attemptId = fields.data.attemptId ?? null;
    // A photo of an attempt comes with the attempts scope; any other needs capture.
    if (!canUse(c, attemptId ? "attempts" : "capture")) return missingScope(c, [attemptId ? "attempts" : "capture"]);
    if (attemptId) {
      const attempt = await c.var.db
        .select({ id: attempts.id })
        .from(attempts)
        .where(and(eq(attempts.id, attemptId), eq(attempts.itemId, itemId), isNull(attempts.deletedAt)))
        .get();
      // 404 tells the outbox to drop the photo: its attempt was deleted or never existed.
      if (!attempt) return apiError(c, 404, "not_found", "That attempt isn't here any more.");
    }

    const existing = await c.var.db.select().from(photos).where(eq(photos.id, photoId)).get();
    if (existing && existing.itemId !== itemId) {
      return apiError(c, 409, "conflict", "That photo belongs to something else.");
    }

    const actor = c.var.actor;
    const unresized = fields.data.needsResize;
    // A retry of an upload that couldn't resize, after a browser already did: what the browser made stays.
    if (existing && unresized && !existing.needsResize) return c.json<PhotoResponse>({ photo: toApiPhoto(existing) });
    // Originals are marked in R2 so they are served without the "never changes" cache lifetime: they will be replaced.
    const httpMetadata = { contentType };
    const customMetadata = unresized ? { provisional: "1" } : undefined;
    await Promise.all([
      c.env.PHOTOS.put(photoKey(photoId, "large"), large.stream(), { httpMetadata, customMetadata }),
      c.env.PHOTOS.put(photoKey(photoId, "thumb"), thumb.stream(), { httpMetadata, customMetadata }),
    ]);

    if (existing?.needsResize && !unresized) {
      // The browser's resized variants replace the original: its size, color and type are now the real ones.
      // A second browser racing this one writes the same thing again and finds nothing left to flag.
      const [replaced] = await c.var.db.batch([
        c.var.db
          .update(photos)
          .set({
            width: fields.data.width,
            height: fields.data.height,
            color: fields.data.color,
            contentType,
            needsResize: false,
            resizeClaimedAt: null,
          })
          .where(and(eq(photos.id, photoId), eq(photos.needsResize, true)))
          .returning(),
        recordChange(c.var.db, { entity: "photo", id: photoId, itemId, action: "updated", actor }),
        c.var.db
          .update(items)
          .set({ updatedAt: new Date() })
          .where(and(eq(items.id, itemId), afterChange)),
      ]);
      const row = replaced[0] ?? (await c.var.db.select().from(photos).where(eq(photos.id, photoId)).get()) ?? existing;
      return c.json<PhotoResponse>({ photo: toApiPhoto(row) });
    }

    if (existing) {
      // An upload means the client wants the photo shown: one deleted meanwhile
      // (removed, then brought back with undo while its upload was in flight) returns.
      if (existing.deletedAt) {
        await c.var.db.batch([
          c.var.db
            .update(photos)
            .set({ deletedAt: null })
            .where(and(eq(photos.id, photoId), isNotNull(photos.deletedAt))),
          recordChange(c.var.db, { entity: "photo", id: photoId, itemId, action: "restored", actor }),
          c.var.db
            .update(items)
            .set({ updatedAt: new Date() })
            .where(and(eq(items.id, itemId), afterChange)),
        ]);
      }
      return c.json<PhotoResponse>({ photo: toApiPhoto(existing) });
    }

    const { width, height, color, takenAt } = fields.data;
    let position = fields.data.position;
    if (position === undefined) {
      const last = await c.var.db
        .select({ value: max(photos.position) })
        .from(photos)
        .where(eq(photos.itemId, itemId))
        .get();
      position = (last?.value ?? -1) + 1;
    }
    const now = new Date();
    const [[row]] = await c.var.db.batch([
      c.var.db
        .insert(photos)
        .values({
          id: photoId,
          itemId,
          position,
          width,
          height,
          color,
          contentType,
          takenAt: takenAt ? new Date(takenAt) : null,
          needsResize: unresized,
          attemptId,
          createdBy: c.var.user.id,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning(),
      recordChange(c.var.db, { entity: "photo", id: photoId, itemId, action: "created", actor }),
      c.var.db
        .update(items)
        .set({ updatedAt: now })
        .where(and(eq(items.id, itemId), afterChange)),
    ]);
    const photo = row ?? (await c.var.db.select().from(photos).where(eq(photos.id, photoId)).get());
    if (!photo) return apiError(c, 500, "server_error", "The photo wasn't saved.");
    return c.json<PhotoResponse>({ photo: toApiPhoto(photo) }, 201);
  });
