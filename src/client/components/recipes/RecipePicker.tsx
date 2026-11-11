import type { Recipe } from "@shared/api";
import type { AttemptSettings } from "@shared/attempts";
import { recipesFor, settingsMaterial, startFromRecipe } from "@shared/recipes";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, m } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CheckIcon, ExpandIcon, RecipeIcon, UndoIcon } from "@/components/ui/icons";
import { duration, ease } from "@/lib/motion";
import { spoolsQuery } from "@/lib/pantry-queries";
import { useRecipes } from "@/lib/recipes";
import { RecipeCard } from "./RecipeCard";

/** What a new attempt knows of the recipe it started from, so the settings can say what differs from it. */
export interface AppliedRecipe {
  recipe: Recipe;
  /** The settings it started with. */
  settings: AttemptSettings;
  /** The settings the attempt had before, for Undo. */
  before: AttemptSettings;
}

/**
 * "Start from a recipe", beside "what worked last time" in a new attempt's sheet: the recipes for the filament
 * already picked (every recipe, when none is). Picking one fills in the settings; Undo puts them back. Nothing is
 * asked after that: starting from a recipe and changing a setting is just an attempt.
 */
export function RecipePicker({
  settings,
  applied,
  onApply,
  onUndo,
}: {
  settings: AttemptSettings;
  applied: AppliedRecipe | null;
  onApply: (applied: AppliedRecipe) => void;
  onUndo: (applied: AppliedRecipe) => void;
}) {
  const all = useRecipes();
  const { data: spools } = useQuery(spoolsQuery);
  const [open, setOpen] = useState(false);
  const material = settingsMaterial(settings);
  const spoolId = settings.filaments?.find((filament) => filament.spoolId)?.spoolId;
  const finish = spools?.find((spool) => spool.id === spoolId)?.finish ?? null;
  const recipes = material ? recipesFor(all, { material, finish }) : all;
  if (!recipes.length && !applied) return null;

  if (applied) {
    return (
      <div className="bg-basil-soft/60 flex items-center gap-2 rounded-lg p-3">
        <span className="text-small text-basil-ink flex min-w-0 flex-1 items-center gap-1.5 font-semibold">
          <CheckIcon size={16} weight="bold" aria-hidden className="shrink-0" />
          <span className="min-w-0 truncate">Starting from “{applied.recipe.name}”</span>
        </span>
        <Button variant="quiet" size="sm" icon={UndoIcon} onClick={() => onUndo(applied)}>
          Undo
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        icon={RecipeIcon}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="max-md:w-full"
      >
        Start from a recipe
        <ExpandIcon size={16} aria-hidden className={open ? "rotate-180" : undefined} />
      </Button>
      <AnimatePresence initial={false}>
        {open && (
          <m.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.fast, ease: ease.out }}
            className="flex flex-col gap-2"
          >
            {recipes.map((recipe) => (
              <li key={recipe.id} className="list-none">
                <RecipeCard
                  compact
                  recipe={recipe}
                  onOpen={() => {
                    const next = startFromRecipe(recipe, settings);
                    setOpen(false);
                    onApply({ recipe, settings: next, before: settings });
                  }}
                />
              </li>
            ))}
          </m.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
