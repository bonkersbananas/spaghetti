import type { Recipe } from "@shared/api";
import { RECIPE_NAME_MAX, RECIPE_NOTE_MAX } from "@shared/recipes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SettingsLine } from "@/components/builds/SettingsLine";
import { filamentLabel, summarizeSettings } from "@/components/builds/settings";
import { Button } from "@/components/ui/Button";
import { TextArea, TextField } from "@/components/ui/Field";
import { ArrowRightIcon, TrashIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { useReadOnly } from "@/lib/read-only";
import { deleteRecipe, recipesQuery, updateRecipe } from "@/lib/recipes";
import { useLiveFields } from "@/lib/use-autosave";
import { useIsDesktop } from "@/lib/use-media-query";
import { recipeKind } from "./RecipeCard";

/**
 * A recipe, open: its name and note are the only things that change (autosaved), its settings are the attempt's and
 * stay. Delete takes it away at once, with an Undo toast.
 */
export function RecipeSheet({
  recipeId,
  onOpenChange,
}: {
  /** The recipe shown; null closes the sheet. */
  recipeId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: recipes } = useQuery(recipesQuery);
  const recipe = recipes?.find((r) => r.id === recipeId);
  // Keep the last recipe on screen while the sheet slides away (it has just been deleted).
  return (
    <Sheet
      open={!!recipeId && !!recipe}
      onOpenChange={onOpenChange}
      title={recipe?.name || "Recipe"}
      description={recipe ? recipeKind(recipe) : undefined}
    >
      {recipe && <RecipeBody key={recipe.id} recipe={recipe} onClose={() => onOpenChange(false)} />}
    </Sheet>
  );
}

function RecipeBody({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const readOnly = useReadOnly();
  const { value, change, saveState } = useLiveFields({ name: recipe.name, note: recipe.note }, async (changes) => {
    // A name can't be blank: that change waits until there is one.
    const { name, ...rest } = changes;
    const next = { ...rest, ...(name?.trim() ? { name: name.trim() } : {}) };
    if (Object.keys(next).length) await updateRecipe(queryClient, recipe.id, next);
  });
  return (
    <div className="flex flex-col gap-6">
      <fieldset disabled={readOnly} className="contents">
        <TextField
          label="Name"
          value={value.name}
          maxLength={RECIPE_NAME_MAX}
          saveState={saveState}
          enterKeyHint="done"
          onChange={(event) => change({ name: event.target.value })}
        />
        <TextArea
          label="Note"
          minRows={2}
          maxLength={RECIPE_NOTE_MAX}
          placeholder="Dry it first, slow the outer wall…"
          value={value.note}
          onChange={(event) => change({ note: event.target.value })}
        />
      </fieldset>
      <section aria-label="Settings" className="bg-ink/4 flex flex-col gap-2 rounded-lg p-4">
        <SettingsLine
          filaments={recipe.settings.filaments ?? []}
          parts={summarizeSettings(recipe.settings)}
          name={filamentLabel}
          className="text-body text-ink-soft"
          filamentClassName="text-ink"
        />
        <p className="text-small text-ink-faint">
          The settings stay as that print had them. To change them, save a newer attempt as a recipe.
        </p>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {recipe.source ? (
          <Link
            to="/builds/$buildId"
            params={{ buildId: recipe.source.itemId }}
            search={{ attempt: recipe.source.attemptId }}
            className="focus-ring text-small text-basil-ink inline-flex min-h-11 items-center gap-1.5 rounded-md font-semibold"
          >
            From attempt {recipe.source.number} of {recipe.source.title?.trim() || "an untitled build"}
            <ArrowRightIcon size={16} aria-hidden />
          </Link>
        ) : (
          <span className="text-small text-ink-faint">The print it came from has been deleted.</span>
        )}
        <Button
          variant="quiet"
          size={isDesktop ? "sm" : "md"}
          icon={TrashIcon}
          disabled={readOnly}
          onClick={() => {
            onClose();
            deleteRecipe(queryClient, recipe);
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
