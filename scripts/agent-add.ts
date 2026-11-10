/**
 * pnpm agent:add — make a token for an agent, so something other than a browser
 * (an MCP server, the printer bridge) can reach /api. Shown once; only its hash is kept.
 *
 *   pnpm agent:add --owner alex --name "Printer bridge" --scopes read,printer
 *   pnpm agent:add ... --remote            # the deployed D1 database
 *   pnpm agent:add ... --persist-to /data  # local state elsewhere (the container)
 *
 * The agent is made the first time; the same owner and name again adds another token to it.
 * Scopes: read, capture, attempts, printer (see docs/api.md).
 */
import { parseArgs } from "node:util";
import { addAgentToken, parseScopes } from "./lib/agents.ts";
import { applyMigrations, type Target } from "./lib/wrangler.ts";

const { values } = parseArgs({
  options: {
    owner: { type: "string" },
    name: { type: "string" },
    scopes: { type: "string" },
    remote: { type: "boolean", default: false },
    "persist-to": { type: "string", default: process.env.SPAGHETTI_STATE_DIR },
  },
});

try {
  if (!values.owner || !values.name || !values.scopes) {
    throw new Error(
      'Usage: pnpm agent:add --owner <username> --name "<agent name>" --scopes read,capture,attempts,printer',
    );
  }
  const target: Target = { remote: values.remote, persistTo: values["persist-to"] };
  if (!target.remote) applyMigrations(target);
  const { token, created } = await addAgentToken(
    { owner: values.owner.toLowerCase(), name: values.name, scopes: parseScopes(values.scopes) },
    target,
  );
  console.log(`✓ ${created ? "Made" : "Added a token to"} "${values.name}", acting for ${values.owner}.`);
  console.log("\nThis is the only time the token is shown. Keep it somewhere safe:\n");
  console.log(`  ${token}\n`);
  console.log("Use it as:  Authorization: Bearer <token>");
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
