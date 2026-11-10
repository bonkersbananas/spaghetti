import { lazy, Suspense } from "react";

const RecipeSheet = lazy(() => import("./RecipeSheet").then((m) => ({ default: m.RecipeSheet })));
const RecipeShelf = lazy(() => import("./RecipeShelf").then((m) => ({ default: m.RecipeShelf })));

/** The recipe sheet, loaded the first time one is opened (it isn't part of any screen's first load). */
export function LazyRecipeSheet(props: { recipeId: string | null; onOpenChange: (open: boolean) => void }) {
  if (!props.recipeId) return null;
  return (
    <Suspense fallback={null}>
      <RecipeSheet {...props} />
    </Suspense>
  );
}

/** A shelf of recipes, loaded once there is one to show: a pantry with none never pays for it. */
export function LazyRecipeShelf(props: Parameters<typeof RecipeShelf>[0]) {
  if (!props.recipes.length) return null;
  return (
    <Suspense fallback={null}>
      <RecipeShelf {...props} />
    </Suspense>
  );
}
