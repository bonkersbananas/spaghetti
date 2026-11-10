/**
 * pnpm db:export — a SQL backup of the database that restores into an empty
 * D1 with `wrangler d1 execute DB --file <backup>`.
 *
 *   pnpm db:export                       # the local database (.wrangler/state)
 *   pnpm db:export --remote              # the deployed one
 *   pnpm db:export --output backup.sql   # default: spaghetti-<date>.sql
 *
 * `wrangler d1 export` refuses databases with virtual tables, and search is
 * an FTS5 one (migrations/0003_search.sql). So this exports every ordinary
 * table, then appends the search index's own SQL, which creates the index,
 * its triggers, and fills it from the restored rows.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { root, wrangler } from "./lib/wrangler.ts";

const remote = process.argv.includes("--remote");
const outputIndex = process.argv.indexOf("--output");
const output =
  outputIndex > 0 ? process.argv[outputIndex + 1] : `spaghetti-${new Date().toISOString().slice(0, 10)}.sql`;
if (!output) throw new Error("--output needs a file name");
const target = remote ? "--remote" : "--local";

const listed = JSON.parse(
  wrangler([
    "d1",
    "execute",
    "DB",
    target,
    "--json",
    "--command",
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'search' AND name NOT LIKE 'search_%'",
  ]),
) as Array<{ results: Array<{ name: string }> }>;
const tables = listed.flatMap((result) => result.results.map((row) => row.name));
if (!tables.length) throw new Error("No tables found: has the database been migrated?");

wrangler(["d1", "export", "DB", target, "--output", output, ...tables.flatMap((table) => ["--table", table])]);
// Later migrations changed the item row's triggers (for whom, part names): the tail of 0018 has the final ones.
const parts = readFileSync(join(root, "migrations/0018_parts-and-quantities.sql"), "utf8");
const itemTags = parts.slice(parts.indexOf("CREATE VIEW `search_item_tags`"));
appendFileSync(
  output,
  `\n-- The search index (FTS5), rebuilt from the rows above.\n${readFileSync(join(root, "migrations/0003_search.sql"), "utf8")}` +
    `\n--> statement-breakpoint\nDROP TRIGGER \`search_items_insert\`;\n--> statement-breakpoint\n` +
    "CREATE TRIGGER `search_items_insert` AFTER INSERT ON `items` BEGIN\n" +
    "\tINSERT INTO search (kind, ref_id, item_id, title, body, tags)\n" +
    "\tVALUES ('item', NEW.id, NEW.id, coalesce(NEW.title, ''), NEW.note, coalesce(NEW.for_whom, ''));\nEND;\n" +
    `--> statement-breakpoint\n${itemTags}\n--> statement-breakpoint\n` +
    "UPDATE search SET tags = (SELECT tags FROM search_item_tags WHERE item_id = ref_id) WHERE kind = 'item';\n",
);
console.log(`✓ Exported ${tables.length} tables and the search index to ${output}`);
