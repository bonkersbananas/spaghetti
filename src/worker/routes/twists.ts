import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Photo, Twist, TwistResponse, TwistsResponse } from "../../shared/api.ts";
import { checkLinkUrl } from "../../shared/link-safety.ts";
import { modelMarkOf, modelOf, modelPlace } from "../../shared/model-mark.ts";
import {
  CHANGE_KINDS,
  TWIST_CHANGE_NOTE_MAX,
  TWIST_CHANGES_MAX,
  TWIST_NAME_MAX,
  TWIST_NOTE_MAX,
  TWIST_VALUE_MAX,
} from "../../shared/twists.ts";
import { recordChange } from "../changes.ts";
import type { Db } from "../db/index.ts";
import { itemDrafts, items, photos, recipes, type TwistRow, twistFiles, twists } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError, toApiFile, toApiPhoto } from "../http.ts";

const short = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null);
const name = z.string().trim().min(1).max(TWIST_NAME_MAX);
const note = z.string().trim().max(TWIST_NOTE_MAX);
const link = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => value || null)
  .refine((value) => value === null || checkLinkUrl(value) !== null, "Not a link we can keep.");

const change = z.object({
  id: z.uuid(),
  kind: z.enum(CHANGE_KINDS),
  label: z.string().trim().max(TWIST_VALUE_MAX).default(""),
  value: z.string().trim().max(TWIST_VALUE_MAX).default(""),
  note: z.string().trim().max(TWIST_CHANGE_NOTE_MAX).default(""),
});
const changes = z.array(change).max(TWIST_CHANGES_MAX);

const createTwist = z.object({
  id: z.uuid(),
  name,
  note: note.optional(),
  /** The idea it comes from: its model link, title and cover fill in what isn't given. */
  fromItemId: z.uuid().optional(),
  sourceUrl: link.optional(),
  sourceTitle: short(200).optional(),
  designer: short(120).optional(),
  license: short(120).optional(),
  sourcePhotoId: z.uuid().optional(),
  recipeId: z.uuid().optional(),
  changes: changes.optional(),
});
const updateTwist = z.object({
  name: name.optional(),
  note: note.optional(),
  sourceUrl: link.optional(),
  sourceTitle: short(200).optional(),
  designer: short(120).optional(),
  license: short(120).optional(),
  recipeId: z.uuid().nullable().optional(),
  /** Replaces the whole list: the client holds it and sends the next version. */
  changes: changes.optional(),
});

const notFound = "That twist isn't here any more.";

/** Twists as the API shows them: each with its picture while the idea it came from still has it. */
export async function toApiTwists(db: Db, rows: TwistRow[]): Promise<Twist[]> {
  const pictures = new Map<string, Photo>();
  for (const row of rows) {
    if (!row.sourcePhotoId || pictures.has(row.sourcePhotoId)) continue;
    const photo = await db
      .select()
      .from(photos)
      .where(and(eq(photos.id, row.sourcePhotoId), isNull(photos.deletedAt)))
      .get();
    if (photo) pictures.set(photo.id, toApiPhoto(photo));
  }
  const liveItems = new Set(
    (await db.select({ id: items.id }).from(items).where(isNull(items.deletedAt)))
      .map((row) => row.id)
      .filter((id) => rows.some((row) => row.fromItemId === id)),
  );
  // Each twist's live model (one at a time; the newest if a retry left two).
  const models = new Map<string, Twist["model"]>();
  if (rows.length) {
    const files = await db
      .select()
      .from(twistFiles)
      .where(
        and(
          inArray(
            twistFiles.twistId,
            rows.map((row) => row.id),
          ),
          isNull(twistFiles.deletedAt),
        ),
      )
      .orderBy(asc(twistFiles.createdAt));
    for (const file of files) models.set(file.twistId, toApiFile(file));
  }
  return rows.map((row) => {
    const mark = row.sourceUrl ? modelMarkOf(row.sourceUrl) : null;
    return {
      id: row.id,
      name: row.name,
      note: row.note,
      source: {
        url: row.sourceUrl,
        title: row.sourceTitle,
        designer: row.designer,
        license: row.license,
        place: mark ? modelPlace(mark) : null,
        photo: row.sourcePhotoId ? (pictures.get(row.sourcePhotoId) ?? null) : null,
      },
      changes: row.changes,
      fromItemId: row.fromItemId && liveItems.has(row.fromItemId) ? row.fromItemId : null,
      recipeId: row.recipeId,
      model: models.get(row.id) ?? null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  });
}

/** All twists that aren't deleted, newest first. */
export async function liveTwists(db: Db): Promise<Twist[]> {
  return toApiTwists(
    db,
    await db.select().from(twists).where(isNull(twists.deletedAt)).orderBy(desc(twists.createdAt)),
  );
}

async function loadTwist(db: Db, id: string): Promise<Twist | null> {
  const row = await db
    .select()
    .from(twists)
    .where(and(eq(twists.id, id), isNull(twists.deletedAt)))
    .get();
  return row ? ((await toApiTwists(db, [row]))[0] ?? null) : null;
}

/** Only a recipe that exists may be pointed at (a deleted one is fine: the link goes quiet, like a recipe's own). */
async function recipeExists(db: Db, id: string) {
  return Boolean(await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, id)).get());
}

/** /api/twists: models we print our own way. */
export const twistRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json<TwistsResponse>({ twists: await liveTwists(c.var.db) }))

  .get("/:id", async (c) => {
    const twist = await loadTwist(c.var.db, c.req.param("id"));
    if (!twist) return apiError(c, 404, "not_found", notFound);
    return c.json<TwistResponse>({ twist });
  })

  /** Makes a twist, usually from an idea: its model link, title and cover come along unless the request names its own. */
  .post("/", async (c) => {
    const parsed = createTwist.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That twist couldn't be read.");
    const body = parsed.data;
    const db = c.var.db;

    const existing = await db.select().from(twists).where(eq(twists.id, body.id)).get();
    if (existing) {
      if (existing.deletedAt) return apiError(c, 409, "deleted", "That twist was deleted.");
      return c.json<TwistResponse>({ twist: (await toApiTwists(db, [existing]))[0] as Twist }, 201);
    }

    let sourceUrl = body.sourceUrl ?? null;
    let sourceTitle = body.sourceTitle ?? null;
    let sourcePhotoId = body.sourcePhotoId ?? null;
    if (body.fromItemId) {
      const item = await db
        .select()
        .from(items)
        .where(and(eq(items.id, body.fromItemId), isNull(items.deletedAt)))
        .get();
      if (!item) return apiError(c, 404, "not_found", "That idea isn't here any more.");
      const draft = await db
        .select({ url: itemDrafts.url })
        .from(itemDrafts)
        .where(eq(itemDrafts.itemId, item.id))
        .get();
      sourceUrl ??= modelOf({ note: item.note, draft })?.url ?? null;
      sourceTitle ??= item.title?.trim() || null;
      if (!sourcePhotoId) {
        const cover = item.coverPhotoId
          ? await db
              .select({ id: photos.id })
              .from(photos)
              .where(and(eq(photos.id, item.coverPhotoId), isNull(photos.deletedAt)))
              .get()
          : null;
        const first =
          cover ??
          (await db
            .select({ id: photos.id })
            .from(photos)
            .where(and(eq(photos.itemId, item.id), isNull(photos.deletedAt), isNull(photos.attemptId)))
            .orderBy(photos.position)
            .get());
        sourcePhotoId = first?.id ?? null;
      }
    }
    if (body.recipeId && !(await recipeExists(db, body.recipeId))) {
      return apiError(c, 404, "not_found", "That recipe isn't here any more.");
    }

    const now = new Date();
    await db.batch([
      db
        .insert(twists)
        .values({
          id: body.id,
          name: body.name,
          note: body.note ?? "",
          sourceUrl,
          sourceTitle,
          designer: body.designer ?? null,
          license: body.license ?? null,
          sourcePhotoId,
          fromItemId: body.fromItemId ?? null,
          recipeId: body.recipeId ?? null,
          changes: body.changes ?? [],
          createdBy: c.var.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing(),
      recordChange(db, { entity: "twist", id: body.id, action: "created", actor: c.var.actor }),
    ]);
    const twist = await loadTwist(db, body.id);
    if (!twist) return apiError(c, 409, "deleted", "That twist was deleted.");
    return c.json<TwistResponse>({ twist }, 201);
  })

  .patch("/:id", async (c) => {
    const parsed = updateTwist.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That twist couldn't be read.");
    const body = parsed.data;
    const twistId = c.req.param("id");
    if (body.recipeId && !(await recipeExists(c.var.db, body.recipeId))) {
      return apiError(c, 404, "not_found", "That recipe isn't here any more.");
    }
    const { sourceUrl, sourceTitle, ...rest } = body;
    const [[row]] = await c.var.db.batch([
      c.var.db
        .update(twists)
        .set({
          ...rest,
          ...(sourceUrl !== undefined && { sourceUrl }),
          ...(sourceTitle !== undefined && { sourceTitle }),
          updatedAt: new Date(),
        })
        .where(and(eq(twists.id, twistId), isNull(twists.deletedAt)))
        .returning({ id: twists.id }),
      recordChange(c.var.db, { entity: "twist", id: twistId, action: "updated", actor: c.var.actor }),
    ]);
    if (!row) return apiError(c, 404, "not_found", notFound);
    const twist = await loadTwist(c.var.db, twistId);
    if (!twist) return apiError(c, 404, "not_found", notFound);
    return c.json<TwistResponse>({ twist });
  })

  .delete("/:id", async (c) => {
    const twistId = c.req.param("id");
    const [[row]] = await c.var.db.batch([
      c.var.db
        .update(twists)
        .set({ deletedAt: new Date() })
        .where(and(eq(twists.id, twistId), isNull(twists.deletedAt)))
        .returning({ id: twists.id }),
      recordChange(c.var.db, { entity: "twist", id: twistId, action: "deleted", actor: c.var.actor }),
    ]);
    if (!row) return apiError(c, 404, "not_found", notFound);
    return c.body(null, 204);
  })

  .post("/:id/restore", async (c) => {
    const twistId = c.req.param("id");
    await c.var.db.batch([
      c.var.db
        .update(twists)
        .set({ deletedAt: null })
        .where(and(eq(twists.id, twistId), isNotNull(twists.deletedAt))),
      recordChange(c.var.db, { entity: "twist", id: twistId, action: "restored", actor: c.var.actor }),
    ]);
    const twist = await loadTwist(c.var.db, twistId);
    if (!twist) return apiError(c, 404, "not_found", "That twist is gone for good.");
    return c.json<TwistResponse>({ twist });
  });

/** For the OpenAPI document (worker/openapi). */
export { createTwist, updateTwist };
