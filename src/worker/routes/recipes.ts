import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Recipe, RecipeResponse, RecipesResponse } from "../../shared/api.ts";
import {
  RECIPE_NAME_MAX,
  RECIPE_NOTE_MAX,
  recipeSettings,
  recipesFor,
  settingsMaterial,
} from "../../shared/recipes.ts";
import { recipeSlicingOf } from "../../shared/slicing/recipe.ts";
import { recordChange } from "../changes.ts";
import type { Db } from "../db/index.ts";
import { attemptFiles, attempts, items, type RecipeRow, recipes, spools } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { attemptHits } from "./search.ts";

const name = z.string().trim().min(1).max(RECIPE_NAME_MAX);
const note = z.string().trim().max(RECIPE_NOTE_MAX);

const createRecipe = z.object({ id: z.uuid(), name, note: note.optional(), sourceAttemptId: z.uuid() });
const recipeQuery = z.object({
  material: z.string().trim().max(40).optional(),
  finish: z.string().trim().max(40).optional(),
});
const updateRecipe = z.object({ name: name.optional(), note: note.optional() });

const notFound = "That recipe isn't here any more.";

/** Recipes as the API shows them, each with the attempt it came from while that attempt (and its build) still exist. */
export async function toApiRecipes(db: Db, rows: RecipeRow[]): Promise<Recipe[]> {
  const sourceIds = rows.flatMap((row) => (row.sourceAttemptId ? [row.sourceAttemptId] : []));
  const live = sourceIds.length
    ? await db
        .select({ id: attempts.id })
        .from(attempts)
        .innerJoin(items, eq(items.id, attempts.itemId))
        .where(and(inArray(attempts.id, sourceIds), isNull(attempts.deletedAt), isNull(items.deletedAt)))
    : [];
  const hits = new Map(
    (
      await attemptHits(
        db,
        live.map((row) => row.id),
      )
    ).map((hit) => [hit.attempt.id, hit]),
  );
  return rows.map((row) => {
    const hit = row.sourceAttemptId ? hits.get(row.sourceAttemptId) : undefined;
    return {
      id: row.id,
      name: row.name,
      note: row.note,
      material: row.material,
      finish: row.finish,
      settings: row.settings,
      slicing: row.slicing ?? null,
      source: hit
        ? {
            attemptId: hit.attempt.id,
            itemId: hit.item.id,
            title: hit.item.title,
            number: hit.number,
            photo: hit.photo,
          }
        : null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  });
}

/** All recipes that aren't deleted, newest first. */
export async function liveRecipes(db: Db): Promise<Recipe[]> {
  return toApiRecipes(
    db,
    await db.select().from(recipes).where(isNull(recipes.deletedAt)).orderBy(desc(recipes.createdAt)),
  );
}

async function loadRecipe(db: Db, id: string): Promise<Recipe | null> {
  const row = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, id), isNull(recipes.deletedAt)))
    .get();
  return row ? ((await toApiRecipes(db, [row]))[0] ?? null) : null;
}

/** /api/recipes: named settings of attempts that worked. */
export const recipeRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const parsed = recipeQuery.safeParse(c.req.query());
    if (!parsed.success) return apiError(c, 400, "invalid", "That question couldn't be read.");
    const all = await liveRecipes(c.var.db);
    const { material, finish } = parsed.data;
    return c.json<RecipesResponse>({ recipes: material ? recipesFor(all, { material, finish }) : all });
  })

  /**
   * Saves an attempt that worked as a recipe. The settings are read from the attempt here, never taken from the
   * request: a recipe's settings can't be edited, a newer attempt makes a newer recipe.
   */
  .post("/", async (c) => {
    const parsed = createRecipe.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That recipe couldn't be read.");
    const body = parsed.data;
    const db = c.var.db;

    const existing = await db.select().from(recipes).where(eq(recipes.id, body.id)).get();
    if (existing) {
      if (existing.deletedAt) return apiError(c, 409, "deleted", "That recipe was deleted.");
      return c.json<RecipeResponse>({ recipe: (await toApiRecipes(db, [existing]))[0] as Recipe }, 201);
    }

    const source = await db
      .select({ attempt: attempts })
      .from(attempts)
      .innerJoin(items, eq(items.id, attempts.itemId))
      .where(and(eq(attempts.id, body.sourceAttemptId), isNull(attempts.deletedAt), isNull(items.deletedAt)))
      .get();
    if (!source) return apiError(c, 404, "not_found", "That attempt isn't here any more.");
    if (source.attempt.outcome !== "success") {
      return apiError(c, 422, "not_worked", "Only an attempt that worked can become a recipe.");
    }
    const material = settingsMaterial(source.attempt.settings);
    if (!material) return apiError(c, 422, "no_material", "That attempt doesn't say which filament it used.");
    const spoolId = source.attempt.settings.filaments?.find((filament) => filament.spoolId)?.spoolId;
    const spool = spoolId
      ? await db.select({ finish: spools.finish }).from(spools).where(eq(spools.id, spoolId)).get()
      : null;

    // A model Spaghetti sliced keeps the slicing settings that worked, whole (decision 0051). Only the file the
    // attempt has now: one taken off it waits for the purge (or its undo) but is no longer what printed.
    const file = await db
      .select({ kind: attemptFiles.kind, slice: attemptFiles.slice })
      .from(attemptFiles)
      .where(and(eq(attemptFiles.attemptId, source.attempt.id), isNull(attemptFiles.deletedAt)))
      .get();
    const sliced = file?.kind === "model" && file.slice?.status === "sliced" ? file.slice.settings.slicing : undefined;

    const now = new Date();
    await db.batch([
      db
        .insert(recipes)
        .values({
          id: body.id,
          name: body.name,
          note: body.note ?? "",
          material,
          finish: spool?.finish?.trim() || null,
          settings: recipeSettings(source.attempt.settings),
          slicing: sliced ? recipeSlicingOf(sliced) : null,
          sourceAttemptId: source.attempt.id,
          sourceItemId: source.attempt.itemId,
          createdBy: c.var.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing(),
      recordChange(db, { entity: "recipe", id: body.id, action: "created", actor: c.var.actor }),
    ]);
    const recipe = await loadRecipe(db, body.id);
    if (!recipe) return apiError(c, 409, "deleted", "That recipe was deleted.");
    return c.json<RecipeResponse>({ recipe }, 201);
  })

  /** Only the name and the note: the settings stay as the attempt had them. */
  .patch("/:id", async (c) => {
    const parsed = updateRecipe.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That recipe couldn't be read.");
    const recipeId = c.req.param("id");
    const [[row]] = await c.var.db.batch([
      c.var.db
        .update(recipes)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(and(eq(recipes.id, recipeId), isNull(recipes.deletedAt)))
        .returning({ id: recipes.id }),
      recordChange(c.var.db, { entity: "recipe", id: recipeId, action: "updated", actor: c.var.actor }),
    ]);
    if (!row) return apiError(c, 404, "not_found", notFound);
    const recipe = await loadRecipe(c.var.db, recipeId);
    if (!recipe) return apiError(c, 404, "not_found", notFound);
    return c.json<RecipeResponse>({ recipe });
  })

  .delete("/:id", async (c) => {
    const recipeId = c.req.param("id");
    const [[row]] = await c.var.db.batch([
      c.var.db
        .update(recipes)
        .set({ deletedAt: new Date() })
        .where(and(eq(recipes.id, recipeId), isNull(recipes.deletedAt)))
        .returning({ id: recipes.id }),
      recordChange(c.var.db, { entity: "recipe", id: recipeId, action: "deleted", actor: c.var.actor }),
    ]);
    if (!row) return apiError(c, 404, "not_found", notFound);
    return c.body(null, 204);
  })

  .post("/:id/restore", async (c) => {
    const recipeId = c.req.param("id");
    await c.var.db.batch([
      c.var.db
        .update(recipes)
        .set({ deletedAt: null })
        .where(and(eq(recipes.id, recipeId), isNotNull(recipes.deletedAt))),
      recordChange(c.var.db, { entity: "recipe", id: recipeId, action: "restored", actor: c.var.actor }),
    ]);
    const recipe = await loadRecipe(c.var.db, recipeId);
    if (!recipe) return apiError(c, 404, "not_found", "That recipe is gone for good.");
    return c.json<RecipeResponse>({ recipe });
  });

/** For the OpenAPI document (worker/openapi). */
export { createRecipe, recipeQuery, updateRecipe };
