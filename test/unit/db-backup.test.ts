import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { backupSql, literal } from "../../scripts/lib/db-backup.ts";
import { root, wrangler } from "../../scripts/lib/wrangler.ts";

const cleanup: string[] = [];
afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

/** A project directory of its own, so its `.wrangler/state` is a database nobody else uses. */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "spaghetti-backup-"));
  cleanup.push(dir);
  writeFileSync(
    join(dir, "wrangler.jsonc"),
    JSON.stringify({
      name: "backup-check",
      compatibility_date: "2026-01-01",
      d1_databases: [
        {
          binding: "DB",
          database_name: "spaghetti",
          database_id: "00000000-0000-4000-8000-000000000000",
          migrations_dir: join(root, "migrations"),
        },
      ],
    }),
  );
  mkdirSync(join(dir, ".wrangler"));
  return dir;
}

const run = (cwd: string, args: string[]) => wrangler(["d1", ...args], { cwd });
const sql = (cwd: string, command: string) => run(cwd, ["execute", "DB", "--local", "--command", command]);
/** The answers of one or more statements (one wrangler start-up for all of them). */
function answers<T>(cwd: string, command: string): T[][] {
  const out = run(cwd, ["execute", "DB", "--local", "--json", "--command", command]);
  return (JSON.parse(out.slice(out.indexOf("["))) as Array<{ results: T[] }>).map((one) => one.results);
}
const rows = <T>(cwd: string, command: string): T[] => answers<T>(cwd, command)[0] ?? [];

/** Made-up rows that touch what a restore can get wrong: parent rows after their children, quotes, a counter ahead of its rows. */
const SEED = `
INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES ('s1', 'u1', 1, 2, 1);
INSERT INTO users (id, username, name, color, password_hash, created_at) VALUES ('u1', 'sam', 'Sam O''Brien', 'tomato', 'x', 1);
INSERT INTO items (id, stage, title, note, created_by, created_at, updated_at) VALUES
  ('i1', 'building', 'Gnome hat', 'Line one
line two, "quoted" and a snöglob', 'u1', 1, 1),
  ('i2', 'idea', NULL, '', 'u1', 2, 2);
INSERT INTO attempts (id, item_id, outcome, printed_at, note, failure_tags, settings, created_by, created_at, updated_at) VALUES
  ('a1', 'i1', 'failed', 5, 'stringing on the brim', '["stringing"]', '{"filaments":[{"type":"PETG","colorName":"Blue"}],"nozzleTemperature":240}', 'u1', 5, 5),
  ('a2', 'i1', 'success', 6, '', '[]', '{}', 'u1', 6, 6);
INSERT INTO print_jobs (attempt_id, name, placed, reasons, item_id, created_at) VALUES ('a1', 'gnome_hat_3color(2)', 'new', '[]', 'i1', 5);
INSERT INTO parts (id, item_id, name, created_at, updated_at) VALUES ('p1', 'i1', 'Brim ring', 1, 1);
INSERT INTO comments (id, item_id, author_id, body, created_at) VALUES ('c1', 'i1', 'u1', 'Try slower', 1);
INSERT INTO changes (entity, entity_id, action, actor_kind, actor_id, at) VALUES ('item', 'i1', 'create', 'user', 'u1', 1), ('item', 'i2', 'create', 'user', 'u1', 2), ('item', 'i2', 'delete', 'user', 'u1', 3);
DELETE FROM changes WHERE seq = 3;
`;

const schema = (cwd: string) =>
  rows<{ type: string; name: string; sql: string }>(
    cwd,
    "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE '_cf_%' ORDER BY type, name",
  );

describe("literal", () => {
  it("writes values as SQL", () => {
    expect(literal(null)).toBe("NULL");
    expect(literal(3)).toBe("3");
    expect(literal("O'Brien\nx")).toBe("'O''Brien\nx'");
  });
});

describe("db:export", () => {
  it("restores into an empty database with the same schema, rows, search index and triggers", {
    timeout: 240_000,
  }, () => {
    const source = project();
    run(source, ["migrations", "apply", "DB", "--local"]);
    // The index is filled by the triggers as these rows go in.
    const seed = join(source, "seed.sql");
    writeFileSync(seed, `PRAGMA defer_foreign_keys=TRUE;\n${SEED}`);
    run(source, ["execute", "DB", "--local", "--file", seed]);
    const backup = join(source, "backup.sql");
    writeFileSync(backup, backupSql({ cwd: source }));

    const target = project();
    run(target, ["execute", "DB", "--local", "--file", backup]);

    // Same tables, indexes, views, triggers and the search index's own definition.
    expect(schema(target)).toEqual(schema(source));
    // Same rows, everywhere.
    const tables = rows<{ name: string }>(
      source,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'search_%' ORDER BY name",
    ).map((row) => row.name);
    const everything = tables.map((table) => `SELECT * FROM ${table};`).join(" ");
    const [was, now] = [answers(source, everything), answers(target, everything)];
    tables.forEach((table, at) => {
      expect(now[at], table).toEqual(was[at]);
    });
    expect(rows<{ n: number }>(target, "SELECT count(*) AS n FROM search")[0]?.n).toBeGreaterThan(0);

    // The index answers, the triggers still keep it, and the counter did not go back.
    const found = (cwd: string, q: string) =>
      rows<{ ref_id: string }>(cwd, `SELECT ref_id FROM search WHERE search MATCH '${q}' ORDER BY kind, ref_id`);
    expect(found(target, '"gnome"*')).toEqual(found(source, '"gnome"*'));
    expect(found(target, '"gnome"*').length).toBeGreaterThan(0);
    sql(
      target,
      "INSERT INTO items (id, stage, title, note, created_by, created_at, updated_at) VALUES ('i3', 'idea', 'Tomato clip', '', 'u1', 3, 3)",
    );
    expect(found(target, '"tomato"*')).toEqual([{ ref_id: "i3" }]);
    sql(
      target,
      "INSERT INTO changes (entity, entity_id, action, actor_kind, actor_id, at) VALUES ('item', 'i3', 'create', 'user', 'u1', 3)",
    );
    expect(rows<{ seq: number }>(target, "SELECT max(seq) AS seq FROM changes")[0]?.seq).toBe(4);
  });
});
