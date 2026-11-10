import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Context } from "hono";
import { type AgentScope, hashToken, TOKEN_PREFIX } from "../../shared/agents.ts";
import type { Db } from "../db/index.ts";
import { agents, agentTokens, type User, users } from "../db/schema.ts";

/** A token's last-used time moves at most this often, so reading isn't writing. */
export const LAST_USED_EVERY_MS = 5 * 60 * 1000;

export interface AgentAuth {
  user: User;
  agentId: string;
  tokenId: string;
  scopes: AgentScope[];
}

/** The bearer token on the request: undefined when there is no Authorization header, null when it isn't a token. */
export function bearerToken(c: Context): string | null | undefined {
  const header = c.req.header("authorization");
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1]?.startsWith(TOKEN_PREFIX) ? match[1] : null;
}

/**
 * Finds the agent behind a token, or null if it is unknown or revoked. Looked
 * up by the token's hash on every request, so a revoke takes effect at once.
 */
export async function readAgentToken(db: Db, token: string): Promise<AgentAuth | null> {
  const row = await db
    .select({ token: agentTokens, agent: agents, user: users })
    .from(agentTokens)
    .innerJoin(agents, eq(agents.id, agentTokens.agentId))
    .innerJoin(users, eq(users.id, agents.ownerId))
    .where(and(eq(agentTokens.hash, await hashToken(token)), isNull(agentTokens.revokedAt)))
    .get();
  if (!row) return null;
  const now = Date.now();
  await db
    .update(agentTokens)
    .set({ lastUsedAt: new Date(now) })
    .where(
      and(
        eq(agentTokens.id, row.token.id),
        or(isNull(agentTokens.lastUsedAt), lt(agentTokens.lastUsedAt, new Date(now - LAST_USED_EVERY_MS))),
      ),
    );
  return { user: row.user, agentId: row.agent.id, tokenId: row.token.id, scopes: row.token.scopes };
}
