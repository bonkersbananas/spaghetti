/**
 * A SQL backup of the database that restores into an empty D1 with `wrangler d1 execute DB --file <backup>`, and
 * gives back the same schema: tables, indexes, views, triggers and the search index (an FTS5 table).
 *
 * `wrangler d1 export` can't be used for the schema: it refuses databases with virtual tables, leaves out indexes,
 * views and triggers, and writes each table's rows right after its CREATE, so a table that points at one created
 * later fails to restore. So the schema is read from sqlite_master (all of it, as the database itself holds it, so
 * nothing in a migration has to be replayed), the rows of the ordinary tables come from `wrangler d1 export
 * --no-schema`, and the search index's rows are dumped as they are. The order of the file matters: tables and
 * indexes, rows, then the search index's rows, then views and triggers (so restoring the rows doesn't fire them).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { targetArgs, wrangler } from "./wrangler.ts";

export interface BackupSource {
  remote?: boolean;
  /** Where wrangler runs: its `.wrangler/state` is the local database (default: the repository). */
  cwd?: string;
}

interface MasterRow {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}

function rows<T>(sql: string, { remote, cwd }: BackupSource): T[] {
  const out = wrangler(["d1", "execute", "DB", ...targetArgs({ remote }), "--json", "--command", sql], { cwd });
  const answer = JSON.parse(out.slice(out.indexOf("["))) as Array<{ results: T[] }>;
  return answer.flatMap((one) => one.results);
}

/** One value as SQL text. */
export function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Shadow tables FTS5 keeps for a virtual table: they come back when it is created and refilled. */
const SHADOW = ["data", "idx", "content", "docsize", "config"];

export function backupSql(source: BackupSource = {}): string {
  const master = rows<MasterRow>(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid",
    source,
  );
  const virtual = master.filter((row) => row.sql?.startsWith("CREATE VIRTUAL TABLE")).map((row) => row.name);
  const isShadow = (name: string) => virtual.some((v) => SHADOW.some((part) => name === `${v}_${part}`));
  const tables = master.filter((row) => row.type === "table" && !virtual.includes(row.name) && !isShadow(row.name));
  const indexes = master.filter((row) => row.type === "index");
  const views = master.filter((row) => row.type === "view");
  const triggers = master.filter((row) => row.type === "trigger");

  const dir = mkdtempSync(join(tmpdir(), "spaghetti-export-"));
  try {
    const dataFile = join(dir, "data.sql");
    wrangler(
      [
        "d1",
        "export",
        "DB",
        ...targetArgs({ remote: source.remote }),
        "--no-schema",
        "--output",
        dataFile,
        ...tables.flatMap((row) => ["--table", row.name]),
      ],
      { cwd: source.cwd },
    );
    const data = readFileSync(dataFile, "utf8");

    const parts = ["PRAGMA defer_foreign_keys=TRUE;"];
    const add = (title: string, statements: string[]) => {
      if (statements.length) parts.push(`-- ${title}`, ...statements);
    };
    const statement = (sql: string | null) => `${sql};`;
    add(
      "Tables",
      [...tables, ...master.filter((row) => virtual.includes(row.name))].map((row) => statement(row.sql)),
    );
    add(
      "Indexes",
      indexes.map((row) => statement(row.sql)),
    );
    add("Rows", [data]);
    const sequences = rows<{ name: string; seq: number }>("SELECT name, seq FROM sqlite_sequence", source);
    add("Counters of autoincrement tables", [
      ...sequences.map(
        (row) =>
          `DELETE FROM sqlite_sequence WHERE name = ${literal(row.name)};\nINSERT INTO sqlite_sequence (name, seq) VALUES (${literal(row.name)}, ${literal(row.seq)});`,
      ),
    ]);
    for (const name of virtual) {
      const found = rows<Record<string, unknown>>(`SELECT * FROM ${name}`, source);
      add(
        `Rows of the ${name} index`,
        found.map((row) => {
          const columns = Object.keys(row);
          return `INSERT INTO ${name} (${columns.join(", ")}) VALUES (${columns.map((column) => literal(row[column])).join(", ")});`;
        }),
      );
    }
    add(
      "Views",
      views.map((row) => statement(row.sql)),
    );
    add(
      "Triggers",
      triggers.map((row) => statement(row.sql)),
    );
    return `${parts.join("\n")}\n`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function writeBackup(output: string, source: BackupSource = {}) {
  writeFileSync(output, backupSql(source));
}
