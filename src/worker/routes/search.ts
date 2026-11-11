import { and, asc, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type {
  AttemptHit,
  FacetsResponse,
  ItemHit,
  Recipe,
  SearchResponse,
  WhatWorkedResponse,
} from "../../shared/api.ts";
import { byPrintTime, OUTCOMES, type Outcome, type TagKind } from "../../shared/attempts.ts";
import { OUTCOME_FILTERS, outcomesFor } from "../../shared/journal.ts";
import { attemptPartsLabel } from "../../shared/parts.ts";
import { recipeMatchesTerms, recipesFor } from "../../shared/recipes.ts";
import { ftsQuery, SNIPPET_CLOSE, SNIPPET_OPEN, searchTerms } from "../../shared/search.ts";
import type { Db } from "../db/index.ts";
import { type Attempt, attempts, items, type Photo, parts, photos, tags } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError, toApiPhoto } from "../http.ts";
import { liveRecipes } from "./recipes.ts";

/** A filament type as people type it: "petg " → "PETG". */
export const material = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((value) => value.toUpperCase());

/** Filters shared by the journal and search. */
export const filters = z.object({
  outcome: z.enum(OUTCOME_FILTERS).optional(),
  material: material.optional(),
  person: z.string().max(64).optional(),
});

const searchQuery = filters.extend({
  q: z.string().max(200).optional(),
  tag: z
    .string()
    .max(48)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .optional(),
});

/** SQL and its parameters, built up piece by piece. */
export interface Clause {
  sql: string;
  params: unknown[];
}

/**
 * Conditions on an attempt (alias `a`) and its item (`i`): outcome, material,
 * failure tag or success note, person. Every clause starts with " AND".
 */
export function attemptFilters(f: {
  outcome?: z.infer<typeof filters>["outcome"];
  material?: string;
  person?: string;
  tag?: string;
}): Clause {
  let sql = "";
  const params: unknown[] = [];
  if (f.outcome) {
    const outcomes = outcomesFor(f.outcome);
    sql += ` AND a.outcome IN (${outcomes.map(() => "?").join(", ")})`;
    params.push(...outcomes);
  }
  if (f.material) {
    sql +=
      " AND EXISTS (SELECT 1 FROM json_each(a.settings, '$.filaments') AS f WHERE upper(trim(json_extract(f.value, '$.type'))) = ?)";
    params.push(f.material);
  }
  if (f.tag) {
    sql +=
      " AND (EXISTS (SELECT 1 FROM json_each(a.failure_tags) WHERE value = ?) OR EXISTS (SELECT 1 FROM json_each(a.success_notes) WHERE value = ?))";
    params.push(f.tag, f.tag);
  }
  if (f.person) {
    sql += " AND a.created_by = ?";
    params.push(f.person);
  }
  return { sql, params };
}

async function all<T>(env: Env, clause: Clause): Promise<T[]> {
  return (
    await env.DB.prepare(clause.sql)
      .bind(...clause.params)
      .all<T>()
  ).results;
}

/** Photos of these items that are shown: not removed, and not of a removed attempt. */
async function livePhotos(db: Db, itemIds: string[], liveAttemptIds: Set<string>): Promise<Photo[]> {
  if (!itemIds.length) return [];
  const rows = await db
    .select()
    .from(photos)
    .where(and(inArray(photos.itemId, itemIds), isNull(photos.deletedAt)))
    .orderBy(asc(photos.position), asc(photos.createdAt));
  return rows.filter((photo) => photo.attemptId === null || liveAttemptIds.has(photo.attemptId));
}

/** The live attempts of these items. */
function liveAttempts(db: Db, itemIds: string[]): Promise<Attempt[]> {
  if (!itemIds.length) return Promise.resolve([]);
  return db
    .select()
    .from(attempts)
    .where(and(inArray(attempts.itemId, itemIds), isNull(attempts.deletedAt)));
}

/** What a build or idea leads with: its chosen cover, its own first photo, else its newest attempt photo. */
function itemPhoto(itemPhotos: Photo[], coverPhotoId: string | null): Photo | null {
  return (
    itemPhotos.find((photo) => photo.id === coverPhotoId) ??
    itemPhotos.find((photo) => !photo.attemptId) ??
    itemPhotos.reduce<Photo | null>((best, photo) => (!best || photo.createdAt > best.createdAt ? photo : best), null)
  );
}

const unique = <T>(list: T[]) => [...new Set(list)];

/** Attempts (by id, in this order) with their number, their build and a photo. */
export async function attemptHits(db: Db, ids: string[]): Promise<AttemptHit[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(attempts).where(inArray(attempts.id, ids));
  const itemIds = unique(rows.map((row) => row.itemId));
  const [itemRows, siblings, partRows] = await Promise.all([
    db.select().from(items).where(inArray(items.id, itemIds)),
    liveAttempts(db, itemIds),
    db.select().from(parts).where(inArray(parts.itemId, itemIds)),
  ]);
  const itemPhotos = await livePhotos(db, itemIds, new Set(siblings.map((row) => row.id)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const attempt = byId.get(id);
    const item = itemRows.find((row) => row.id === attempt?.itemId);
    if (!attempt || !item) return [];
    const ordered = byPrintTime(
      siblings
        .filter((row) => row.itemId === item.id)
        .map((row) => ({ id: row.id, printedAt: row.printedAt.getTime(), createdAt: row.createdAt.getTime() })),
    );
    const ownPhotos = itemPhotos.filter((photo) => photo.itemId === item.id);
    const photo = ownPhotos.find((p) => p.attemptId === attempt.id) ?? itemPhoto(ownPhotos, item.coverPhotoId) ?? null;
    return [
      {
        attempt: {
          id: attempt.id,
          itemId: attempt.itemId,
          outcome: attempt.outcome,
          printedAt: attempt.printedAt.getTime(),
          finishedAt: attempt.finishedAt?.getTime() ?? null,
          endedAt: attempt.endedAt?.getTime() ?? null,
          suggestedFailureTag: attempt.suggestedFailureTag,
          note: attempt.note,
          failureTags: attempt.failureTags,
          successNotes: attempt.successNotes,
          settings: attempt.settings,
          parts: attempt.parts,
          createdBy: attempt.createdBy,
          createdVia: attempt.createdVia,
          finishedBy: attempt.finishedBy,
          finishedVia: attempt.finishedVia,
          createdAt: attempt.createdAt.getTime(),
          updatedAt: attempt.updatedAt.getTime(),
        },
        number: ordered.findIndex((row) => row.id === attempt.id) + 1,
        item: { id: item.id, title: item.title, stage: item.stage },
        partsLabel: attemptPartsLabel(
          attempt,
          partRows.filter((part) => part.itemId === item.id),
        ),
        photo: photo ? toApiPhoto(photo) : null,
      },
    ];
  });
}

/** Items (by id, in this order) with their photo and how their last attempt went. */
async function itemHits(db: Db, found: Array<Pick<ItemHit, "snippet" | "comment"> & { id: string }>): Promise<ItemHit[]> {
  if (!found.length) return [];
  const ids = found.map((row) => row.id);
  const [rows, itemAttempts] = await Promise.all([
    db.select().from(items).where(inArray(items.id, ids)),
    liveAttempts(db, ids),
  ]);
  const itemPhotos = await livePhotos(db, ids, new Set(itemAttempts.map((row) => row.id)));
  return found.flatMap(({ id, snippet, comment }) => {
    const item = rows.find((row) => row.id === id);
    if (!item) return [];
    const own = itemAttempts.filter((row) => row.itemId === id);
    const last = byPrintTime(
      own.map((row) => ({ row, id: row.id, printedAt: row.printedAt.getTime(), createdAt: row.createdAt.getTime() })),
    ).at(-1);
    const photo = itemPhoto(
      itemPhotos.filter((p) => p.itemId === id),
      item.coverPhotoId,
    );
    return [
      {
        item: {
          id: item.id,
          stage: item.stage,
          title: item.title,
          note: item.note,
          createdBy: item.createdBy,
          createdAt: item.createdAt.getTime(),
          startedAt: item.startedAt?.getTime() ?? null,
          finishedAt: item.finishedAt?.getTime() ?? null,
        },
        attempts: own.length,
        lastOutcome: (last?.row.outcome ?? null) as Outcome | null,
        snippet,
        comment,
        photo: photo ? toApiPhoto(photo) : null,
      },
    ];
  });
}

/**
 * bm25 weights per column (kind, ref_id, item_id, title, body, tags,
 * materials, settings): a title or a tag says more than a word in a note.
 */
const RANK = "bm25(search, 0, 0, 0, 8.0, 3.0, 5.0, 5.0, 2.0)";
const LIMIT = { items: 12, attempts: 30 };

/**
 * Search, filter chips and "what worked last time". Search runs on the FTS5
 * index (migrations/0003_search.sql), which triggers keep up to date.
 */
export const searchRoutes = new Hono<AppEnv>()
  .get("/search", async (c) => {
    const parsed = searchQuery.safeParse(c.req.query());
    if (!parsed.success) return apiError(c, 400, "invalid", "That search couldn't be read.");
    const { q = "", ...f } = parsed.data;
    const db = c.var.db;
    const terms = searchTerms(q);
    const narrowsAttempts = !!(f.outcome || f.material || f.tag);
    const empty: SearchResponse = { builds: [], ideas: [], attempts: [], recipes: [] };
    // Recipes are found by words, or by a material alone; an outcome or tag describes attempts only.
    const recipeFilters = !f.outcome && !f.tag;
    const findRecipes = async (): Promise<Recipe[]> => {
      if (!recipeFilters) return [];
      let list = await liveRecipes(db);
      if (f.material) list = recipesFor(list, { material: f.material });
      if (f.person) list = list.filter((recipe) => recipe.createdBy === f.person);
      return terms.length ? list.filter((recipe) => recipeMatchesTerms(recipe, terms)) : list;
    };
    if (!terms.length && !narrowsAttempts && !f.person) return c.json<SearchResponse>(empty);

    const filter = attemptFilters(f);
    if (!terms.length) {
      // Filters alone: the newest attempts that pass them.
      const rows = await all<{ id: string }>(c.env, {
        sql: `SELECT a.id FROM attempts AS a JOIN items AS i ON i.id = a.item_id
          WHERE a.deleted_at IS NULL AND i.deleted_at IS NULL${filter.sql}
          ORDER BY a.printed_at DESC LIMIT ${LIMIT.attempts}`,
        params: filter.params,
      });
      return c.json<SearchResponse>({
        ...empty,
        attempts: await attemptHits(
          db,
          rows.map((row) => row.id),
        ),
        recipes: f.material ? await findRecipes() : [],
      });
    }

    const custom = await db.select({ kind: tags.kind, slug: tags.slug, label: tags.label }).from(tags);
    const match = ftsQuery(terms, custom);
    const [attemptRows, itemRows, commentRows] = await Promise.all([
      all<{ id: string }>(c.env, {
        sql: `SELECT a.id FROM search
          JOIN attempts AS a ON a.id = search.ref_id
          JOIN items AS i ON i.id = a.item_id
          WHERE search MATCH ? AND search.kind = 'attempt' AND a.deleted_at IS NULL AND i.deleted_at IS NULL${filter.sql}
          ORDER BY ${RANK}, a.printed_at DESC LIMIT ${LIMIT.attempts}`,
        params: [match, ...filter.params],
      }),
      // Outcome, material and tag describe attempts: with one of them on, only attempts are found.
      narrowsAttempts
        ? Promise.resolve([])
        : all<{ id: string; snippet: string | null }>(c.env, {
            sql: `SELECT i.id, snippet(search, 4, ?, ?, '…', 16) AS snippet FROM search
              JOIN items AS i ON i.id = search.ref_id
              WHERE search MATCH ? AND search.kind = 'item' AND i.deleted_at IS NULL${f.person ? " AND i.created_by = ?" : ""}
              ORDER BY ${RANK}, i.created_at DESC LIMIT ${LIMIT.items * 2}`,
            params: [SNIPPET_OPEN, SNIPPET_CLOSE, match, ...(f.person ? [f.person] : [])],
          }),
      // What the two of you said in a thread (migrations/0022_comment-search.sql): found as the item it belongs to.
      narrowsAttempts
        ? Promise.resolve([])
        : all<{ id: string; item_id: string; author_id: string; via: string | null; created_at: number; snippet: string }>(
            c.env,
            {
              sql: `SELECT c.id, c.item_id, c.author_id, c.via, c.created_at, snippet(search, 4, ?, ?, '…', 16) AS snippet FROM search
              JOIN comments AS c ON c.id = search.ref_id
              JOIN items AS i ON i.id = c.item_id
              WHERE search MATCH ? AND search.kind = 'comment' AND c.deleted_at IS NULL AND i.deleted_at IS NULL${f.person ? " AND i.created_by = ?" : ""}
              ORDER BY ${RANK}, c.created_at DESC LIMIT ${LIMIT.items * 2}`,
              params: [SNIPPET_OPEN, SNIPPET_CLOSE, match, ...(f.person ? [f.person] : [])],
            },
          ),
    ]);
    // An item that matched on its own words keeps its note's snippet; one found only by a comment shows the best comment.
    const found: Array<Pick<ItemHit, "snippet" | "comment"> & { id: string }> = itemRows.map((row) => ({
      id: row.id,
      snippet: row.snippet || null,
      comment: null,
    }));
    const seen = new Set(found.map((row) => row.id));
    for (const row of commentRows) {
      if (seen.has(row.item_id)) continue;
      seen.add(row.item_id);
      found.push({
        id: row.item_id,
        snippet: row.snippet || null,
        comment: { id: row.id, authorId: row.author_id, via: row.via, createdAt: row.created_at },
      });
    }
    const [attemptList, itemList, recipeList] = await Promise.all([
      attemptHits(
        db,
        attemptRows.map((row) => row.id),
      ),
      itemHits(db, found),
      findRecipes(),
    ]);
    return c.json<SearchResponse>({
      builds: itemList.filter((hit) => hit.item.stage !== "idea").slice(0, LIMIT.items),
      ideas: itemList.filter((hit) => hit.item.stage === "idea").slice(0, LIMIT.items),
      attempts: attemptList,
      recipes: recipeList,
    });
  })

  /** Materials and tags in use, most used first: the journal's and search's chips. */
  .get("/facets", async (c) => {
    const live = "a.deleted_at IS NULL AND i.deleted_at IS NULL";
    const [materials, tagRows] = await Promise.all([
      all<{ material: string; count: number }>(c.env, {
        // Named "material", not "value": GROUP BY would read json_each's own value column.
        sql: `SELECT upper(trim(json_extract(f.value, '$.type'))) AS material, count(DISTINCT a.id) AS count
          FROM attempts AS a JOIN items AS i ON i.id = a.item_id, json_each(a.settings, '$.filaments') AS f
          WHERE ${live} AND trim(coalesce(json_extract(f.value, '$.type'), '')) != ''
          GROUP BY material ORDER BY count DESC, material LIMIT 12`,
        params: [],
      }),
      all<{ kind: TagKind; slug: string; count: number }>(c.env, {
        sql: `SELECT kind, slug, count(*) AS count FROM (
            SELECT 'failure' AS kind, t.value AS slug FROM attempts AS a JOIN items AS i ON i.id = a.item_id, json_each(a.failure_tags) AS t WHERE ${live}
            UNION ALL
            SELECT 'success' AS kind, t.value AS slug FROM attempts AS a JOIN items AS i ON i.id = a.item_id, json_each(a.success_notes) AS t WHERE ${live}
          ) GROUP BY kind, slug ORDER BY count DESC, slug LIMIT 24`,
        params: [],
      }),
    ]);
    return c.json<FacetsResponse>({
      materials: materials.map((row) => ({ value: row.material, count: row.count })),
      tags: tagRows,
    });
  })

  /**
   * The latest attempts that worked with this material, the build's own
   * first: what to start from. Without a material, only the build's own.
   */
  .get("/what-worked", async (c) => {
    const parsed = z.object({ item: z.uuid(), material: material.optional() }).safeParse(c.req.query());
    if (!parsed.success) return apiError(c, 400, "invalid", "That question couldn't be read.");
    const { item, material: type } = parsed.data;
    const rows = await all<{ id: string; same: number }>(c.env, {
      sql: `SELECT a.id, a.item_id = ? AS same FROM attempts AS a JOIN items AS i ON i.id = a.item_id
        WHERE a.deleted_at IS NULL AND i.deleted_at IS NULL AND a.outcome = '${OUTCOMES[0]}'
        ${type ? "" : "AND a.item_id = ?"}${attemptFilters({ material: type }).sql}
        ORDER BY same DESC, a.printed_at DESC LIMIT 3`,
      params: [item, ...(type ? [] : [item]), ...attemptFilters({ material: type }).params],
    });
    const hits = await attemptHits(
      c.var.db,
      rows.map((row) => row.id),
    );
    return c.json<WhatWorkedResponse>({
      matches: hits.map((hit) => ({ ...hit, sameBuild: hit.item.id === item })),
      recipes: type ? recipesFor(await liveRecipes(c.var.db), { material: type }).slice(0, 3) : [],
    });
  });
