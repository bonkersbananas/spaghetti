/**
 * What a slice says about filaments. A model with no filament colours of its own (any .stl) is sliced with a stand-in
 * filament, Bambu PLA Basic in OrcaSlicer's default colour (decision 0046): the colour is only for the pictures, so
 * an attempt hears the material and the grams, and keeps the filament it has.
 */
import type { AttemptSettings } from "../attempts.ts";

/** The prefill of a slice without the stand-ins' colour and preset: `chosen` says, per filament, which are real. */
export function withoutStandIns(prefill: AttemptSettings, chosen: readonly boolean[]): AttemptSettings {
  if (!prefill.filaments) return prefill;
  return {
    ...prefill,
    filaments: prefill.filaments.map((filament, index) => {
      if (chosen[index]) return filament;
      const { colorHex: _colour, profile: _profile, ...rest } = filament;
      return rest;
    }),
  };
}

/**
 * A slice's settings for an attempt that may already have its filaments (a spool picked, or the last attempt's): a
 * stand-in (no colour) gives way to the attempt's own filament there, which takes the slice's grams.
 */
export function keepOwnFilaments(current: AttemptSettings, fromSlice: AttemptSettings): AttemptSettings {
  if (!fromSlice.filaments || !current.filaments?.length) return fromSlice;
  return {
    ...fromSlice,
    filaments: fromSlice.filaments.map((filament, index) => {
      const own = current.filaments?.[index];
      if (filament.colorHex || !own) return filament;
      return { ...own, ...(filament.grams !== undefined ? { grams: filament.grams } : {}) };
    }),
  };
}
