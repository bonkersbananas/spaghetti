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
} from "./settings.ts";
import type { FileSlice } from "./types.ts";

/** The settings a slice was made with: its own record's, or, for a slice from before they were kept, read from it. */
export const slicingOfSlice = (slice: FileSlice): SlicingSettings =>
  slice.settings.slicing ?? slicingFromRecord(slice.settings);

/** The settings a model's next slice uses: what was chosen for it, else what its slice was made with, else `defaults`. */
export function modelSlicing(file: Pick<AttemptFile, "slicing" | "slice">, defaults: SlicingSettings): SlicingSettings {
  return file.slicing ?? (file.slice ? slicingOfSlice(file.slice) : defaults);
}

/** Settings chosen for a model that its slice wasn't made with yet: a change still being sliced, or never sliced. */
export function slicingAhead(file: Pick<AttemptFile, "slicing" | "slice">): SlicingSettings | null {
  if (!file.slicing || !file.slice) return null;
  return changedSlicing(slicingOfSlice(file.slice), file.slicing).length ? file.slicing : null;
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
  if (changed.length !== 1) return "the new settings";
  switch (changed[0]) {
    case "layerHeight":
      return qualityWords(after.layerHeight);
    case "supports":
      return supportWords(after) || "no supports";
    case "supportStyle":
      return supportWords(after, true) || "other supports";
    case "brim":
      return after.brim === "on" ? "a brim" : after.brim === "off" ? "no brim" : "a brim where needed";
    case "filaments":
      return after.filaments[0] ? filamentWords(after.filaments[0]) : "other filament";
    case "plate":
      return `the ${after.plate}`;
    case "nozzle":
      return `the ${after.nozzle} mm nozzle`;
    case "scale":
      return `${after.scale}%`;
    case "orientation":
      return orientationWords(after) || "the model as designed";
    case "slicer":
      return slicerWords(after.slicer);
    default:
      return "the new settings";
  }
}
