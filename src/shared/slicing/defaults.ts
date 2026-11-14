import type { SlicerId, SlicingFilament, SlicingSettings } from "./settings.ts";

/**
 * The slicer a model is sliced with unless someone picks one (decision 0055): OrcaSlicer's engine, until a print
 * sliced by Spaghetti's own has worked on the X2D. Change this one line to "spaghetti" to make ours the default:
 * new models, and every workspace that never picked a slicer on the Printer page, are then sliced by it. A model
 * already sliced keeps the slicer it was sliced with, as it keeps its other settings.
 */
export const DEFAULT_SLICER: SlicerId = "orca";

/**
 * PLA in no colour anyone chose (sliced as Bambu PLA Basic, in Orca's own colour): what a model is sliced with when
 * the Pantry has no spool to offer. An attempt keeps its own filament over it (decision 0046).
 */
export const STAND_IN_FILAMENT: SlicingFilament = { material: "PLA" };

/**
 * How Spaghetti slices a model nobody set up, in the settings people change (settings.ts): OrcaSlicer's own 0.20 mm
 * Standard for the X2D (two walls, 15 % crosshatch, no supports, a brim where the slicer sees the need), on the X2D's
 * stock Textured PEI plate with its 0.4 mm nozzle, by the default slicer. orca.ts says which of Orca's presets that is.
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
  slicer: DEFAULT_SLICER,
};
