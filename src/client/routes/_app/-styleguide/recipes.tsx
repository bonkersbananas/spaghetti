import type { Recipe } from "@shared/api";
import { useState } from "react";
import { RecipeCard } from "@/components/recipes/RecipeCard";
import { type AppliedRecipe, RecipePicker } from "@/components/recipes/RecipePicker";
import { RecipeResult } from "@/components/search/RecipeResult";
import { Label, Panel, SAMPLE_COLOR, Section } from "./shared";

const now = Date.now();
const silk: Recipe = {
  id: "sample-recipe",
  name: "Silk PLA, slow outer wall",
  note: "Dry it first. Outer wall at 60 mm/s, no fan for the first layers.",
  material: "PLA",
  finish: "silk",
  settings: {
    filaments: [{ type: "PLA", brand: "Eryone", colorName: "Silk gold", colorHex: SAMPLE_COLOR }],
    layerHeight: 0.16,
    wallLoops: 3,
    bedType: "Textured PEI Plate",
    nozzleTemperature: 225,
    bedTemperature: 60,
    brim: true,
  },
  slicing: null,
  source: { attemptId: "a", itemId: "b", title: "Bath tugboat", number: 3, photo: null },
  createdBy: "a",
  createdAt: now,
  updatedAt: now,
};

export function RecipesSection() {
  const [selected, setSelected] = useState(false);
  const applied: AppliedRecipe = { recipe: silk, settings: silk.settings, before: {} };
  return (
    <Section
      id="recipes"
      title="Recipes"
      note="A recipe is the settings of a print that worked, named: a kitchen-notebook card with the picture of that print first. Its name and note are editable, its settings never are. Cards open the recipe; in the attempt sheet they start an attempt from it."
    >
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>Recipe card</Label>
          <RecipeCard recipe={silk} onOpen={() => undefined} />
          <Label>Compact, as in the attempt sheet's picker (tap to pick)</Label>
          <RecipeCard compact recipe={silk} selected={selected} onOpen={() => setSelected((current) => !current)} />
        </Panel>
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>As a search result</Label>
          <RecipeResult
            recipe={silk}
            terms={[{ text: "silk", prefix: true }]}
            selected={false}
            onHover={() => undefined}
            onOpen={() => undefined}
          />
          <Label>Started from a recipe</Label>
          <RecipePicker settings={silk.settings} applied={applied} onApply={() => undefined} onUndo={() => undefined} />
        </Panel>
      </div>
    </Section>
  );
}
