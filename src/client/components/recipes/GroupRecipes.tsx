import { recipesFor } from "@shared/recipes";
import { useRecipes } from "@/lib/recipes";
import { RecipeShelf } from "./RecipeShelf";

/** "Recipes for PLA": what worked on this material, under its spools (loaded after the pantry has shown). */
export function GroupRecipes({ material }: { material: string }) {
  return (
    <RecipeShelf
      recipes={recipesFor(useRecipes(), { material })}
      title={`Recipes for ${material}`}
      heading="overline"
    />
  );
}
