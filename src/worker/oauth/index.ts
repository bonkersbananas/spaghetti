import { and, eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { AGENT_SCOPES, type AgentScope, hashToken, isScope } from "../../shared/agents.ts";
import { mcpResource } from "../../shared/oauth.ts";
import { getDb } from "../db/index.ts";
import { agents, agentTokens, oauthCodes, oauthRefreshTokens, users } from "../db/schema.ts";
import { appName, findClient, registerClient, registration } from "./clients.ts";
import { disconnectAgent, issueGrant } from "./grants.ts";

/**
 * OAuth 2.1 for the MCP server, so Claude's apps can connect with a sign-in (decision 0029): the metadata clients
 * discover it by (RFC 9728 and 8414), dynamic client registration (7591), the token endpoint (authorization code
 * with PKCE S256, and refresh with rotation) and revocation (7009). The consent screen is the app's own page,
 * /authorize, and its calls are in routes/oauth.ts. An approved app becomes an agent whose tokens live in
 * `agent_tokens` like any other, so scopes, "via" and the change feed need nothing new.
 */

const originOf = (url: string) => new URL(url).origin;

/** The error body every endpoint here answers with (RFC 6749 section 5.2). */
const failure = (error: string, description: string, status: 400 | 401 | 429 = 400) =>
  new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

/** base64url of the SHA-256 of a PKCE verifier. */
async function challengeOf(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The form fields (or JSON) of a request to the token or revocation endpoint. */
async function readFields(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  if (type.includes("application/json")) {
    const json = await request.json().catch(() => null);
    if (json && typeof json === "object") {
      for (const [key, value] of Object.entries(json)) if (typeof value === "string") out[key] = value;
    }
    return out;
  }
  const form = await request.formData().catch(() => null);
  form?.forEach((value, key) => {
    if (typeof value === "string") out[key] = value;
  });
  return out;
}

const timingSafe = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** The client making a request: its id and, if it has one, its secret (in the body or as Basic auth). */
function clientCredentials(request: Request, fields: Record<string, string>) {
  const basic = /^Basic\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (basic) {
    try {
      const [id, ...rest] = atob(basic).split(":");
      return { id: decodeURIComponent(id ?? ""), secret: decodeURIComponent(rest.join(":")) };
    } catch {
      return { id: "", secret: "" };
    }
  }
  return { id: fields.client_id ?? "", secret: fields.client_secret };
}

export const oauthEndpoints = new Hono<{ Bindings: Env }>()
  // Browser-based clients (the MCP inspector) call these from another origin; none of it uses cookies.
  .use("/.well-known/*", cors({ origin: "*" }))
  .use("/oauth/*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization"] }))

  // RFC 9728: what the MCP server is, and who may issue tokens for it. Also served under /mcp, where clients look first.
  .get("/.well-known/oauth-protected-resource/:rest{.*}?", (c) => {
    const origin = originOf(c.req.url);
    return c.json({
      resource: mcpResource(origin),
      authorization_servers: [origin],
      scopes_supported: AGENT_SCOPES,
      bearer_methods_supported: ["header"],
      resource_name: "Spaghetti",
    });
  })

  // RFC 8414.
  .get("/.well-known/oauth-authorization-server/:rest{.*}?", (c) => {
    const origin = originOf(c.req.url);
    return c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      scopes_supported: AGENT_SCOPES,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      authorization_response_iss_parameter_supported: true,
    });
  })

  // RFC 7591.
  .post("/oauth/register", async (c) => {
    const db = getDb(c.env.DB);
    const parsed = registration.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return failure("invalid_client_metadata", "Send JSON with a client_name and redirect_uris.");
    const made = await registerClient(db, parsed.data);
    if (!made.ok) return failure(made.error, made.description, made.status);
    const { client, secret } = made;
    return c.json(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: secret ? (parsed.data.token_endpoint_auth_method ?? "client_secret_post") : "none",
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      },
      201,
      noStore,
    );
  })

  .post("/oauth/token", async (c) => {
    const db = getDb(c.env.DB);
    const fields = await readFields(c.req.raw);
    const credentials = clientCredentials(c.req.raw, fields);
    const client = credentials.id ? await findClient(db, credentials.id) : undefined;
    if (!client) return failure("invalid_client", "That app isn't registered here.", 401);
    if (
      client.secretHash &&
      !(credentials.secret && timingSafe(await hashToken(credentials.secret), client.secretHash))
    ) {
      return failure("invalid_client", "The client secret is wrong.", 401);
    }
    const origin = originOf(c.req.url);
    if (fields.resource && ![mcpResource(origin), origin].includes(fields.resource.replace(/\/+$/, ""))) {
      return failure("invalid_target", "That token would be for a different server.");
    }

    // The scopes asked for, which must be within what was granted.
    const narrowed = (granted: AgentScope[]): AgentScope[] | null => {
      if (fields.scope === undefined) return granted;
      const words = fields.scope.split(/\s+/).filter(Boolean);
      if (!words.every((word) => isScope(word) && granted.includes(word))) return null;
      return granted.filter((scope) => words.includes(scope));
    };

    let agentId: string;
    let scopes: AgentScope[];
    let approved: AgentScope[] | undefined;
    if (fields.grant_type === "authorization_code") {
      if (!fields.code || !fields.code_verifier || !fields.redirect_uri) {
        return failure("invalid_request", "A code, its redirect_uri and the code_verifier are needed.");
      }
      // One use: the delete is the check, so a code can't be exchanged twice, even at the same moment.
      const row = await db
        .delete(oauthCodes)
        .where(eq(oauthCodes.hash, await hashToken(fields.code)))
        .returning()
        .get();
      const bad = (why: string) => failure("invalid_grant", why);
      if (!row || row.expiresAt.getTime() < Date.now()) return bad("That code is unknown, used or expired.");
      if (row.clientId !== client.id || row.redirectUri !== fields.redirect_uri)
        return bad("That code was made for another app or address.");
      if (
        !/^[A-Za-z0-9._~-]{43,128}$/.test(fields.code_verifier) ||
        !timingSafe(await challengeOf(fields.code_verifier), row.codeChallenge)
      ) {
        return bad("The code_verifier doesn't match the challenge.");
      }
      const wanted = narrowed(row.scopes);
      if (!wanted) return failure("invalid_scope", "That asks for more than was approved.");
      scopes = wanted;
      const owner = await db.select().from(users).where(eq(users.id, row.userId)).get();
      if (!owner) return bad("That person is gone.");
      // One agent per person and app: connecting again picks the same one up, so "via Claude" stays one name.
      const existing = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.ownerId, owner.id), eq(agents.oauthClientId, client.id)))
        .get();
      agentId = existing?.id ?? crypto.randomUUID();
      if (!existing) {
        await db.insert(agents).values({
          id: agentId,
          name: `${appName(client.name)} for ${owner.name}`.slice(0, 60),
          ownerId: owner.id,
          createdAt: new Date(),
          oauthClientId: client.id,
        });
      }
    } else if (fields.grant_type === "refresh_token") {
      if (!fields.refresh_token) return failure("invalid_request", "A refresh_token is needed.");
      // Used once: it is deleted as it is read, and the answer carries its replacement.
      const row = await db
        .delete(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.hash, await hashToken(fields.refresh_token)))
        .returning()
        .get();
      if (!row || row.expiresAt.getTime() < Date.now())
        return failure("invalid_grant", "That refresh token is unknown, used or expired.");
      const agent = await db.select().from(agents).where(eq(agents.id, row.agentId)).get();
      if (!agent || agent.oauthClientId !== client.id)
        return failure("invalid_grant", "That refresh token belongs to another app.");
      const wanted = narrowed(row.scopes);
      if (!wanted) return failure("invalid_scope", "That asks for more than was approved.");
      agentId = agent.id;
      scopes = wanted;
      approved = row.scopes;
      // Spent access tokens needn't be kept.
      await db.delete(agentTokens).where(and(eq(agentTokens.agentId, agentId), lt(agentTokens.expiresAt, new Date())));
    } else {
      return failure("unsupported_grant_type", "Use authorization_code or refresh_token.");
    }

    const grant = await issueGrant(db, agentId, scopes, approved);
    await db.batch(grant.statements);
    return c.json(tokenResponse(grant, scopes), 200, noStore);
  })

  // RFC 7009: ends the app's connection. Always 200, even for a token that isn't known.
  .post("/oauth/revoke", async (c) => {
    const db = getDb(c.env.DB);
    const fields = await readFields(c.req.raw);
    const token = fields.token;
    if (token) {
      const hash = await hashToken(token);
      const refresh = await db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.hash, hash)).get();
      const access = refresh ? undefined : await db.select().from(agentTokens).where(eq(agentTokens.hash, hash)).get();
      const agentId = refresh?.agentId ?? access?.agentId;
      const agent = agentId ? await db.select().from(agents).where(eq(agents.id, agentId)).get() : undefined;
      if (agent?.oauthClientId) {
        const credentials = clientCredentials(c.req.raw, fields);
        const client = await findClient(db, agent.oauthClientId);
        const secretOk =
          !client?.secretHash ||
          (credentials.secret && timingSafe(await hashToken(credentials.secret), client.secretHash));
        if (client && credentials.id === client.id && secretOk) await db.batch([...disconnectAgent(db, agent.id)]);
      }
    }
    return c.body(null, 200, noStore);
  });

function tokenResponse(grant: { accessToken: string; refreshToken: string; expiresIn: number }, scopes: AgentScope[]) {
  return {
    access_token: grant.accessToken,
    token_type: "Bearer",
    expires_in: grant.expiresIn,
    refresh_token: grant.refreshToken,
    scope: scopes.join(" "),
  };
}
