import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type {
  AttemptHit,
  FacetsResponse,
  FixHit,
  ItemHit,
  Recipe,
  SearchResponse,
  Spool,
  Twist,
  WhatWorkedResponse,
} from "../../shared/api.ts";
import {
  type AttemptSettings,
  BUILT_IN_TAGS,
  byPrintTime,
  describeChanges,
  OUTCOMES,
  type Outcome,
  type TagKind,
  tagLabel,
} from "../../shared/attempts.ts";
import { bestPhoto } from "../../shared/cover.ts";
import { findFixes, isFailure } from "../../shared/fixes.ts";
import { OUTCOME_FILTERS, outcomesFor } from "../../shared/journal.ts";
import { attemptPartsLabel } from "../../shared/parts.ts";
import { recipesFor } from "../../shared/recipes.ts";
import {
  ftsQuery,
  matchesTerm,
  type SearchTerm,
  SNIPPET_CLOSE,
  SNIPPET_OPEN,
  searchTerms,
  words,
} from "../../shared/search.ts";
import {
  correctTerms,
  type Intent,
  markTerms,
  parseQuery,
  splitNames,
  textMatchesTerms,
  type When,
} from "../../shared/search-intent.ts";
import type { Db } from "../db/index.ts";
import {
  type Attempt,
  amsSlots,
  attempts,
  coachRuns,
  items,
  type Photo,
  parts,
  photos,
  spools,
  tags,
  users,
} from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError, toApiPhoto } from "../http.ts";
import { gramsFor } from "../ledger.ts";
import { liveRecipes } from "./recipes.ts";
import { toApiSpool } from "./spools.ts";
import { liveTwists } from "./twists.ts";

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

const whatWorkedQuery = z.object({ item: z.uuid(), material: material.optional() });
const searchQuery = filters.extend({
  q: z.string().max(200).optional(),
  /** "1": when nothing has every word, answer with what has the most of them (the app asks; agents get the strict answer). */
  closest: z.literal("1").optional(),
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

/** What a build or idea leads with: the one cover rule (shared/cover.ts bestPhoto), its attempts in print order. */
function itemPhoto(itemPhotos: Photo[], itemAttempts: Attempt[], coverPhotoId: string | null): Photo | null {
  const ordered = byPrintTime(
    itemAttempts.map((row) => ({ ...row, printedAt: row.printedAt.getTime(), createdAt: row.createdAt.getTime() })),
  );
  const timed = itemPhotos.map((photo) => ({
    photo,
    id: photo.id,
    attemptId: photo.attemptId,
    createdAt: +photo.createdAt,
  }));
  return bestPhoto(timed, ordered, coverPhotoId)?.photo ?? null;
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
    const photo =
      ownPhotos.find((p) => p.attemptId === attempt.id) ??
      itemPhoto(
        ownPhotos,
        siblings.filter((row) => row.itemId === item.id),
        item.coverPhotoId,
      );
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
async function itemHits(
  db: Db,
  found: Array<Pick<ItemHit, "snippet" | "comment"> & { id: string }>,
): Promise<ItemHit[]> {
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
      own,
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

const hasHits = (r: SearchResponse) =>
  r.builds.length + r.ideas.length + r.attempts.length + r.recipes.length + r.twists.length + r.spools.length > 0;

/**
 * One search per word, merged: a hit that came up for more of the words comes first, then the word with the fewest
 * hits (the more telling one), then each search's own order.
 */
function mergeClosest(each: SearchResponse[]): SearchResponse {
  const ordered = [...each].sort(
    (a, b) =>
      b.builds.length + b.ideas.length + b.attempts.length - (a.builds.length + a.ideas.length + a.attempts.length),
  );
  ordered.reverse();
  const merge = <T>(pick: (r: SearchResponse) => T[], id: (hit: T) => string, limit: number) => {
    const seen = new Map<string, { hit: T; words: number }>();
    for (const r of ordered)
      for (const hit of pick(r)) {
        const known = seen.get(id(hit));
        if (known) known.words += 1;
        else seen.set(id(hit), { hit, words: 1 });
      }
    return [...seen.values()]
      .sort((a, b) => b.words - a.words) // stable: ties keep the order above
      .slice(0, limit)
      .map((entry) => entry.hit);
  };
  return {
    builds: merge(
      (r) => r.builds,
      (h) => h.item.id,
      LIMIT.items,
    ),
    ideas: merge(
      (r) => r.ideas,
      (h) => h.item.id,
      LIMIT.items,
    ),
    attempts: merge(
      (r) => r.attempts,
      (h) => h.attempt.id,
      LIMIT.attempts,
    ),
    recipes: merge(
      (r) => r.recipes,
      (h) => h.id,
      LIMIT.items,
    ),
    twists: merge(
      (r) => r.twists,
      (h) => h.id,
      LIMIT.items,
    ),
    spools: merge(
      (r) => r.spools,
      (h) => h.id,
      LIMIT.items,
    ),
  };
}

interface SearchInput {
  terms: SearchTerm[];
  intent: Intent | null;
  when: When | null;
  outcome?: z.infer<typeof filters>["outcome"];
  material?: string;
  person?: string;
  tag?: string;
}

/** Whether the typed words name a spool on the shelf: every one starts a word of its material, brand, colour, finish or note. */
function spoolMatches(spool: Spool, terms: readonly SearchTerm[]) {
  if (!terms.length) return false;
  const haystack = words(
    [spool.material, spool.brand, spool.colorName, spool.finish, spool.note, spool.slot ? "loaded ams" : ""].join(" "),
  );
  return textMatchesTerms(haystack.join(" "), terms);
}

/** The words the notebook knows, most used first: what a mistyped word is corrected to. */
async function vocabulary(db: Db, custom: Array<{ label: string }>): Promise<string[]> {
  const [itemRows, spoolRows] = await Promise.all([
    db.select({ title: items.title, note: items.note }).from(items).where(isNull(items.deletedAt)).limit(2000),
    db
      .select({ material: spools.material, brand: spools.brand, color: spools.colorName, finish: spools.finish })
      .from(spools)
      .where(isNull(spools.deletedAt)),
  ]);
  const counts = new Map<string, number>();
  const add = (text: string | null | undefined, weight = 1) => {
    for (const word of words(text ?? "")) if (word.length >= 4) counts.set(word, (counts.get(word) ?? 0) + weight);
  };
  for (const row of itemRows) {
    add(row.title, 3);
    add(row.note);
  }
  for (const row of spoolRows) add(`${row.material} ${row.brand} ${row.color} ${row.finish}`, 2);
  for (const tag of [...BUILT_IN_TAGS.failure, ...BUILT_IN_TAGS.success, ...custom]) add(tag.label, 5);
  add(KNOWN_WORDS, 4);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([word]) => word);
}

/** The failure coach's suggestion that a search matched, shown under the attempt it was made for. */
async function withCoachIdeas(db: Db, hits: AttemptHit[], terms: readonly SearchTerm[]): Promise<AttemptHit[]> {
  if (!hits.length) return hits;
  const runs = await db
    .select()
    .from(coachRuns)
    .where(
      and(
        inArray(
          coachRuns.attemptId,
          hits.map((hit) => hit.attempt.id),
        ),
        eq(coachRuns.status, "done"),
      ),
    );
  return hits.map((hit) => {
    const run = runs.find((row) => row.attemptId === hit.attempt.id);
    const idea = run?.suggestions.find(
      (suggestion) =>
        !run.dismissed.includes(suggestion.id) &&
        words(`${suggestion.title} ${suggestion.why}`).some((word) => matchesTerm(word, markTerms(terms))),
    );
    return idea ? { ...hit, coachIdea: idea.title } : hit;
  });
}

/** What an attempt says about how it went: its failure tags (as their labels, with the slugs) and its note. */
interface ProblemWords {
  failureTags: string[];
  note: string;
  settings: AttemptSettings;
}

/**
 * The words of a search that name an attempt's problem: those that match one of its failure tags, else those that
 * match its note, leaving out what describes the print itself (its filaments: "PETG" in "PETG wants the textured
 * sheet" is not the problem). Empty when the search found it by its title or settings.
 */
function problemTerms(
  attempt: ProblemWords,
  terms: readonly SearchTerm[],
  custom: Array<{ kind: TagKind; slug: string; label: string }>,
): SearchTerm[] {
  const failureTags = custom.filter((tag) => tag.kind === "failure");
  const tagWords = words(attempt.failureTags.map((slug) => tagLabel("failure", slug, failureTags)).join(" "));
  const matching = (found: string[]) =>
    terms.filter((term) => found.some((word) => matchesTerm(word, markTerms([term]))));
  const byTag = matching(tagWords);
  if (byTag.length) return byTag;
  const material = words(
    (attempt.settings.filaments ?? []).map((f) => [f.type, f.brand, f.colorName].filter(Boolean).join(" ")).join(" "),
  );
  return matching(words(attempt.note)).filter((term) => !matching(material).includes(term));
}

/** Whether an attempt had this problem: a failure tag or a word of its note that the problem's words match. */
function hasProblem(
  attempt: ProblemWords,
  problem: readonly SearchTerm[],
  custom: Array<{ kind: TagKind; slug: string; label: string }>,
) {
  const failureTags = custom.filter((tag) => tag.kind === "failure");
  const text = `${attempt.failureTags.map((slug) => tagLabel("failure", slug, failureTags)).join(" ")} ${attempt.note}`;
  return words(text).some((word) => matchesTerm(word, markTerms(problem)));
}

/** Most fixes an answer carries. */
const MAX_FIXES = 6;

/**
 * "What fixed it": for the failures found whose problem the words name (a failure tag, or their note), the later
 * attempt on each build that went better without that problem (`findFixes`), with what changed since the failure.
 */
async function fixesFor(
  db: Db,
  found: AttemptHit[],
  terms: readonly SearchTerm[],
  custom: Array<{ kind: TagKind; slug: string; label: string }>,
): Promise<FixHit[]> {
  const failures = found.flatMap((hit) => {
    if (!isFailure(hit.attempt.outcome)) return [];
    const problem = problemTerms(hit.attempt, terms, custom);
    return problem.length ? [{ hit, problem }] : [];
  });
  if (!failures.length) return [];
  const siblings = await liveAttempts(db, unique(failures.map(({ hit }) => hit.item.id)));
  const rows = siblings.map((row) => ({
    ...row,
    id: row.id,
    outcome: row.outcome as Outcome | null,
    printedAt: row.printedAt.getTime(),
    createdAt: row.createdAt.getTime(),
  }));
  type Row = (typeof rows)[number];
  const problemOf = new Map(failures.map(({ hit, problem }) => [hit.attempt.id, problem]));
  // The failures found, as rows of their builds (each keeps the words that name its problem).
  const failed = failures.flatMap(({ hit }) => rows.filter((row) => row.id === hit.attempt.id));
  const fixes: Array<{ fix: Row; after: Row[] }> = [];
  for (const failure of failed) {
    const problem = problemOf.get(failure.id) ?? [];
    const [found] = findFixes(
      [failure],
      (one) => rows.filter((row) => row.itemId === one.itemId),
      (row) => hasProblem(row, problem, custom),
    );
    if (!found) continue;
    const known = fixes.find((fix) => fix.fix.id === found.fix.id);
    if (known) known.after = byPrintTime([...known.after, failure]);
    else fixes.push(found);
  }
  if (!fixes.length) return [];
  const kept = fixes.slice(0, MAX_FIXES);
  const hits = await attemptHits(
    db,
    kept.map(({ fix }) => fix.id),
  );
  const numbers = new Map(found.map((hit) => [hit.attempt.id, hit.number]));
  return kept.flatMap(({ fix, after }) => {
    const hit = hits.find((one) => one.attempt.id === fix.id);
    const last = after.at(-1);
    if (!hit || !last || !isFailure(last.outcome)) return [];
    const problem = problemOf.get(last.id) ?? [];
    return [
      {
        ...hit,
        after: {
          attemptId: last.id,
          number: numbers.get(last.id) ?? 0,
          outcome: last.outcome,
          printedAt: last.printedAt,
          tags: last.failureTags.filter((slug) =>
            hasProblem({ failureTags: [slug], note: "", settings: {} }, problem, custom),
          ),
        },
        failures: after.length,
        changes: describeChanges(last.settings, fix.settings).map((change) => change.text),
      },
    ];
  });
}

/** What anyone prints about, so a typo in "warping" is mended even in an empty notebook. */
const KNOWN_WORDS =
  "petg nozzle bed plate temperature warping stringing adhesion brim supports support layer infill filament spool " +
  "silk matte printer first dried drying wet clog overhang seam banding purge";

/** One search for these terms and filters. */
async function searchWith(
  env: Env,
  db: Db,
  input: SearchInput,
  custom: Array<{ kind: TagKind; slug: string; label: string }>,
): Promise<SearchResponse> {
  const { terms, intent, when, ...f } = input;
  // "what worked" with nothing else asked is the outcome filter (unless one is chosen).
  const outcome =
    f.outcome ??
    (!terms.length && intent === "worked" ? "success" : !terms.length && intent === "failed" ? "failures" : undefined);
  const narrowsAttempts = !!(outcome || f.material || f.tag);
  const empty: SearchResponse = { builds: [], ideas: [], attempts: [], recipes: [], twists: [], spools: [] };
  const recipeFilters = !outcome && !f.tag;
  const findRecipes = async (): Promise<Recipe[]> => {
    if (!recipeFilters) return [];
    let list = await liveRecipes(db);
    if (f.material) list = recipesFor(list, { material: f.material });
    if (f.person) list = list.filter((recipe) => recipe.createdBy === f.person);
    return terms.length
      ? list.filter((recipe) =>
          textMatchesTerms(`${recipe.name} ${recipe.note} ${recipe.material} ${recipe.finish ?? ""}`, terms),
        )
      : list;
  };
  // Twists are found by a plain match over their words (there are few), and never by a filter that is about prints.
  const findTwists = async (): Promise<Twist[]> => {
    if (!terms.length || narrowsAttempts || when) return [];
    let list = await liveTwists(db);
    if (f.person) list = list.filter((twist) => twist.createdBy === f.person);
    return list.filter((twist) =>
      textMatchesTerms(
        [
          twist.name,
          twist.note,
          twist.source.title,
          twist.source.designer,
          twist.source.place,
          ...twist.changes.flatMap((change) => [change.label, change.value, change.note]),
        ]
          .filter(Boolean)
          .join(" "),
        terms,
      ),
    );
  };
  const findSpools = async (): Promise<Spool[]> => {
    if (!terms.length || narrowsAttempts || f.person || when) return [];
    const rows = await db
      .select({ spool: spools, slot: amsSlots.slot })
      .from(spools)
      .leftJoin(amsSlots, eq(amsSlots.spoolId, spools.id))
      .where(isNull(spools.deletedAt));
    const hits = rows.map((row) => toApiSpool(row.spool, row.slot)).filter((spool) => spoolMatches(spool, terms));
    if (!hits.length) return [];
    const grams = await gramsFor(
      db,
      env.DB,
      rows.filter((row) => hits.some((hit) => hit.id === row.spool.id)).map((row) => row.spool),
    );
    return hits.slice(0, 6).map((hit) => {
      const row = rows.find((r) => r.spool.id === hit.id);
      return row ? toApiSpool(row.spool, row.slot, grams.get(hit.id)) : hit;
    });
  };
  if (!terms.length && !narrowsAttempts && !f.person && !when) return empty;

  const filter = attemptFilters({ ...f, outcome });
  const span = when
    ? { sql: " AND a.printed_at >= ? AND a.printed_at < ?", params: [when.from, when.to] }
    : { sql: "", params: [] };
  if (!terms.length) {
    // Filters alone: the newest attempts that pass them.
    const rows = await all<{ id: string }>(env, {
      sql: `SELECT a.id FROM attempts AS a JOIN items AS i ON i.id = a.item_id
        WHERE a.deleted_at IS NULL AND i.deleted_at IS NULL${filter.sql}${span.sql}
        ORDER BY a.printed_at DESC LIMIT ${LIMIT.attempts}`,
      params: [...filter.params, ...span.params],
    });
    return {
      ...empty,
      attempts: await attemptHits(
        db,
        rows.map((row) => row.id),
      ),
      recipes: f.material ? await findRecipes() : [],
    };
  }

  const match = ftsQuery(terms, custom);
  const itemSpan = when
    ? { sql: " AND i.created_at >= ? AND i.created_at < ?", params: [when.from, when.to] }
    : { sql: "", params: [] };
  const commentSpan = when
    ? { sql: " AND c.created_at >= ? AND c.created_at < ?", params: [when.from, when.to] }
    : { sql: "", params: [] };
  // A question about what worked puts attempts that worked first (and about what failed, the ones that didn't).
  const prefers = intent === "failed" ? FAILED_FIRST : WORKED_FIRST;
  const [attemptRows, itemRows, commentRows] = await Promise.all([
    all<{ id: string }>(env, {
      sql: `SELECT a.id FROM search
        JOIN attempts AS a ON a.id = search.ref_id
        JOIN items AS i ON i.id = a.item_id
        WHERE search MATCH ? AND search.kind = 'attempt' AND a.deleted_at IS NULL AND i.deleted_at IS NULL${filter.sql}${span.sql}
        ORDER BY ${RANK} * ${prefers}, a.printed_at DESC LIMIT ${LIMIT.attempts}`,
      params: [match, ...filter.params, ...span.params],
    }),
    // Outcome, material and tag describe attempts: with one of them on, only attempts are found.
    narrowsAttempts
      ? Promise.resolve([])
      : all<{ id: string; snippet: string | null }>(env, {
          sql: `SELECT i.id, snippet(search, 4, ?, ?, '…', 16) AS snippet FROM search
            JOIN items AS i ON i.id = search.ref_id
            WHERE search MATCH ? AND search.kind = 'item' AND i.deleted_at IS NULL${f.person ? " AND i.created_by = ?" : ""}${itemSpan.sql}
            ORDER BY ${RANK}, i.created_at DESC LIMIT ${LIMIT.items * 2}`,
          params: [SNIPPET_OPEN, SNIPPET_CLOSE, match, ...(f.person ? [f.person] : []), ...itemSpan.params],
        }),
    // What the two of you said in a thread (migrations/0022_comment-search.sql): found as the item it belongs to.
    narrowsAttempts
      ? Promise.resolve([])
      : all<{
          id: string;
          item_id: string;
          author_id: string;
          via: string | null;
          created_at: number;
          snippet: string;
        }>(env, {
          sql: `SELECT c.id, c.item_id, c.author_id, c.via, c.created_at, snippet(search, 4, ?, ?, '…', 16) AS snippet FROM search
            JOIN comments AS c ON c.id = search.ref_id
            JOIN items AS i ON i.id = c.item_id
            WHERE search MATCH ? AND search.kind = 'comment' AND c.deleted_at IS NULL AND i.deleted_at IS NULL${f.person ? " AND (i.created_by = ? OR c.author_id = ?)" : ""}${commentSpan.sql}
            ORDER BY ${RANK}, c.created_at DESC LIMIT ${LIMIT.items * 2}`,
          params: [
            SNIPPET_OPEN,
            SNIPPET_CLOSE,
            match,
            ...(f.person ? [f.person, f.person] : []),
            ...commentSpan.params,
          ],
        }),
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
  const [attemptList, itemList, recipeList, twistList, spoolList] = await Promise.all([
    withCoachIdeas(
      db,
      await attemptHits(
        db,
        attemptRows.map((row) => row.id),
      ),
      terms,
    ),
    itemHits(db, found),
    findRecipes(),
    findTwists(),
    findSpools(),
  ]);
  return {
    builds: itemList.filter((hit) => hit.item.stage !== "idea").slice(0, LIMIT.items),
    ideas: itemList.filter((hit) => hit.item.stage === "idea").slice(0, LIMIT.items),
    attempts: attemptList,
    recipes: recipeList,
    twists: twistList,
    spools: spoolList,
  };
}

/**
 * How much more an attempt's score counts for its outcome (bm25 is negative: more is better). Worked attempts
 * come before partly and failed ones, so a settings question leads with what to copy.
 */
const WORKED_FIRST = "CASE a.outcome WHEN 'success' THEN 1.5 WHEN 'partial' THEN 1.0 ELSE 0.8 END";
const FAILED_FIRST = "CASE a.outcome WHEN 'failed' THEN 1.5 WHEN 'partial' THEN 1.2 ELSE 0.8 END";

/**
 * Search, filter chips and "what worked last time". Search runs on the FTS5
 * index (migrations/0003_search.sql), which triggers keep up to date.
 */
export const searchRoutes = new Hono<AppEnv>()
  .get("/search", async (c) => {
    const parsed = searchQuery.safeParse(c.req.query());
    if (!parsed.success) return apiError(c, 400, "invalid", "That search couldn't be read.");
    const { q = "", closest: wantClosest, ...f } = parsed.data;
    const db = c.var.db;
    const read = parseQuery(q, Date.now());
    const people = await db.select({ id: users.id, name: users.name }).from(users);
    // Every word of a name counts ("Carl Oscar's idea": carl and oscar are both Carl Oscar).
    const nameWords = people.map((person) => ({ id: person.id, words: words(person.name) }));
    const named = splitNames(
      read.terms,
      nameWords.flatMap((person) => person.words),
    );
    // "Marie's idea about the coffee clips": a first name narrows to what that person wrote, unless that finds nothing.
    const whose = nameWords.filter((person) => person.words.some((word) => named.names.includes(word)));
    // Only a name beside other words narrows; "Sam" alone is a word to find (a build called "Sam's coaster").
    const personFromWords = whose.length === 1 && named.terms.length > 0 ? whose[0]?.id : undefined;
    const custom = await db.select({ kind: tags.kind, slug: tags.slug, label: tags.label }).from(tags);
    const ask = (terms: SearchTerm[], narrowTo?: string) =>
      searchWith(
        c.env,
        db,
        { terms, intent: read.intent, when: read.when, ...f, person: f.person ?? narrowTo },
        custom,
      );

    let terms = read.terms;
    let result: SearchResponse | null = null;
    if (personFromWords && !f.person) {
      const narrowed = await ask(named.terms, personFromWords);
      if (hasHits(narrowed)) {
        terms = named.terms;
        result = narrowed;
      }
    }
    result ??= await ask(read.terms);
    let corrected: string | null = null;
    if (!hasHits(result) && read.terms.length) {
      // Nothing found: a typo, maybe. Correct the words from what the notebook knows.
      const fixed = correctTerms(read.terms, await vocabulary(db, custom));
      if (fixed) {
        const retry = await ask(fixed);
        if (hasHits(retry)) {
          result = retry;
          terms = fixed;
          corrected = fixed.map((term) => term.text).join(" ");
        }
      }
    }
    // Still nothing with every word: the closest are what has the most of them, one search per word, merged.
    let closest: string[] | null = null;
    if (wantClosest && !hasHits(result) && read.terms.length > 1) {
      const each = await Promise.all(read.terms.map((term) => ask([term])));
      if (each.some(hasHits)) {
        result = mergeClosest(each);
        terms = read.terms;
        closest = read.terms.map((term) => term.text);
      }
    }
    // A problem's words ("warping", or the Warping chip): the later attempts that fixed it lead the answer. Not while
    // an outcome is picked: "Only failures" asks for the failures.
    const failureTag = f.tag
      ? [...BUILT_IN_TAGS.failure, ...custom.filter((tag) => tag.kind === "failure")].find((tag) => tag.slug === f.tag)
      : undefined;
    const problem = failureTag ? [...terms, ...searchTerms(failureTag.label)] : terms;
    const fixes = f.outcome ? [] : await fixesFor(db, result.attempts, problem, custom);
    return c.json<SearchResponse>({
      ...result,
      fixes,
      terms: markTerms(terms),
      corrected,
      closest,
      intent: read.intent,
      when: read.when ? { label: read.when.label, weekMonday: read.when.weekMonday } : null,
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
    const parsed = whatWorkedQuery.safeParse(c.req.query());
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

/** For the OpenAPI document (worker/openapi). */
export { searchQuery, whatWorkedQuery };
