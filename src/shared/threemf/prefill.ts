import type { AttemptFilament, AttemptSettings } from "../attempts.ts";
import { colorDistance, materialKey, SAME_COLOR } from "../spools.ts";
import type { Plate, ThreeMfResult } from "./types.ts";

/**
 * The plates worth asking about: the sliced ones in a `.gcode.3mf` (a file
 * exported for one plate still lists the others, unsliced), else every plate.
 */
export function printablePlates(result: ThreeMfResult): Plate[] {
  const sliced = result.plates.filter((plate) => plate.predictedSeconds !== undefined);
  return sliced.length ? sliced : result.plates;
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * What a slicer file says about printing one of its plates, as attempt
 * settings: filaments (type, color, preset), plate, nozzle size, layer
 * height, infill, walls, supports, temperatures, the process preset, and the
 * slicer's time and weight estimates. Only what the file knows is set.
 */
export function settingsFromFile(result: ThreeMfResult, plateIndex?: number): AttemptSettings {
  const plates = printablePlates(result);
  const plate = plates.find((p) => p.index === plateIndex) ?? plates[0];
  const s = result.settings;
  const out: AttemptSettings = {};

  const filaments: AttemptFilament[] = [...(plate?.filaments ?? [])]
    .sort((a, b) => a.slot - b.slot)
    .map((filament) => {
      const next: AttemptFilament = {};
      if (filament.type) next.type = filament.type;
      if (filament.colorHex) next.colorHex = filament.colorHex;
      if (filament.usedGrams !== undefined && filament.usedGrams > 0) next.grams = round(filament.usedGrams, 1);
      if (filament.profile) next.profile = filament.profile.replace(/\s*@.*$/, "").trim() || filament.profile;
      return next;
    })
    .filter((filament) => Object.keys(filament).length > 0);
  if (filaments.length) out.filaments = filaments;

  const bedType = plate?.bedType ?? s.bedType;
  if (bedType) out.bedType = bedType;
  const nozzleDiameter = plate?.nozzleDiameter ?? s.nozzleDiameter;
  if (nozzleDiameter !== undefined) out.nozzleDiameter = round(nozzleDiameter, 2);
  if (s.layerHeight !== undefined) out.layerHeight = round(s.layerHeight, 2);
  if (s.infillDensity !== undefined) out.infillDensity = Math.round(s.infillDensity);
  if (s.wallLoops !== undefined) out.wallLoops = s.wallLoops;
  const supportEnabled = plate?.supportUsed ?? s.supportEnabled;
  if (supportEnabled !== undefined) out.supportEnabled = supportEnabled;
  if (supportEnabled) out.supportType = /tree/i.test(s.supportType ?? "") ? "tree" : "normal";
  if (s.processPreset) out.processPreset = s.processPreset;

  // Temperatures are per project filament: take the first one this plate uses.
  const first = (plate?.filaments.map((f) => f.slot).sort((a, b) => a - b)[0] ?? 1) - 1;
  const nozzleTemperature = s.nozzleTemperature?.[first] ?? s.nozzleTemperature?.[0];
  if (nozzleTemperature !== undefined) out.nozzleTemperature = nozzleTemperature;
  const bedTemperature = s.bedTemperature?.[first] ?? s.bedTemperature?.[0];
  if (bedTemperature !== undefined) out.bedTemperature = bedTemperature;

  if (plate?.predictedSeconds !== undefined)
    out.estimatedMinutes = Math.max(1, Math.round(plate.predictedSeconds / 60));
  if (plate?.weightGrams !== undefined) out.weightGrams = round(plate.weightGrams, 1);
  return out;
}

/** "BambuStudio 02.01.00.00", for the record. */
export function slicerName(result: ThreeMfResult): string | undefined {
  if (!result.slicer) return undefined;
  return [result.slicer.name, result.slicer.version].filter(Boolean).join(" ");
}

/**
 * Lays a file's settings over an attempt's: what the file knows replaces the
 * attempt's values; what it doesn't (brim, chamber, dried, notes on where it
 * failed) stays. Filaments keep the spool, brand and color name people gave
 * them when the file's filament is the same material in the same place.
 */
export function applyFileSettings(current: AttemptSettings, fromFile: AttemptSettings): AttemptSettings {
  const next: AttemptSettings = { ...current, ...fromFile };
  if (fromFile.filaments) {
    next.filaments = fromFile.filaments.map((filament, index) => {
      const before = current.filaments?.[index];
      const same =
        before?.type?.toUpperCase() === filament.type?.toUpperCase() &&
        (before?.colorHex ?? "") === (filament.colorHex ?? "");
      return same && before ? { ...before, ...filament } : filament;
    });
  }
  if (fromFile.supportEnabled === false) delete next.supportType;
  return next;
}

/** Whether a setting still holds the value the file gave it. */
export function sameAsFile(
  key: keyof AttemptSettings,
  settings: AttemptSettings,
  fromFile: AttemptSettings | undefined,
) {
  if (!fromFile || fromFile[key] === undefined) return false;
  return JSON.stringify(settings[key]) === JSON.stringify(fromFile[key]);
}

/**
 * Whether a filament is still the file's: the same material in a color people
 * would call the same (a spool picked for it doesn't count as a change).
 */
export function filamentFromFile(index: number, settings: AttemptSettings, fromFile: AttemptSettings | undefined) {
  const file = fromFile?.filaments?.[index];
  const now = settings.filaments?.[index];
  if (!file || !now) return false;
  if (materialKey(file.type) !== materialKey(now.type)) return false;
  if (!file.colorHex || !now.colorHex) return (file.colorHex ?? "") === (now.colorHex ?? "");
  return colorDistance(file.colorHex, now.colorHex) <= SAME_COLOR;
}
