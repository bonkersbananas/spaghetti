import type { Context } from "hono";
import { toBase64Url } from "../../shared/base64url.ts";
import { CHALLENGE_TTL_MS } from "../../shared/signing-in.ts";
import type { AppEnv } from "../env.ts";

/** The app's name as an authenticator shows it. */
export const RP_NAME = "Spaghetti";

/**
 * The relying party, from configuration (`WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS` in wrangler.jsonc: spaghetti.day
 * in production; `localhost` for the dev server, the e2e tests and `pnpm start`). An origin entry written
 * `http://localhost:*` allows any local port, and nothing else is ever allowed a wildcard.
 */
export function relyingParty(c: Context<AppEnv>): { rpID: string; origins: string[] } {
  const rpID: string = c.env.WEBAUTHN_RP_ID;
  const requested = c.req.header("origin");
  const origins: string[] = [];
  for (const entry of c.env.WEBAUTHN_ORIGINS.split(",")) {
    const origin = entry.trim();
    if (!origin) continue;
    if (origin.endsWith(":*")) {
      const base = origin.slice(0, -1);
      if (rpID === "localhost" && base === "http://localhost:" && requested?.startsWith(base)) {
        if (/^\d{1,5}$/.test(requested.slice(base.length))) origins.push(requested);
      }
    } else origins.push(origin);
  }
  return { rpID, origins };
}

/** Makes a challenge's row id: opaque, random, never the challenge itself. */
function randomId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
}

export interface ChallengeBinding {
  purpose: "register" | "authenticate" | "invite";
  userId?: string;
  inviteId?: string;
}

/** Stores a challenge for one ceremony and returns the id the browser sends back with its answer. */
export async function saveChallenge(c: Context<AppEnv>, challenge: string, binding: ChallengeBinding): Promise<string> {
  const id = randomId();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM webauthn_challenges WHERE expires_at < ?").bind(now),
    c.env.DB.prepare(
      "INSERT INTO webauthn_challenges (id, challenge, purpose, user_id, invite_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(id, challenge, binding.purpose, binding.userId ?? null, binding.inviteId ?? null, now + CHALLENGE_TTL_MS),
  ]);
  return id;
}

/**
 * Takes a challenge: it is deleted as it is read, so it can be answered once, and only for what it
 * was made for. Null for an unknown, used, expired or differently-bound one.
 */
export async function takeChallenge(
  c: Context<AppEnv>,
  id: string,
  binding: ChallengeBinding,
): Promise<{ challenge: string; userId: string | null } | null> {
  const row = await c.env.DB.prepare(
    "DELETE FROM webauthn_challenges WHERE id = ? RETURNING challenge, purpose, user_id, invite_id, expires_at",
  )
    .bind(id)
    .first<{
      challenge: string;
      purpose: string;
      user_id: string | null;
      invite_id: string | null;
      expires_at: number;
    }>();
  if (!row || row.expires_at < Date.now()) return null;
  if (row.purpose !== binding.purpose) return null;
  if (binding.userId !== undefined && row.user_id !== binding.userId) return null;
  if (binding.inviteId !== undefined && row.invite_id !== binding.inviteId) return null;
  return { challenge: row.challenge, userId: row.user_id };
}

// --- rate limits ---------------------------------------------------------------------------------

export const WINDOW_MS = 15 * 60 * 1000;

/** Where a request comes from, for rate limits (Cloudflare sets this; locally everyone is "local"). */
export const clientKey = (c: Context<AppEnv>) => c.req.header("cf-connecting-ip") ?? "local";

/**
 * Records one try in `bucket` unless the window already holds `limit` of them: false means "too many".
 * One statement, so parallel guesses can't all read a low count first.
 */
export async function takeHit(c: Context<AppEnv>, bucket: string, limit: number, windowMs = WINDOW_MS) {
  const now = Date.now();
  const [, taken] = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM auth_hits WHERE at < ?").bind(now - 24 * 60 * 60 * 1000),
    c.env.DB.prepare(
      "INSERT INTO auth_hits (bucket, at) SELECT ?1, ?2 WHERE (SELECT count(*) FROM auth_hits WHERE bucket = ?1 AND at > ?3) < ?4",
    ).bind(bucket, now, now - windowMs, limit),
  ]);
  return Boolean(taken?.meta.changes);
}

/** How many tries `bucket` holds in the window, without adding one. */
export async function hitsIn(c: Context<AppEnv>, bucket: string, windowMs = WINDOW_MS): Promise<number> {
  const row = await c.env.DB.prepare("SELECT count(*) AS n FROM auth_hits WHERE bucket = ? AND at > ?")
    .bind(bucket, Date.now() - windowMs)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** SHA-256 of a secret, hex: what is stored in place of a token or code. */
export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
