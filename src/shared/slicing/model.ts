/**
 * A model's slicing settings (decision 0047): what its slice was made with, and what its next one uses. Its row
 * keeps the settings people chose (`slicing`, whole once anyone changed one); a slice's record keeps the settings it
 * was made with. Pure, so the card, the sheet and the story share it.
 */
import type { AttemptFile } from "../api.ts";
import {
  changedSlicing,
  filamentWords,
  orientationWords,
  qualityWords,
  type SlicingSettings,
  slicerWords,
  slicingFromRecord,
  strengthOf,
  strengthWords,
  supportWords,
  withNozzle,
} from "./settings.ts";
import type { FileSlice } from "./types.ts";

/** The settings a slice was made with: its own record's, or, for a slice from before they were kept, read from it. */
export const slicingOfSlice = (slice: FileSlice): SlicingSettings =>
  slice.settings.slicing ?? slicingFromRecord(slice.settings);

/** The settings a model's next slice uses: what was chosen for it, else what its slice was made with, else `defaults`. */
export function modelSlicing(file: Pick<AttemptFile, "slicing" | "slice">, defaults: SlicingSettings): SlicingSettings {
  const own = file.slicing ?? (file.slice ? slicingOfSlice(file.slice) : null);
  if (!own) return defaults;
  // A model nobody picked a nozzle size for follows the main nozzle (the defaults' `nozzle`, decision 0057).
  return own.nozzlePicked || own.nozzle === defaults.nozzle ? own : withNozzle(own, defaults.nozzle);
}

/** Settings chosen for a model that its slice wasn't made with yet: a change still being sliced, or never sliced. */
export function slicingAhead(file: Pick<AttemptFile, "slicing" | "slice">): SlicingSettings | null {
  if (!file.slicing || !file.slice) return null;
  const sliced = slicingOfSlice(file.slice);
  return changedSlicing(sliced, asSliced(file.slicing, sliced, !!file.slice.colours?.length)).length
    ? file.slicing
    : null;
}

/**
 * Chosen settings as a slice made with them records them: a filament that names no colour of its own was sliced in
 * the colour the slice gave it (a project's for its place, else a stand-in's), which is no change of anyone's.
 */
function asSliced(chosen: SlicingSettings, sliced: SlicingSettings, byRows = false): SlicingSettings {
  // A model whose colours are matched to filaments (the Colours rows) has its filaments from its choices: a choice can
  // add, drop, merge and reorder them, so the filaments of the settings (the last ones kept, stale) say nothing; the
  // choices (`colours`) are what was asked for, and they are compared.
  if (byRows) return { ...chosen, filaments: sliced.filaments };
  return {
    ...chosen,
    filaments: chosen.filaments.map((filament, index) => {
      const made = sliced.filaments[index];
      if (filament.colorHex || !made?.colorHex || made.material !== filament.material) return filament;
      return { ...filament, colorHex: made.colorHex, ...(made.colorName ? { colorName: made.colorName } : {}) };
    }),
  };
}

/** "Jade white" for one colour's pick, "the nearest spools" for taking one back, else "the colours printed in other filaments". */
function colourPickWords(before: SlicingSettings, after: SlicingSettings): string {
  const had = before.colours ?? [];
  const now = after.colours ?? [];
  const picked = now.filter((choice) => {
    const was = had.find((other) => other.from === choice.from);
    return !was || JSON.stringify(was.filament) !== JSON.stringify(choice.filament);
  });
  const dropped = had.filter((choice) => !now.some((other) => other.from === choice.from));
  if (picked.length === 1 && !dropped.length) {
    const filament = (picked[0] as (typeof picked)[number]).filament;
    return filament.colorName ?? filamentWords(filament);
  }
  if (!picked.length && dropped.length) return "the nearest spools";
  return "the colours printed in other filaments";
}

/**
 * What a change of settings is, in a few words to follow "Slicing with": "Fine", "supports where needed", "no
 * supports", "PETG black", "Strong", "80%", "Spaghetti's own slicer"; "the new settings" when several changed.
 */
export function changeWords(before: SlicingSettings, after: SlicingSettings): string {
  const changed = changedSlicing(before, after);
  const strength = ["walls", "infill", "pattern"] as const;
  const onlyStrength = changed.length > 0 && changed.every((key) => (strength as readonly string[]).includes(key));
  if (onlyStrength) {
    const strength = strengthOf(after);
    return strength ? strengthWords(strength) : "other walls and infill";
  }
  // Another nozzle moves the layer height with it (the same quality, at that nozzle's height): one change.
  if (changed.length === 2 && changed.includes("nozzle") && changed.includes("layerHeight")) {
    return `the ${after.nozzle} mm nozzle`;
  }
  if (changed.length !== 1) return "the new settings";
  switch (changed[0]) {
    case "layerHeight":
      return qualityWords(after.layerHeight, after.nozzle);
    case "supports":
      return supportWords(after) || "no supports";
    case "supportStyle":
      return supportWords(after, true) || "other supports";
    case "brim":
      return after.brim === "on" ? "a brim" : after.brim === "off" ? "no brim" : "a brim where needed";
    case "filaments":
      return after.filaments[0] ? filamentWords(after.filaments[0]) : "other filament";
    case "colours":
      return colourPickWords(before, after);
    case "plate":
      return `the ${after.plate}`;
    case "nozzle":
      return `the ${after.nozzle} mm nozzle`;
    case "scale":
      return `${after.scale}%`;
    case "orientation":
      return orientationWords(after) || "the model as designed";
    case "modelPlate":
      return `plate ${after.modelPlate ?? 1}`;
    case "copies":
      return after.copies === undefined
        ? "one copy"
        : after.copies === "fit"
          ? "as many as fit"
          : `${after.copies} copies`;
    case "slicer":
      return slicerWords(after.slicer);
    default:
      return "the new settings";
  }
}
