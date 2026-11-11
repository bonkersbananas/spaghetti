import { and, count, eq, lt, notExists } from "drizzle-orm";
import { z } from "zod";
import { hashToken } from "../../shared/agents.ts";
import type { Db } from "../db/index.ts";
import { agents, type OauthClient, oauthClients } from "../db/schema.ts";

/** Anyone may register (RFC 7591), so the table stays small: unused clients go after a day, and there is a cap. */
const MAX_CLIENTS = 300;
const UNUSED_AFTER_MS = 24 * 60 * 60 * 1000;

const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:", "blob:", "about:"]);

/**
 * A redirect address an app may register: https, plain http only to this machine (native and desktop apps listen
 * on localhost), or an app's own scheme ("claude://…"). No fragments, and never a scheme that runs code.
 */
export function validRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || BLOCKED_SCHEMES.has(url.protocol)) return false;
  if (url.protocol === "https:") return !url.username && !url.password;
  if (url.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

export const registration = z.object({
  client_name: z.string().trim().max(80).optional(),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  token_endpoint_auth_method: z.enum(["none", "client_secret_post", "client_secret_basic"]).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

/** The name to show for an app: what it called itself, kept short and plain. */
export const appName = (name: string | undefined) => (name?.replace(/\s+/g, " ").trim() || "An app").slice(0, 40);

export type Registered =
  | { ok: true; client: OauthClient; secret?: string }
  | { ok: false; status: 400 | 429; error: string; description: string };

export async function registerClient(db: Db, input: z.infer<typeof registration>): Promise<Registered> {
  if (!input.redirect_uris.every(validRedirectUri)) {
    return {
      ok: false,
      status: 400,
      error: "invalid_redirect_uri",
      description: "Redirect addresses must be https, http on localhost, or an app's own scheme, without a fragment.",
    };
  }
  if (input.grant_types && !input.grant_types.includes("authorization_code")) {
    return {
      ok: false,
      status: 400,
      error: "invalid_client_metadata",
      description: "Only the authorization_code grant is offered.",
    };
  }
  await db
    .delete(oauthClients)
    .where(
      and(
        lt(oauthClients.createdAt, new Date(Date.now() - UNUSED_AFTER_MS)),
        notExists(db.select({ id: agents.id }).from(agents).where(eq(agents.oauthClientId, oauthClients.id))),
      ),
    );
  const total = (await db.select({ total: count() }).from(oauthClients))[0]?.total ?? 0;
  if (total >= MAX_CLIENTS) {
    return {
      ok: false,
      status: 429,
      error: "temporarily_unavailable",
      description: "Too many apps are registered right now.",
    };
  }
  const wantsSecret = input.token_endpoint_auth_method && input.token_endpoint_auth_method !== "none";
  const secret = wantsSecret
    ? `sps_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`
    : undefined;
  const client: OauthClient = {
    id: crypto.randomUUID(),
    name: appName(input.client_name),
    redirectUris: [...new Set(input.redirect_uris)],
    secretHash: secret ? await hashToken(secret) : null,
    createdAt: new Date(),
  };
  await db.insert(oauthClients).values(client);
  return { ok: true, client, secret };
}

export const findClient = (db: Db, id: string) => db.select().from(oauthClients).where(eq(oauthClients.id, id)).get();
