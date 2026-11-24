import { describe, expect, it } from "vitest";
import { migrationsSummary, parseMigrationNames } from "../../scripts/lib/ship-migrations.ts";

const answer = (...names: string[]) =>
  JSON.stringify([{ results: names.map((name) => ({ name })), success: true, meta: {} }], null, 2);

describe("pnpm ship migrations summary", () => {
  it("reads names from wrangler's JSON, even after text", () => {
    expect(parseMigrationNames(`⛅️ wrangler\n${answer("0001_a.sql", "0002_b.sql")}`)).toEqual([
      "0001_a.sql",
      "0002_b.sql",
    ]);
    expect(parseMigrationNames(answer())).toEqual([]);
  });
  it("gives up on anything else", () => {
    for (const bad of ["", "no json", "[]", "[{", JSON.stringify([{ success: false, results: [] }])]) {
      expect(parseMigrationNames(bad)).toBeUndefined();
    }
  });
  it("names what was added", () => {
    expect(migrationsSummary(["0054_x.sql"], ["0054_x.sql", "0055_push_reminders.sql"])).toBe(
      "Migrations applied: 0055_push_reminders.sql",
    );
    expect(migrationsSummary(["a"], ["a", "b", "c"])).toBe("Migrations applied: b, c");
  });
  it("says none or unknown plainly", () => {
    expect(migrationsSummary(["a"], ["a"])).toBe("Migrations applied: none");
    expect(migrationsSummary(undefined, ["a"])).toBe("Migrations applied: unknown (check d1_migrations)");
    expect(migrationsSummary(["a"], undefined)).toBe("Migrations applied: unknown (check d1_migrations)");
  });
});
