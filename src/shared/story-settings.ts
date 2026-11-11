// Kept apart from attempts.ts: that module loads with every screen, this one only with the build page.

/**
 * Whether an attempt's entry in the build's story lists its settings (layer, infill, plate, temperatures): on the
 * first attempt (the baseline), on one that worked (what to do again) and when nothing changed. Elsewhere the change
 * chips are the news, and the full settings are one tap away in the attempt's sheet.
 */
export function showsSettings(attempt: {
  number: number;
  outcome: string | null;
  changes: readonly unknown[];
}): boolean {
  return attempt.number === 1 || attempt.outcome === "success" || attempt.changes.length === 0;
}
