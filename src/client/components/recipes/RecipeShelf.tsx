import type { Recipe } from "@shared/api";
import { useState } from "react";
import { Overline } from "@/components/ui/Overline";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { RecipeCard } from "./RecipeCard";
import { RecipeSheet } from "./RecipeSheet";

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
    <section aria-labelledby={id} className={className ?? "flex flex-col gap-3"}>
      {heading === "overline" ? (
        <Overline id={id} as="h3" count={recipes.length}>
          {title}
        </Overline>
      ) : (
        <SectionHeading id={id} count={recipes.length}>
          {title}
        </SectionHeading>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {recipes.map((recipe) => (
          <li key={recipe.id} className="list-none">
            <RecipeCard recipe={recipe} onOpen={() => setOpen(recipe.id)} />
          </li>
        ))}
      </ul>
      <RecipeSheet recipeId={open} onOpenChange={(next) => !next && setOpen(null)} />
    </section>
  );
}
