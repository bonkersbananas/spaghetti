/** Version helpers for pnpm doctor. Pure, so the unit tests can cover them. */

/** "v26.13.0" → [26, 13, 0]; missing parts are 0. */
export function parseVersion(version: string): number[] {
  const parts = version.trim().replace(/^[v=]/, "").split(".");
  return [0, 1, 2].map((index) => Number.parseInt(parts[index] ?? "0", 10) || 0);
}

/** Whether a version satisfies a `>=X[.Y.Z]` range, the form `engines` uses here. */
export function satisfiesMinimum(version: string, range: string): boolean {
  const wanted = parseVersion(range.replace(/^>=\s*/, ""));
  const have = parseVersion(version);
  for (let index = 0; index < 3; index++) {
    const diff = (have[index] ?? 0) - (wanted[index] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}
