import { AnimatePresence, m } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CheckIcon, RecipeIcon } from "@/components/ui/icons";
import { duration, ease } from "@/lib/motion";
import { type RecipeSourceAttempt, useRecipes } from "@/lib/recipes";
import { SaveRecipeForm } from "./SaveRecipe";

/**
 * In the attempt sheet of a print that worked: "Save as recipe" opens the name field right here (a sheet inside a
 * sheet would be one layer too many); once saved it says so.
 */
export function SaveAsRecipe({ source, disabled }: { source: RecipeSourceAttempt; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const saved = useRecipes().find((recipe) => recipe.source?.attemptId === source.id);
  if (saved) {
    return (
      <p className="text-small text-basil-ink flex items-center gap-1.5 px-0.5 font-semibold">
        <CheckIcon size={16} weight="bold" aria-hidden />
        Saved as the recipe “{saved.name}”
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence initial={false}>
        {open ? (
          <m.div
            key="form"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: duration.base, ease: ease.out }}
            className="bg-basil-soft/60 rounded-lg p-4"
          >
            <SaveRecipeForm source={source} onSaved={() => setOpen(false)} />
          </m.div>
        ) : (
          <Button
            key="button"
            variant="quiet"
            icon={RecipeIcon}
            disabled={disabled}
            onClick={() => setOpen(true)}
            className="-ml-2 self-start"
          >
            Save as recipe
          </Button>
        )}
      </AnimatePresence>
    </div>
  );
}
