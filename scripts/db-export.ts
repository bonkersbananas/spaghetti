/**
 * pnpm db:export — a SQL backup of the database that restores into an empty
 * D1 with `wrangler d1 execute DB --file <backup>`.
 *
 *   pnpm db:export                       # the local database (.wrangler/state)
 *   pnpm db:export --remote              # the deployed one
 *   pnpm db:export --output backup.sql   # default: spaghetti-<date>.sql
 *
 * How the file is made, and why `wrangler d1 export` alone can't: scripts/lib/db-backup.ts. Proved by
 * test/unit/db-backup.test.ts (restores a backup into a fresh database and compares the two).
 */
import { writeBackup } from "./lib/db-backup.ts";

const remote = process.argv.includes("--remote");
const outputIndex = process.argv.indexOf("--output");
const output =
  outputIndex > 0 ? process.argv[outputIndex + 1] : `spaghetti-${new Date().toISOString().slice(0, 10)}.sql`;
if (!output) throw new Error("--output needs a file name");

writeBackup(output, { remote });
console.log(`✓ Exported the database and the search index to ${output}`);
