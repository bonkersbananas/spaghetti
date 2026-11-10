import type { Recipe } from "@shared/api";
import { forwardRef } from "react";
import { SettingsLine } from "@/components/builds/SettingsLine";
import { filamentLabel, summarizeSettings } from "@/components/builds/settings";
import { RecipeIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { cn } from "@/lib/cn";
import { photoSrc } from "@/lib/previews";

/** "Silk PLA": the finish and the material a recipe is for. */
export const recipeKind = (recipe: Pick<Recipe, "finish" | "material">) =>
  [recipe.finish?.trim(), recipe.material].filter(Boolean).join(" ");

interface RecipeCardProps {
  recipe: Recipe;
  /** The recipe is the attempt's chosen start: ringed, the way a picked option is. */
  selected?: boolean;
  /** Smaller, for lists inside a sheet. */
  compact?: boolean;
  onOpen: () => void;
  /** Spoken name when the card does something other than open the recipe ("Start from Silk PLA…"). */
  className?: string;
}

/**
 * A recipe, as a notebook card: the picture of the print it came from first, then its name, what it is for, and its
 * settings in a quiet line. Tapping it opens it (or picks it, in the attempt sheet's picker).
 */
export const RecipeCard = forwardRef<HTMLButtonElement, RecipeCardProps>(function RecipeCard(
  { recipe, selected, compact, onOpen, className },
  ref,
) {
  const photo = recipe.source?.photo;
  const parts = summarizeSettings(recipe.settings).slice(0, compact ? 3 : 4);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-pressed={selected}
      className={cn(
        "pressable focus-ring bg-cream flex w-full items-start gap-3.5 rounded-lg p-3 text-left",
        selected ? "shadow-ring" : "shadow-soft",
        className,
      )}
    >
      {photo ? (
        <Photo
          src={photoSrc(photo.id, "thumb")}
          alt=""
          color={photo.color || undefined}
          className={cn("shrink-0 rounded-md", compact ? "size-14" : "size-20")}
        />
      ) : (
        <span
          className={cn(
            "bg-basil-soft text-basil-ink flex shrink-0 items-center justify-center rounded-md",
            compact ? "size-14" : "size-20",
          )}
        >
          <RecipeIcon size={compact ? 24 : 28} aria-hidden />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-body text-ink font-semibold">{recipe.name}</span>
        <span className="text-caption text-ink-faint font-semibold tracking-wide uppercase">{recipeKind(recipe)}</span>
        <SettingsLine
          filaments={recipe.settings.filaments ?? []}
          parts={parts}
          name={filamentLabel}
          className="text-small text-ink-soft"
          filamentClassName="text-ink"
        />
        {recipe.note && !compact && <span className="text-small text-ink-soft line-clamp-2">{recipe.note}</span>}
      </span>
    </button>
  );
});
