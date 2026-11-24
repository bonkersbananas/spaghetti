/**
 * Whether the not-enough-filament note belongs in the attempt sheet: only while logging a new attempt that hasn't
 * printed (nothing has come off the spool yet). Finishing, answering or editing a print that has printed gets none.
 */
export function showsNotEnoughNote({ isNew, outcome }: { isNew: boolean; outcome: string | null }): boolean {
  return isNew && !outcome;
}
