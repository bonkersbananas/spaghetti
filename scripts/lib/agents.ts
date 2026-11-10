import {
  AGENT_SCOPES,
  type AgentScope,
  generateToken,
  hashToken,
  isScope,
  tokenPrefix,
} from "../../src/shared/agents.ts";
import { executeSql, type Target, targetArgs, wrangler } from "./wrangler.ts";

export interface NewAgentToken {
  /** The username of the person the agent acts for. */
  owner: string;
  name: string;
  scopes: AgentScope[];
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function parseScopes(text: string): AgentScope[] {
  const list = text
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  const bad = list.filter((scope) => !isScope(scope));
  if (bad.length || !list.length) throw new Error(`Scopes: any of ${AGENT_SCOPES.join(", ")}, comma-separated.`);
  return AGENT_SCOPES.filter((scope) => list.includes(scope));
}

function rows<T>(sql: string, target: Target): T[] {
  const out = JSON.parse(
    wrangler(["d1", "execute", "DB", ...targetArgs(target), "--json", "--command", sql]),
  ) as Array<{
    results?: T[];
  }>;
  return out[0]?.results ?? [];
}

/**
 * Makes a token for the owner's agent of that name (the agent is made the first time),
 * and returns it: the one time it is shown. Only its hash is stored.
 */
export async function addAgentToken(input: NewAgentToken, target: Target) {
  const name = input.name.trim();
  if (!name || name.length > 60) throw new Error("Name: 1–60 characters.");
  const [owner] = rows<{ id: string }>(`SELECT id FROM users WHERE username = ${quote(input.owner)}`, target);
  if (!owner) throw new Error(`There is no person called "${input.owner}". Add them with pnpm user:add.`);
  const [existing] = rows<{ id: string }>(
    `SELECT id FROM agents WHERE owner_id = ${quote(owner.id)} AND name = ${quote(name)}`,
    target,
  );
  const agentId = existing?.id ?? crypto.randomUUID();
  const token = generateToken();
  const now = Date.now();
  const statements = [
    ...(existing
      ? []
      : [
          `INSERT INTO agents (id, name, owner_id, created_at) VALUES (${[agentId, name, owner.id].map(quote).join(", ")}, ${now});`,
        ]),
    `INSERT INTO agent_tokens (id, agent_id, hash, prefix, scopes, created_at) VALUES (${[
      crypto.randomUUID(),
      agentId,
      await hashToken(token),
      tokenPrefix(token),
      JSON.stringify(input.scopes),
    ]
      .map(quote)
      .join(", ")}, ${now});`,
    // The feed hears of it, as the person who set it up.
    `INSERT INTO changes (entity, entity_id, item_id, action, actor_kind, actor_id, at) VALUES ('agent', ${quote(agentId)}, NULL, ${existing ? "'updated'" : "'created'"}, 'person', ${quote(owner.id)}, ${now});`,
  ];
  executeSql(statements.join("\n"), target);
  return { token, agentId, created: !existing };
}
