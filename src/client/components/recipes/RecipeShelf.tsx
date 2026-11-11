import type { Recipe } from "@shared/api";
import { useState } from "react";
import { Section } from "@/components/ui/Section";
import { LazyRecipeSheet } from "./LazyRecipeSheet";
import { RecipeCard } from "./RecipeCard";

/**
 * The recipes for a spool or a material: "Recipes for silk PLA". Nothing at all when there are none, so a spool
 * page and a pantry group stay as quiet as they were before anyone saved one.
 */
export function RecipeShelf({
  recipes,
  title,
  heading = "section",
  className,
}: {
  recipes: Recipe[];
  /** "Recipes for silk PLA". */
  title: string;
  /** "section" for a page section, "overline" for a group in the pantry list. */
  heading?: "section" | "overline";
  className?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!recipes.length) return null;
  const id = `recipes-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <Section
      id={id}
      title={title}
      count={recipes.length}
      size={heading === "overline" ? "overline" : "headline"}
      as={heading === "overline" ? "h3" : "h2"}
      className={className}
    >
      <ul className="grid gap-3 md:grid-cols-2">
        {recipes.map((recipe) => (
          <li key={recipe.id} className="list-none">
            <RecipeCard recipe={recipe} onOpen={() => setOpen(recipe.id)} />
          </li>
        ))}
      </ul>
      <LazyRecipeSheet recipeId={open} onOpenChange={(next) => !next && setOpen(null)} />
    </Section>
  );
}
