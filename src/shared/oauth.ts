/**
 * OAuth for the MCP server (decision 0029): what the consent screen and the Worker agree on. The scopes are the
 * agent scopes (`shared/agents.ts`), so what a connected app may do reads the same as what a typed-in token may.
 */
import { AGENT_SCOPES, type AgentScope, isScope } from "./agents.ts";

/** How long an access token lives; the app renews it with its refresh token. */
export const ACCESS_TOKEN_SECONDS = 60 * 60;
/** A refresh token's life; each use makes a fresh one, so an app in regular use stays connected. */
export const REFRESH_TOKEN_DAYS = 60;
/** The one-time code from the consent screen to the app. */
export const CODE_MINUTES = 5;

/** The address of the MCP server, which is what a token is for (RFC 8707's `resource`). */
export const mcpResource = (origin: string) => `${origin}/mcp`;

/**
 * The scopes a request names ("read capture"), in our order. Words we don't know are ignored, because some clients
 * send their own ("offline_access"); asking for nothing means everything, which the consent screen then shows.
 */
export function requestedScopes(scope: string | null | undefined): AgentScope[] {
  const words = (scope ?? "").split(/[\s,]+/).filter(Boolean);
  const named = AGENT_SCOPES.filter((candidate) => words.includes(candidate));
  return named.length ? named : [...AGENT_SCOPES];
}

/** What the consent screen asks, as the query of its address and the body of the decision. */
export interface AuthorizeParams {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope?: string;
  state?: string;
  resource?: string;
}

/** GET /api/oauth/request: who asks, and for what. */
export interface AuthorizeRequestInfo {
  app: string;
  /** Where the app will be sent back to, as a host to show ("claude.ai"), so a lookalike name is easy to spot. */
  returnsTo: string;
  scopes: AgentScope[];
}

export { isScope };
