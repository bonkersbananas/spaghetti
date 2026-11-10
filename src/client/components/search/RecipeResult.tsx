import type { Recipe } from "@shared/api";
import type { SearchTerm } from "@shared/search";
import { forwardRef } from "react";
import { SettingsLine } from "@/components/builds/SettingsLine";
import { summarizeSettings } from "@/components/builds/settings";
import { recipeKind } from "@/components/recipes/RecipeCard";
import { Chip } from "@/components/ui/Chip";
import { Highlight } from "@/components/ui/Highlight";
import { RecipeIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { cn } from "@/lib/cn";
import { photoSrc } from "@/lib/previews";

interface RecipeResultProps {
  recipe: Recipe;
  terms: readonly SearchTerm[];
  selected: boolean;
  onHover: () => void;
  onOpen: () => void;
}

/** A recipe found: the print it came from, its name and what it is for, its settings. Opens the recipe. */
export const RecipeResult = forwardRef<HTMLButtonElement, RecipeResultProps>(function RecipeResult(
  { recipe, terms, selected, onHover, onOpen },
  ref,
) {
  const photo = recipe.source?.photo;
  const settings = summarizeSettings(recipe.settings).slice(0, 3);
  return (
    <button
      ref={ref}
      type="button"
      aria-current={selected || undefined}
      onPointerEnter={onHover}
      onClick={onOpen}
      className={cn(
        "pressable focus-ring flex w-full items-start gap-3.5 rounded-lg p-2 text-left md:gap-4",
        selected ? "bg-cream shadow-ring" : "hover:bg-ink/4",
      )}
    >
      {photo ? (
        <Photo
          src={photoSrc(photo.id, "thumb")}
          alt=""
          color={photo.color || undefined}
          className="size-20 shrink-0 rounded-md md:size-24"
        />
      ) : (
        <span className="bg-basil-soft text-basil-ink flex size-20 shrink-0 items-center justify-center rounded-md md:size-24">
          <RecipeIcon size={26} aria-hidden />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
        <span className="flex items-center gap-2">
          <Chip icon={RecipeIcon}>Recipe</Chip>
          <span className="text-small text-ink-faint ml-auto shrink-0">{recipeKind(recipe)}</span>
        </span>
        <span className="text-body text-ink min-w-0 truncate font-semibold">
          <Highlight text={recipe.name} terms={terms} />
        </span>
        {recipe.note && <Highlight text={recipe.note} terms={terms} className="text-body text-ink-soft line-clamp-1" />}
        <SettingsLine
          filaments={recipe.settings.filaments ?? []}
          parts={settings}
          name={(filament) =>
            [filament.colorName, filament.brand, filament.type].filter(Boolean).join(" ") || "Filament"
          }
          renderText={(text) => <Highlight text={text} terms={terms} />}
          className="text-small text-ink-faint"
          filamentClassName="text-ink-soft"
        />
      </span>
    </button>
  );
});
