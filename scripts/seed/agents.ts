/**
 * Work done through an agent: a few ideas and a build that arrived through Sam's iPhone share shortcut or Alex's
 * Claude, so the shots show them among the rest (the person's own avatar with the agent's mark).
 *
 * The agents themselves aren't seeded, so the Agents page keeps its own shots: an agent's name comes from
 * GET /api/agents, which the shots that show this work fill in with SEED_AGENTS (`withSeedAgents` in
 * scripts/screenshot-routes.ts). Elsewhere these rows show their person's avatar with no mark, as before.
 */
import { executeSql } from "../lib/wrangler.ts";
import { SEED_BUILD_IDS } from "./builds.ts";
import { SEED_IDS } from "./ideas.ts";

export const SEED_AGENTS = {
  share: { id: "5eed0000-0000-4000-8000-0000000a6e01", name: "Share from iPhone", owner: "sam" },
  claude: { id: "5eed0000-0000-4000-8000-0000000a6e02", name: "Claude for Alex", owner: "alex" },
} as const;

/** The ideas and builds made through each agent; `createdBy` stays their owner, as the API writes it. */
const MADE_VIA: Array<{ itemId: string; agent: keyof typeof SEED_AGENTS }> = [
  { itemId: "5eed0000-0000-4000-8000-000000000015", agent: "claude" },
  { itemId: SEED_IDS.deskTidy, agent: "share" },
  { itemId: SEED_IDS.desiccantHook, agent: "share" },
  { itemId: SEED_BUILD_IDS.tugboat, agent: "claude" },
];

export function seedAgentWork(stateDir: string) {
  executeSql(
    [
      ...MADE_VIA.map(
        ({ itemId, agent }) => `UPDATE items SET created_via = '${SEED_AGENTS[agent].id}' WHERE id = '${itemId}';`,
      ),
      // The tugboat's latest attempt was logged through Claude too.
      `UPDATE attempts SET created_via = '${SEED_AGENTS.claude.id}' WHERE id = (SELECT id FROM attempts WHERE item_id = '${SEED_BUILD_IDS.tugboat}' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1);`,
    ].join("\n"),
    { persistTo: stateDir },
  );
}
