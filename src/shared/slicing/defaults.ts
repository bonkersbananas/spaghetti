import type { SlicingFilament, SlicingSettings } from "./settings.ts";

/**
 * PLA in no colour anyone chose (sliced as Bambu PLA Basic, in Orca's own colour): what a model is sliced with when
 * the Pantry has no spool to offer. An attempt keeps its own filament over it (decision 0046).
 */
export const STAND_IN_FILAMENT: SlicingFilament = { material: "PLA" };

/**
 * How Spaghetti slices a model nobody set up, in the settings people change (settings.ts): OrcaSlicer's own 0.20 mm
 * Standard for the X2D (two walls, 15 % crosshatch, no supports, a brim where the slicer sees the need), on the X2D's
 * stock Textured PEI plate with its 0.4 mm nozzle. orca.ts says which of Orca's presets that is.
 */
export const DEFAULT_SLICING: SlicingSettings = {
  layerHeight: 0.2,
  walls: 2,
  infill: 15,
  pattern: "crosshatch",
  supports: "off",
  supportStyle: "tree",
  brim: "auto",
  filaments: [STAND_IN_FILAMENT],
  plate: "Textured PEI Plate",
  nozzle: 0.4,
  scale: 100,
  orientation: null,
};
