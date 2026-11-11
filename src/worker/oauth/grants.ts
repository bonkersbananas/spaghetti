import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { generateToken, hashToken, REFRESH_PREFIX, tokenPrefix } from "../../shared/agents.ts";
import { ACCESS_TOKEN_SECONDS, REFRESH_TOKEN_DAYS } from "../../shared/oauth.ts";
import type { Db } from "../db/index.ts";
import { type AgentToken, agentTokens, oauthCodes, oauthRefreshTokens } from "../db/schema.ts";

export interface IssuedGrant {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];
}

/** A new access token (an hour) and refresh token (sixty days) for an agent; `statements` store them. */
export async function issueGrant(
  db: Db,
  agentId: string,
  scopes: AgentToken["scopes"],
  /** What the refresh token may ask for again: the approved scopes, even when this access token is narrower. */
  approved: AgentToken["scopes"] = scopes,
): Promise<IssuedGrant> {
  const now = Date.now();
  const accessToken = generateToken();
  const refreshToken = generateToken(REFRESH_PREFIX);
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_SECONDS,
    statements: [
      db.insert(agentTokens).values({
        id: crypto.randomUUID(),
        agentId,
        hash: await hashToken(accessToken),
        prefix: tokenPrefix(accessToken),
        scopes,
        createdAt: new Date(now),
        expiresAt: new Date(now + ACCESS_TOKEN_SECONDS * 1000),
      }),
      db.insert(oauthRefreshTokens).values({
        hash: await hashToken(refreshToken),
        agentId,
        scopes: approved,
        createdAt: new Date(now),
        expiresAt: new Date(now + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
      }),
    ],
  };
}

/** Ends a connected app: its refresh tokens are gone and its access tokens stop at the next request. */
export function disconnectAgent(db: Db, agentId: string) {
  return [
    db
      .update(agentTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(agentTokens.agentId, agentId), isNull(agentTokens.revokedAt))),
    db.delete(oauthRefreshTokens).where(eq(oauthRefreshTokens.agentId, agentId)),
  ] as const;
}

/** Access tokens that ran out and refresh tokens that lapsed; the daily cron clears them. */
export async function pruneOauth(db: Db) {
  const now = new Date();
  await db.batch([
    db.delete(agentTokens).where(and(isNotNull(agentTokens.expiresAt), lt(agentTokens.expiresAt, now))),
    db.delete(oauthRefreshTokens).where(lt(oauthRefreshTokens.expiresAt, now)),
    db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, now)),
  ]);
}
