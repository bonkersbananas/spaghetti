import type { RecipesResponse } from "@shared/api";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./api";

/** Every recipe, newest first. Kept apart from lib/recipes (saving, deleting) so a screen can ask "are there any?" cheaply. */
export const recipesQuery = queryOptions({
  queryKey: ["recipes"] as const,
  queryFn: async () => (await api<RecipesResponse>("/recipes")).recipes,
  staleTime: 60_000,
});
