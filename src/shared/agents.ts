/**
 * Agents and their tokens. An agent is a named identity owned by one of the
 * two people ("Claude for Alex", "Printer bridge") that reaches /api with
 * `Authorization: Bearer spg_…`. What a token may do is a small set of scopes.
 */

export const AGENT_SCOPES = ["read", "capture", "attempts", "printer"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

/** What each scope allows, in the words the app shows. */
export const SCOPE_INFO: Record<AgentScope, { label: string; hint: string }> = {
  read: { label: "Read", hint: "See everything: ideas, builds, the journal, search, the pantry." },
  capture: { label: "Capture", hint: "Add ideas, notes and photos." },
  attempts: { label: "Attempts", hint: "Start, log and finish attempts, with their photos and slicer files." },
  printer: { label: "Printer", hint: "Load AMS slots and update spools." },
};

export const isScope = (value: unknown): value is AgentScope =>
  typeof value === "string" && (AGENT_SCOPES as readonly string[]).includes(value);

/** Every token starts with this, so a leaked one is easy to spot and to scan for. */
export const TOKEN_PREFIX = "spg_";
/** How much of a token stays visible afterwards: "spg_" and four more characters. */
export const TOKEN_SHOWN_CHARS = 8;

export interface AgentTokenInfo {
  id: string;
  /** The start of the token, for telling tokens apart: "spg_Ab3x". Never enough to use it. */
  prefix: string;
  scopes: AgentScope[];
  createdAt: number;
  /** Epoch ms; updated at most every few minutes. */
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** An app connected by OAuth (Claude's connector): one connection, not a list of tokens. */
export interface AgentConnection {
  /** What the app called itself when it registered: "Claude". */
  app: string;
  scopes: AgentScope[];
  /** False once it was disconnected (it stays so "via Claude" in the journal still has a name). */
  connected: boolean;
  connectedAt: number;
  /** Epoch ms of the last request with one of its tokens; null if it never made one. */
  lastUsedAt: number | null;
}

export interface AgentInfo {
  id: string;
  name: string;
  /** The person it acts for. */
  ownerId: string;
  createdAt: number;
  /** Only the owner sees their agents' tokens; for anyone else this is empty. */
  tokens: AgentTokenInfo[];
  /** Set for an agent connected by OAuth; its short-lived tokens are not listed, it is disconnected as a whole. */
  connection: AgentConnection | null;
}

export interface AgentsResponse {
  agents: AgentInfo[];
}

/** POST /api/agents and POST /api/agents/:id/tokens: the one time the token itself is shown. */
export interface NewTokenResponse {
  agent: AgentInfo;
  tokenId: string;
  token: string;
}

/** Prefixes of the OAuth credentials: access tokens are `spg_` like any token (so they work wherever one does). */
export const REFRESH_PREFIX = "spr_";
export const CODE_PREFIX = "spc_";

/** A new token: random bytes from WebCrypto, base64url, after the prefix. */
export function generateToken(prefix: string = TOKEN_PREFIX): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return prefix + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What is stored of a token: its SHA-256, hex. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const tokenPrefix = (token: string) => token.slice(0, TOKEN_SHOWN_CHARS);
