/**
 * Recipes: "this is how we print silk PLA now". A recipe is a named copy of
 * the settings of an attempt that worked, kept to start the next one from.
 * Pure rules shared by the Worker and the app.
 */
import { type AttemptSettings, carryOver } from "./attempts.ts";
import { fold, matchesTerm, type SearchTerm, words } from "./search.ts";

/** What a recipe is named when nobody typed a name: the longest the API takes. */
export const RECIPE_NAME_MAX = 80;
export const RECIPE_NOTE_MAX = 500;

/** The material of a set of settings: the first filament that names one, as people type it ("PETG"). */
export function settingsMaterial(settings: AttemptSettings): string | null {
  const type = settings.filaments?.find((filament) => filament.type?.trim())?.type?.trim();
  return type ? type.toUpperCase() : null;
}

/**
 * What a recipe keeps of an attempt: its chosen settings (the ones `diffSettings` compares), without results,
 * the grams a file said, or the exact spool and AMS slot (a recipe is about a kind of filament, and spools run out).
 */
export function recipeSettings(settings: AttemptSettings): AttemptSettings {
  const kept = carryOver(settings);
  if (kept.filaments) {
    kept.filaments = kept.filaments.map(({ spoolId: _spool, amsSlot: _slot, ...filament }) => filament);
  }
  return kept;
}

/** The least the matching rules need to know of a recipe. */
export interface RecipeLike {
  name: string;
  note: string;
  material: string;
  finish: string | null;
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  fold(a ?? "").trim() === fold(b ?? "").trim();

/**
 * The recipes for a material, and a finish if the spool has one: same material (any case) and, when both the
 * recipe and the spool say a finish, the same finish. A recipe with no finish is for the material at large; a spool
 * with none gets every recipe of its material. Recipes of the same finish come first, then the newest.
 */
export function recipesFor<T extends RecipeLike & { createdAt: number }>(
  recipes: readonly T[],
  want: { material: string | null | undefined; finish?: string | null },
): T[] {
  if (!want.material?.trim()) return [];
  const finish = want.finish?.trim() || null;
  return recipes
    .filter((recipe) => same(recipe.material, want.material))
    .filter((recipe) => !finish || !recipe.finish || same(recipe.finish, finish))
    .map((recipe) => ({ recipe, exact: !!finish && same(recipe.finish, finish) }))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.recipe.createdAt - a.recipe.createdAt)
    .map((entry) => entry.recipe);
}

/** Whether a search finds a recipe: every term starts a word of its name, note, material or finish. */
export function recipeMatchesTerms(recipe: RecipeLike, terms: readonly SearchTerm[]): boolean {
  if (!terms.length) return false;
  const haystack = words(`${recipe.name} ${recipe.note} ${recipe.material} ${recipe.finish ?? ""}`);
  return terms.every((term) => haystack.some((word) => matchesTerm(word, [term])));
}

/** A name to offer when saving: "Silk PLA" from the finish and material, else "PETG recipe". */
export function suggestedRecipeName(material: string | null, finish: string | null): string {
  const kind = [finish?.trim(), material?.trim()].filter(Boolean).join(" ");
  if (!kind) return "";
  const text = finish ? kind.charAt(0).toUpperCase() + kind.slice(1) : `${kind} recipe`;
  return text.slice(0, RECIPE_NAME_MAX);
}

/**
 * The settings of a new attempt that starts from a recipe: the recipe's, on the spool already chosen when it is the
 * recipe's material (its color and spool are this print's own), else with the recipe's own filament.
 */
export function startFromRecipe(
  recipe: { settings: AttemptSettings; material: string },
  current: AttemptSettings,
): AttemptSettings {
  const chosen = current.filaments ?? [];
  const onSameMaterial = chosen.some((filament) => same(filament.type, recipe.material));
  return {
    ...recipe.settings,
    ...(onSameMaterial ? { filaments: chosen.map((filament) => ({ ...filament })) } : {}),
  };
}
