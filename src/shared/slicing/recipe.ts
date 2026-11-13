/**
 * Slicing with a recipe (decision 0049). A recipe (decision 0017) is the settings of an attempt that worked; one saved
 * from a model Spaghetti sliced also keeps the slicing settings it was sliced with, whole. An older recipe, or one from
 * a slicer's own file, has only the attempt's settings, which say most of them: layer height, walls, infill,
 * supports, brim, plate, nozzle and filament. Pure, so the settings sheet and the tests share it.
 */
import type { AttemptSettings } from "../attempts.ts";
import { materialKey, type SpoolLike } from "../spools.ts";
import { filamentOfSpool, slicingSpools } from "./pantry.ts";
import {
  normalizeSlicing,
  SLICING_PLATES,
  type SlicingFilament,
  type SlicingSettings,
  slicingFilament,
} from "./settings.ts";

/** What slicing with a recipe needs of it. */
export interface SlicingRecipe {
  /** Uppercase filament type, "PLA". */
  material: string;
  finish: string | null;
  settings: AttemptSettings;
  slicing?: SlicingSettings | null;
}

/** What a recipe keeps of a slice's settings: the kind of filament, not the spool (spools run out). */
export function recipeSlicingOf(settings: SlicingSettings): SlicingSettings {
  return { ...settings, filaments: settings.filaments.map(({ spoolId: _spool, ...filament }) => filament) };
}

const sameFinish = (a: string | null | undefined, b: string | null | undefined) =>
  !a || !b || a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The filaments a recipe slices with here: for each, the spool already picked when it is that kind of filament,
 * else a spool from the Pantry of that kind (loaded first, the same colour if there is one), else the recipe's own
 * words, which slice the same without a spool.
 */
function pantryFilaments(
  wanted: readonly SlicingFilament[],
  recipe: Pick<SlicingRecipe, "finish">,
  current: readonly SlicingFilament[],
  spools: readonly SpoolLike[],
): SlicingFilament[] {
  const offered = slicingSpools(spools);
  return wanted.map((filament, index) => {
    const finish = filament.finish ?? recipe.finish;
    const kind = materialKey(filament.material);
    const here = current[index];
    if (here && materialKey(here.material) === kind && sameFinish(here.finish, finish)) return here;
    const ofKind = offered.filter((spool) => materialKey(spool.material) === kind && sameFinish(spool.finish, finish));
    const spool =
      ofKind.find((candidate) => !!filament.colorHex && candidate.colorHex?.toLowerCase() === filament.colorHex) ??
      ofKind[0];
    return spool ? filamentOfSpool(spool) : filament;
  });
}

/** A recipe's own filaments, in the settings' words: its slicing settings', else its attempt's. */
function recipeFilaments(recipe: SlicingRecipe): SlicingFilament[] {
  if (recipe.slicing?.filaments.length) return recipe.slicing.filaments;
  const filaments = (recipe.settings.filaments ?? [])
    .map((filament) =>
      slicingFilament({
        material: filament.type || recipe.material,
        colorHex: filament.colorHex,
        colorName: filament.colorName,
        brand: filament.brand,
        ...(recipe.finish ? { finish: recipe.finish } : {}),
      }),
    )
    .filter((filament): filament is SlicingFilament => !!filament);
  return filaments.length
    ? filaments
    : [{ material: recipe.material, ...(recipe.finish ? { finish: recipe.finish } : {}) }];
}

/**
 * The settings a model slices with from a recipe: everything the recipe says, over `base` (the model's settings) for
 * what it doesn't, and the model's own size (a recipe is about how to print, not how big this model is).
 */
export function recipeSlicing(
  recipe: SlicingRecipe,
  base: SlicingSettings,
  spools: readonly SpoolLike[] = [],
): SlicingSettings {
  const filaments = pantryFilaments(recipeFilaments(recipe), recipe, base.filaments, spools);
  if (recipe.slicing) return normalizeSlicing({ ...recipe.slicing, filaments, scale: base.scale }, base);
  const said = recipe.settings;
  return normalizeSlicing(
    {
      ...base,
      ...(said.layerHeight !== undefined ? { layerHeight: said.layerHeight } : {}),
      ...(said.wallLoops !== undefined ? { walls: said.wallLoops } : {}),
      ...(said.infillDensity !== undefined ? { infill: said.infillDensity } : {}),
      // A slicer's supports, turned on, go under every steep overhang (as decision 0046's did).
      ...(said.supportEnabled !== undefined ? { supports: said.supportEnabled ? "everywhere" : "off" } : {}),
      ...(said.supportType ? { supportStyle: said.supportType } : {}),
      ...(said.brim !== undefined ? { brim: said.brim ? "on" : "off" } : {}),
      ...(said.bedType && SLICING_PLATES.includes(said.bedType) ? { plate: said.bedType } : {}),
      ...(said.nozzleDiameter !== undefined ? { nozzle: said.nozzleDiameter } : {}),
      filaments,
    },
    base,
  );
}

/**
 * The recipes offered for a model, at most six: those for its filament first (the same material, and finish where
 * both say one), then the rest, newest first.
 */
export function recipesFor<R extends SlicingRecipe & { createdAt: number }>(
  recipes: readonly R[],
  filament: Pick<SlicingFilament, "material" | "finish">,
): R[] {
  const kind = materialKey(filament.material);
  const fits = (recipe: R) =>
    !!kind && materialKey(recipe.material) === kind && sameFinish(recipe.finish, filament.finish);
  return [...recipes].sort((a, b) => Number(fits(b)) - Number(fits(a)) || b.createdAt - a.createdAt).slice(0, 6);
}
