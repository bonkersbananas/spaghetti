/** What pnpm ship says about the remote migrations: read d1_migrations before and after applying, and diff. */

export const READ_MIGRATIONS = "SELECT name FROM d1_migrations ORDER BY id";

/** The names in `wrangler d1 execute --json` output, or undefined when it isn't that (wrangler may print text before the JSON). */
export function parseMigrationNames(output: string): string[] | undefined {
  const start = output.indexOf("[");
  if (start < 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(output.slice(start));
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    const first = parsed[0] as { success?: unknown; results?: unknown };
    if (first?.success === false || !Array.isArray(first?.results)) return undefined;
    const names: string[] = [];
    for (const row of first.results as { name?: unknown }[]) {
      if (typeof row?.name !== "string") return undefined;
      names.push(row.name);
    }
    return names;
  } catch {
    return undefined;
  }
}

/** The one line the ship ends with. Either list unreadable: say so, never guess. */
export function migrationsSummary(before: string[] | undefined, after: string[] | undefined): string {
  if (!before || !after) return "Migrations applied: unknown (check d1_migrations)";
  const had = new Set(before);
  const added = after.filter((name) => !had.has(name));
  return `Migrations applied: ${added.length ? added.join(", ") : "none"}`;
}
