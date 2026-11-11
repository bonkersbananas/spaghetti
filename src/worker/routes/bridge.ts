import { and, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import { z } from "zod";
import {
  BRIDGE_SCOPES,
  normalizePairingCode,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_MINUTES,
  type PairingResponse,
  type PairResponse,
  showPairingCode,
} from "../../shared/bridge.ts";
import { clientKey, hashSecret, takeHit } from "../auth/webauthn.ts";
import { actorOf, recordChange } from "../changes.ts";
import type { Db } from "../db/index.ts";
import { agents, agentTokens, bridge, bridgePairings, users } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { issue } from "./agents.ts";

const WINDOW_MS = 10 * 60_000;
const BRIDGE_AGENT_NAME = "Printer bridge";

/** Eight characters from an alphabet without look-alikes (no 0/O, 1/I/L): about 40 bits, rejection-sampled. */
export function makePairingCode(): string {
  const alphabet = PAIRING_CODE_ALPHABET;
  const limit = 256 - (256 % alphabet.length);
  let code = "";
  while (code.length < PAIRING_CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit && code.length < PAIRING_CODE_LENGTH) code += alphabet[byte % alphabet.length];
    }
  }
  return code;
}

/** The agents a bridge has paired as, for the person: the ones its tokens are revoked on disconnect or re-pairing. */
async function bridgeAgentIds(db: Db, ownerId?: string): Promise<string[]> {
  const rows = await db
    .select({ agentId: bridgePairings.agentId })
    .from(bridgePairings)
    .where(and(isNotNull(bridgePairings.agentId), ownerId ? eq(bridgePairings.createdBy, ownerId) : undefined))
    .orderBy(desc(bridgePairings.createdAt));
  const current = await db.select({ agentId: bridge.agentId }).from(bridge).get();
  return [...new Set([...rows.map((row) => row.agentId as string), ...(current?.agentId ? [current.agentId] : [])])];
}

/** Ends the bridge's tokens and forgets its last message: the Printer page goes back to "No printer bridge". */
export async function disconnectBridge(db: Db, actor: ReturnType<typeof actorOf>) {
  const ids = await bridgeAgentIds(db);
  const now = new Date();
  const writes: BatchItem<"sqlite">[] = [];
  if (ids.length) {
    writes.push(
      db
        .update(agentTokens)
        .set({ revokedAt: now })
        .where(and(inArray(agentTokens.agentId, ids), isNull(agentTokens.revokedAt))),
    );
  }
  writes.push(db.delete(bridge), recordChange(db, { entity: "printer", id: "bridge", action: "updated", actor }));
  await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

const pairBody = z.object({ code: z.string().min(1).max(40) });

/** For people: a code the installer on the Mac exchanges for the bridge's token. */
export const bridgeRoutes = new Hono<AppEnv>().post("/pairing", async (c) => {
  const user = c.var.user;
  // A person has little use for more than a few; the cap also stops a loop from filling the table.
  if (!(await takeHit(c, `pairing:${user.id}`, 6, WINDOW_MS))) {
    return apiError(c, 429, "rate_limited", "That's a lot of codes. Wait a few minutes, or use the one you have.");
  }
  const db = c.var.db;
  const now = Date.now();
  const code = makePairingCode();
  const expiresAt = now + PAIRING_MINUTES * 60_000;
  await db.batch([
    // One live code per person: a new one replaces the old.
    db
      .update(bridgePairings)
      .set({ expiresAt: new Date(now) })
      .where(
        and(
          eq(bridgePairings.createdBy, user.id),
          isNull(bridgePairings.usedAt),
          gt(bridgePairings.expiresAt, new Date(now)),
        ),
      ),
    db.insert(bridgePairings).values({
      id: crypto.randomUUID(),
      codeHash: await hashSecret(code),
      createdBy: user.id,
      createdAt: new Date(now),
      expiresAt: new Date(expiresAt),
    }),
  ]);
  return c.json<PairingResponse>({ code: showPairingCode(code), expiresAt }, 201);
});

/**
 * For the installer, with nobody signed in: the code is the way in. Rate limited per caller and overall, the code is
 * claimed once (an atomic UPDATE), and what comes back is a token that never appears in the command or its history.
 */
export const bridgePairRoutes = new Hono<AppEnv>().post("/pair", async (c) => {
  const slow = () =>
    apiError(c, 429, "rate_limited", "Too many tries. Wait a few minutes and ask the app for a new code.");
  if (!(await takeHit(c, `pair:${clientKey(c)}`, 10, WINDOW_MS))) return slow();
  if (!(await takeHit(c, "pair:all", 60, WINDOW_MS))) return slow();
  const gone = () => apiError(c, 410, "code_gone", "That code was used or has expired. Ask the app for a new one.");
  const parsed = pairBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return gone();
  const code = normalizePairingCode(parsed.data.code);
  if (code.length !== PAIRING_CODE_LENGTH) return gone();
  const db = c.var.db;
  const now = new Date();
  const claimed = await db
    .update(bridgePairings)
    .set({ usedAt: now })
    .where(
      and(
        eq(bridgePairings.codeHash, await hashSecret(code)),
        isNull(bridgePairings.usedAt),
        gt(bridgePairings.expiresAt, now),
      ),
    )
    .returning({ id: bridgePairings.id, createdBy: bridgePairings.createdBy })
    .get();
  if (!claimed) return gone();
  const owner = await db.select().from(users).where(eq(users.id, claimed.createdBy)).get();
  if (!owner) return gone();

  // The same agent again if this person paired a bridge before (so "via Printer bridge" stays one name), with the
  // old tokens ended: pairing again replaces the bridge.
  const known = await bridgeAgentIds(db, owner.id);
  const existing = known.length
    ? await db
        .select()
        .from(agents)
        .where(and(inArray(agents.id, known), eq(agents.ownerId, owner.id)))
        .get()
    : undefined;
  const agentId = existing?.id ?? crypto.randomUUID();
  const issued = await issue(agentId, [...BRIDGE_SCOPES]);
  const writes: BatchItem<"sqlite">[] = [];
  if (existing) {
    writes.push(
      db
        .update(agentTokens)
        .set({ revokedAt: now })
        .where(and(eq(agentTokens.agentId, agentId), isNull(agentTokens.revokedAt))),
    );
  } else
    writes.push(db.insert(agents).values({ id: agentId, name: BRIDGE_AGENT_NAME, ownerId: owner.id, createdAt: now }));
  writes.push(
    db.insert(agentTokens).values(issued.row),
    db.update(bridgePairings).set({ agentId }).where(eq(bridgePairings.id, claimed.id)),
    recordChange(db, { entity: "agent", id: agentId, action: existing ? "updated" : "created", actor: actorOf(owner) }),
  );
  await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return c.json<PairResponse>({
    token: issued.token,
    agentId,
    appUrl: new URL(c.req.url).origin,
    scopes: [...BRIDGE_SCOPES],
  });
});
