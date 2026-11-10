import type { Recipe, RecipeResponse, RecipesResponse } from "@shared/api";
import type { AttemptSettings } from "@shared/attempts";
import { recipeSettings, settingsMaterial } from "@shared/recipes";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { ApiError, api } from "./api";
import { spoolsQuery } from "./pantry";

/** Every recipe, newest first. A pantry group, a spool and a build each pick theirs from this (`recipesFor`). */
export const recipesQuery = queryOptions({
  queryKey: ["recipes"] as const,
  queryFn: async () => (await api<RecipesResponse>("/recipes")).recipes,
  staleTime: 60_000,
});

export function useRecipes(): Recipe[] {
  return useQuery(recipesQuery).data ?? [];
}

/** The attempt a recipe is made from. */
export interface RecipeSourceAttempt {
  id: string;
  itemId: string;
  number: number;
  title: string | null;
  settings: AttemptSettings;
}

/** Whether an attempt can become a recipe: it worked, and says which filament it used. */
export const canBeRecipe = (attempt: { outcome: string | null; settings: AttemptSettings }) =>
  attempt.outcome === "success" && settingsMaterial(attempt.settings) !== null;

function patchRecipes(queryClient: QueryClient, change: (recipes: Recipe[]) => Recipe[]) {
  queryClient.setQueryData<Recipe[]>(recipesQuery.queryKey, (recipes) => (recipes ? change(recipes) : recipes));
}

/** Other screens that show recipes: search results and the build's suggestion. */
function refreshElsewhere(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["search"] });
  void queryClient.invalidateQueries({ queryKey: ["what-worked"] });
}

/**
 * Saves an attempt that worked as a recipe. It shows at once (the settings are worked out here the way the
 * server will), the server's copy replaces it, and a failure takes it back out.
 */
export async function saveRecipe(
  queryClient: QueryClient,
  source: RecipeSourceAttempt,
  { name, note }: { name: string; note: string },
  userId: string,
): Promise<boolean> {
  const material = settingsMaterial(source.settings);
  if (!material) return false;
  const id = crypto.randomUUID();
  const spools = queryClient.getQueryData(spoolsQuery.queryKey);
  const spoolId = source.settings.filaments?.find((filament) => filament.spoolId)?.spoolId;
  const now = Date.now();
  const optimistic: Recipe = {
    id,
    name,
    note,
    material,
    finish: spools?.find((spool) => spool.id === spoolId)?.finish?.trim() || null,
    settings: recipeSettings(source.settings),
    source: { attemptId: source.id, itemId: source.itemId, title: source.title, number: source.number, photo: null },
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
  queryClient.setQueryData<Recipe[]>(recipesQuery.queryKey, (recipes) => [optimistic, ...(recipes ?? [])]);
  try {
    const { recipe } = await api<RecipeResponse>("/recipes", {
      method: "POST",
      json: { id, name, note, sourceAttemptId: source.id },
    });
    patchRecipes(queryClient, (recipes) => recipes.map((r) => (r.id === id ? recipe : r)));
    refreshElsewhere(queryClient);
    toast.success("Saved as a recipe", name);
    return true;
  } catch (error) {
    patchRecipes(queryClient, (recipes) => recipes.filter((r) => r.id !== id));
    toast.error("Couldn't save the recipe", error instanceof ApiError ? error.message : "Try again in a moment.");
    return false;
  }
}

/** Renames a recipe or changes its note (the settings never change). Resolves once the server has it. */
export async function updateRecipe(queryClient: QueryClient, id: string, changes: { name?: string; note?: string }) {
  patchRecipes(queryClient, (recipes) => recipes.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  const { recipe } = await api<RecipeResponse>(`/recipes/${id}`, { method: "PATCH", json: changes });
  patchRecipes(queryClient, (recipes) => recipes.map((r) => (r.id === id ? recipe : r)));
  refreshElsewhere(queryClient);
}

/** Deletes a recipe at once, with Undo. */
export function deleteRecipe(queryClient: QueryClient, recipe: Recipe) {
  const before = queryClient.getQueryData<Recipe[]>(recipesQuery.queryKey);
  patchRecipes(queryClient, (recipes) => recipes.filter((r) => r.id !== recipe.id));
  const deleted = api(`/recipes/${recipe.id}`, { method: "DELETE" }).then(
    () => refreshElsewhere(queryClient),
    (error) => {
      if (error instanceof ApiError && error.status === 404) return;
      if (before) queryClient.setQueryData(recipesQuery.queryKey, before);
      toast.error("Couldn't delete that recipe", "It's back where it was.");
    },
  );
  toast.undo("Recipe deleted", {
    description: recipe.name,
    onUndo: async () => {
      await deleted;
      patchRecipes(queryClient, (recipes) => [recipe, ...recipes.filter((r) => r.id !== recipe.id)]);
      try {
        await api<RecipeResponse>(`/recipes/${recipe.id}/restore`, { method: "POST" });
        refreshElsewhere(queryClient);
      } catch {
        toast.error("Couldn't bring the recipe back", "Try again in a moment.");
      }
    },
  });
}
