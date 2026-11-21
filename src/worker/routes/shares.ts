import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { ShareKind, ShareResponse, SharesResponse } from "../../shared/shares.ts";
import { recordChange } from "../changes.ts";
import { shares } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { hashShareToken, liveTarget, newShareToken, toApiShare } from "../shares.ts";

/** The path's plural, as the app's own addresses say it. */
const KINDS: Record<string, ShareKind> = { items: "item", twists: "twist" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /api/shares: the two people's public links (decision 0075). People only: no agent scope lists these routes
 * (auth/scopes.ts), so a token can neither see a link's secret nor make one. Every write records a `share` change,
 * which is private to the people (shared/changes.ts): it never reaches an agent's feed or a webhook.
 */
export const shareRoutes = new Hono<AppEnv>()
  /** Every live link, newest first. */
  .get("/", async (c) => {
    const rows = await c.var.db.select().from(shares).where(isNull(shares.revokedAt)).orderBy(desc(shares.createdAt));
    return c.json<SharesResponse>({ shares: rows.map(toApiShare) });
  })

  /**
   * Makes the thing's public link, or answers with the live one it already has (so a retry, or both people at once,
   * end with one link). A link stopped earlier stays stopped: a new one gets a new token.
   */
  .put("/:kind/:id", async (c) => {
    const kind = KINDS[c.req.param("kind")];
    const targetId = c.req.param("id");
    if (!kind || !UUID.test(targetId)) return apiError(c, 404, "not_found", "That isn't here any more.");
    const db = c.var.db;
    if (!(await liveTarget(db, kind, targetId))) return apiError(c, 404, "not_found", "That isn't here any more.");
    const id = crypto.randomUUID();
    const token = newShareToken();
    await db.batch([
      // The partial unique index (one live link per thing) makes a second insert do nothing.
      db
        .insert(shares)
        .values({
          id,
          kind,
          targetId,
          token,
          tokenHash: await hashShareToken(token),
          createdBy: c.var.user.id,
          createdAt: new Date(),
        })
        .onConflictDoNothing(),
      recordChange(db, { entity: "share", id, action: "created", actor: c.var.actor }),
    ]);
    const live = await db
      .select()
      .from(shares)
      .where(and(eq(shares.kind, kind), eq(shares.targetId, targetId), isNull(shares.revokedAt)))
      .get();
    if (!live) return apiError(c, 409, "conflict", "That link couldn't be made. Try again.");
    return c.json<ShareResponse>({ share: toApiShare(live) }, live.id === id ? 201 : 200);
  })

  /** Stops a link at once: its page and photos answer "not shared" from the next request. Undo is /restore. */
  .delete("/:id", async (c) => {
    const shareId = c.req.param("id");
    const db = c.var.db;
    await db.batch([
      db
        .update(shares)
        .set({ revokedAt: new Date() })
        .where(and(eq(shares.id, shareId), isNull(shares.revokedAt))),
      recordChange(db, { entity: "share", id: shareId, action: "deleted", actor: c.var.actor }),
    ]);
    const row = await db.select({ id: shares.id }).from(shares).where(eq(shares.id, shareId)).get();
    if (!row) return apiError(c, 404, "not_found", "That link isn't here.");
    return c.body(null, 204);
  })

  /** The Undo of stopping: the same link works again, unless the thing got a new link in the meantime. */
  .post("/:id/restore", async (c) => {
    const shareId = c.req.param("id");
    const db = c.var.db;
    const row = await db.select().from(shares).where(eq(shares.id, shareId)).get();
    if (!row) return apiError(c, 404, "not_found", "That link isn't here.");
    if (row.revokedAt) {
      try {
        await db.batch([
          db
            .update(shares)
            .set({ revokedAt: null })
            .where(and(eq(shares.id, shareId), isNotNull(shares.revokedAt))),
          recordChange(db, { entity: "share", id: shareId, action: "restored", actor: c.var.actor }),
        ]);
      } catch {
        // The one-live-link index: someone made a new link since.
        return apiError(c, 409, "shared_again", "It has a new link since. Copy that one instead.");
      }
    }
    const live = await db.select().from(shares).where(eq(shares.id, shareId)).get();
    if (!live || live.revokedAt) return apiError(c, 409, "shared_again", "It has a new link since.");
    return c.json<ShareResponse>({ share: toApiShare(live) });
  });
