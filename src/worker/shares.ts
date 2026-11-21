import { and, eq, isNull } from "drizzle-orm";
import { toBase64Url } from "../shared/base64url.ts";
import { SHARE_TOKEN, SHARE_TOKEN_BYTES, type Share, type ShareKind } from "../shared/shares.ts";
import type { Db } from "./db/index.ts";
import { items, type ShareRow, shares, twists } from "./db/schema.ts";

/**
 * Public links (decision 0075): making a token, finding a link by one, and whether what it points at is still there.
 * The routes are routes/shares.ts (the two people) and guest/ (the page anyone with the link sees).
 */

/** A new link's secret: 144 random bits from the platform's CSPRNG. */
export function newShareToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(SHARE_TOKEN_BYTES)));
}

/** What a token is stored and looked up by: its SHA-256, in hex. */
export async function hashShareToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const toApiShare = (row: ShareRow): Share => ({
  id: row.id,
  kind: row.kind,
  targetId: row.targetId,
  token: row.token,
  createdBy: row.createdBy,
  createdAt: row.createdAt.getTime(),
});

/**
 * The link a token names, live or not, or null. Malformed tokens are refused before any lookup, and the lookup is by
 * the token's hash only, never by the token itself.
 */
export async function shareByToken(db: Db, token: string): Promise<ShareRow | null> {
  if (!SHARE_TOKEN.test(token)) return null;
  const row = await db
    .select()
    .from(shares)
    .where(eq(shares.tokenHash, await hashShareToken(token)))
    .get();
  return row ?? null;
}

/** Whether the thing a link points at exists and isn't deleted; an item's stage says which page it has. */
export async function liveTarget(
  db: Db,
  kind: ShareKind,
  id: string,
): Promise<{ path: string; stage?: string } | null> {
  if (kind === "twist") {
    const twist = await db
      .select({ id: twists.id })
      .from(twists)
      .where(and(eq(twists.id, id), isNull(twists.deletedAt)))
      .get();
    return twist ? { path: `/twists/${twist.id}` } : null;
  }
  const item = await db
    .select({ id: items.id, stage: items.stage })
    .from(items)
    .where(and(eq(items.id, id), isNull(items.deletedAt)))
    .get();
  if (!item) return null;
  return { path: item.stage === "idea" ? `/ideas/${item.id}` : `/builds/${item.id}`, stage: item.stage };
}
