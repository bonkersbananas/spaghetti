import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  AGENT_SCOPES,
  type AgentInfo,
  type AgentsResponse,
  type AgentTokenInfo,
  generateToken,
  hashToken,
  type NewTokenResponse,
  tokenPrefix,
} from "../../shared/agents.ts";
import { recordChange } from "../changes.ts";
import type { Db } from "../db/index.ts";
import { type Agent, type AgentToken, agents, agentTokens, oauthClients, oauthRefreshTokens } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { disconnectAgent } from "../oauth/grants.ts";

const scopes = z
  .array(z.enum(AGENT_SCOPES))
  .min(1)
  .max(AGENT_SCOPES.length)
  .transform((list) => AGENT_SCOPES.filter((scope) => list.includes(scope)));

const createAgent = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(60),
  scopes,
});
const createToken = z.object({ scopes });

const notFound = "That agent isn't here.";

const toToken = (row: AgentToken): AgentTokenInfo => ({
  id: row.id,
  prefix: row.prefix,
  scopes: row.scopes,
  createdAt: row.createdAt.getTime(),
  lastUsedAt: row.lastUsedAt?.getTime() ?? null,
  revokedAt: row.revokedAt?.getTime() ?? null,
});

/** What an OAuth agent's rows add up to: when it last worked, what it may do, and whether it is still connected. */
interface Oauth {
  apps: Map<string, string>;
  refresh: Array<{ agentId: string; scopes: AgentToken["scopes"] }>;
}

const toAgent = (agent: Agent, tokens: AgentToken[], oauth: Oauth, owned: boolean): AgentInfo => {
  const own = tokens.filter((token) => token.agentId === agent.id);
  const app = agent.oauthClientId ? oauth.apps.get(agent.oauthClientId) : undefined;
  if (!agent.oauthClientId) {
    return {
      id: agent.id,
      name: agent.name,
      ownerId: agent.ownerId,
      createdAt: agent.createdAt.getTime(),
      tokens: own.map(toToken),
      connection: null,
    };
  }
  const refresh = oauth.refresh.find((row) => row.agentId === agent.id);
  const lastUsed = own.reduce((latest, token) => Math.max(latest, token.lastUsedAt?.getTime() ?? 0), 0);
  return {
    id: agent.id,
    name: agent.name,
    ownerId: agent.ownerId,
    createdAt: agent.createdAt.getTime(),
    // A connection's hourly tokens would only be noise: the app is one row, disconnected as a whole.
    tokens: [],
    connection: {
      app: app ?? agent.name,
      scopes: owned && refresh ? refresh.scopes : [],
      connected: Boolean(refresh),
      connectedAt: agent.createdAt.getTime(),
      lastUsedAt: owned && lastUsed ? lastUsed : null,
    },
  };
};

/** Everyone's agents (so a card can say "via Claude for Alex"); tokens only for the person they belong to. */
async function loadAgents(db: Db, viewerId: string): Promise<AgentInfo[]> {
  const [rows, tokenRows, clients, refresh] = await Promise.all([
    db.select().from(agents).orderBy(asc(agents.createdAt)),
    db.select().from(agentTokens).orderBy(asc(agentTokens.createdAt)),
    db.select({ id: oauthClients.id, name: oauthClients.name }).from(oauthClients),
    db
      .select({ agentId: oauthRefreshTokens.agentId, scopes: oauthRefreshTokens.scopes })
      .from(oauthRefreshTokens)
      .where(gt(oauthRefreshTokens.expiresAt, new Date())),
  ]);
  const oauth: Oauth = { apps: new Map(clients.map((client) => [client.id, client.name])), refresh };
  const mine = new Set(rows.filter((agent) => agent.ownerId === viewerId).map((agent) => agent.id));
  return rows.map((agent) => toAgent(agent, mine.has(agent.id) ? tokenRows : [], oauth, mine.has(agent.id)));
}

/**
 * /api/agents: for signed-in people only (the guard in app.ts refuses tokens). The token
 * itself is returned once, when it is made; only its hash is kept.
 */
export const agentRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json<AgentsResponse>({ agents: await loadAgents(c.var.db, c.var.user.id) }))

  /** A new agent for the signed-in person, with its first token. */
  .post("/", async (c) => {
    const parsed = createAgent.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "An agent needs a name and at least one scope.");
    const db = c.var.db;
    const agentId = parsed.data.id ?? crypto.randomUUID();
    const existing = await db.select().from(agents).where(eq(agents.id, agentId)).get();
    if (existing) return apiError(c, 409, "conflict", "That agent already exists.");
    const issued = await issue(agentId, parsed.data.scopes);
    await db.batch([
      db.insert(agents).values({ id: agentId, name: parsed.data.name, ownerId: c.var.user.id, createdAt: new Date() }),
      db.insert(agentTokens).values(issued.row),
      recordChange(db, { entity: "agent", id: agentId, action: "created", actor: c.var.actor }),
    ]);
    return c.json<NewTokenResponse>(await shown(db, c.var.user.id, agentId, issued), 201);
  })

  /** Another token for an agent of yours (say, a new one before revoking the old). */
  .post("/:id/tokens", async (c) => {
    const parsed = createToken.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "A token needs at least one scope.");
    const db = c.var.db;
    const agentId = c.req.param("id");
    const agent = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, c.var.user.id)))
      .get();
    if (!agent) return apiError(c, 404, "not_found", notFound);
    if (agent.oauthClientId) {
      return apiError(c, 400, "connected_app", "That's an app connected by sign-in: it makes its own tokens.");
    }
    const issued = await issue(agentId, parsed.data.scopes);
    await db.batch([
      db.insert(agentTokens).values(issued.row),
      recordChange(db, { entity: "agent", id: agentId, action: "updated", actor: c.var.actor }),
    ]);
    return c.json<NewTokenResponse>(await shown(db, c.var.user.id, agentId, issued), 201);
  })

  /** Revokes a token: it stops working on its next request. Revoking again changes nothing. */
  .delete("/:id/tokens/:tokenId", async (c) => {
    const db = c.var.db;
    const agentId = c.req.param("id");
    const tokenId = c.req.param("tokenId");
    const owned = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, c.var.user.id)))
      .get();
    if (!owned) return apiError(c, 404, "not_found", notFound);
    const [revoked] = await db.batch([
      db
        .update(agentTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(agentTokens.id, tokenId), eq(agentTokens.agentId, agentId), isNull(agentTokens.revokedAt)))
        .returning({ id: agentTokens.id }),
      recordChange(db, { entity: "agent", id: agentId, action: "updated", actor: c.var.actor }),
    ]);
    if (!revoked.length) {
      const exists = await db
        .select({ id: agentTokens.id })
        .from(agentTokens)
        .where(and(eq(agentTokens.id, tokenId), eq(agentTokens.agentId, agentId)))
        .get();
      if (!exists) return apiError(c, 404, "not_found", "That token isn't here.");
    }
    return c.body(null, 204);
  })

  /** Disconnects an app that signed in with OAuth: every token it holds, refresh tokens included, ends at once. */
  .delete("/:id/connection", async (c) => {
    const db = c.var.db;
    const agentId = c.req.param("id");
    const agent = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, c.var.user.id)))
      .get();
    if (!agent?.oauthClientId) return apiError(c, 404, "not_found", notFound);
    await db.batch([
      ...disconnectAgent(db, agentId),
      recordChange(db, { entity: "agent", id: agentId, action: "updated", actor: c.var.actor }),
    ]);
    return c.body(null, 204);
  });

interface Issued {
  token: string;
  row: typeof agentTokens.$inferInsert;
}

async function issue(agentId: string, tokenScopes: AgentToken["scopes"]): Promise<Issued> {
  const token = generateToken();
  return {
    token,
    row: {
      id: crypto.randomUUID(),
      agentId,
      hash: await hashToken(token),
      prefix: tokenPrefix(token),
      scopes: tokenScopes,
      createdAt: new Date(),
    },
  };
}

async function shown(db: Db, viewerId: string, agentId: string, issued: Issued): Promise<NewTokenResponse> {
  const agent = (await loadAgents(db, viewerId)).find((row) => row.id === agentId);
  if (!agent) throw new Error("The agent went missing.");
  return { agent, tokenId: issued.row.id as string, token: issued.token };
}

/** For the OpenAPI document (worker/openapi). */
export { createAgent, createToken };
