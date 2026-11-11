import { z } from "zod";
import { CODE_PREFIX, generateToken, hashToken } from "../../shared/agents.ts";
import { type AuthorizeParams, CODE_MINUTES, mcpResource, requestedScopes } from "../../shared/oauth.ts";
import type { Db } from "../db/index.ts";
import { type OauthClient, oauthCodes } from "../db/schema.ts";
import { findClient } from "./clients.ts";

export const authorizeParams = z.object({
  response_type: z.string(),
  client_id: z.string().max(100),
  redirect_uri: z.string().max(2000),
  code_challenge: z.string().max(200),
  code_challenge_method: z.string().max(20),
  scope: z.string().max(500).optional(),
  state: z.string().max(2000).optional(),
  resource: z.string().max(2000).optional(),
});

export type Checked =
  | { ok: true; client: OauthClient; params: AuthorizeParams; scopes: ReturnType<typeof requestedScopes> }
  | { ok: false; error: string; description: string };

/** The same address with or without a trailing slash is the same resource. */
const sameResource = (given: string, origin: string) => {
  const trim = (value: string) => value.replace(/\/+$/, "");
  return [trim(mcpResource(origin)), trim(origin)].includes(trim(given));
};

/**
 * Whether an authorization request is one we can ask a person about. Nothing is redirected until the client and the
 * redirect address are known to match: an error before that is shown to the person, never sent anywhere.
 */
export async function checkAuthorizeRequest(db: Db, origin: string, input: unknown): Promise<Checked> {
  const parsed = authorizeParams.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_request", description: "That link is missing something." };
  const params = parsed.data;
  const client = await findClient(db, params.client_id);
  if (!client) return { ok: false, error: "invalid_client", description: "That app isn't registered here." };
  if (!client.redirectUris.includes(params.redirect_uri)) {
    return {
      ok: false,
      error: "invalid_request",
      description: "That app's return address isn't the one it registered.",
    };
  }
  if (params.response_type !== "code") {
    return {
      ok: false,
      error: "unsupported_response_type",
      description: "Only the authorization code flow is offered.",
    };
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge) || params.code_challenge_method !== "S256") {
    return { ok: false, error: "invalid_request", description: "The app must use PKCE with S256." };
  }
  if (params.resource && !sameResource(params.resource, origin)) {
    return { ok: false, error: "invalid_target", description: "That token would be for a different server." };
  }
  return { ok: true, client, params, scopes: requestedScopes(params.scope) };
}

/** Where to send the person back to the app: with a code, or with the reason there isn't one. */
export function returnTo(params: AuthorizeParams, origin: string, result: Record<string, string>): string {
  const url = new URL(params.redirect_uri);
  for (const [key, value] of Object.entries(result)) url.searchParams.set(key, value);
  if (params.state) url.searchParams.set("state", params.state);
  url.searchParams.set("iss", origin);
  return url.toString();
}

/** Makes the one-time code for an approved request and stores its hash. */
export async function issueCode(db: Db, userId: string, checked: Extract<Checked, { ok: true }>): Promise<string> {
  const code = generateToken(CODE_PREFIX);
  await db.insert(oauthCodes).values({
    hash: await hashToken(code),
    clientId: checked.client.id,
    userId,
    scopes: checked.scopes,
    redirectUri: checked.params.redirect_uri,
    codeChallenge: checked.params.code_challenge,
    expiresAt: new Date(Date.now() + CODE_MINUTES * 60 * 1000),
  });
  return code;
}
