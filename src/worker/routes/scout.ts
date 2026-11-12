import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { ScoutPick, ScoutResponse } from "../../shared/scout.ts";
import { mondayOf } from "../../shared/week.ts";
import { recordChange } from "../changes.ts";
import type { Db } from "../db/index.ts";
import { items, photos, scoutPicks } from "../db/schema.ts";
import { draftsEnabled, runDraft, startDraft } from "../draft/run.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { readImage } from "../mcp/image.ts";
import { photoKey } from "../photos.ts";
import { claimScoutRound, loadScout, runScout, scoutEnabled, scoutPictureKey, toApiPick } from "../scout/run.ts";
import { NEUTRAL, photoIdFor } from "./capture.ts";

const pickId = z.uuid();
const keepBody = z.object({ itemId: z.uuid() });

const gone = "That suggestion isn't here any more.";

/**
 * The idea scout (decision 0040). Reading is for anyone who can read (an agent's token too: it may see the
 * suggestions); keeping, dismissing and their undos are people only (nothing here is a write in auth/scopes.ts), so
 * an agent never acts on a suggestion. Without ANTHROPIC_API_KEY everything answers 404 and the app never offers it.
 */
export const scoutRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    if (!scoutEnabled(c.env)) return apiError(c, 404, "not_found", "The idea scout isn't set up.");
    await next();
  })
  .get("/", async (c) => {
    const now = Date.now();
    // Locally there is no cron: while the Worker talks to a stand-in Claude, a visit makes the week's round.
    if (c.env.ANTHROPIC_BASE_URL?.trim() && (await claimScoutRound(c.env, now, c.var.db).catch(() => null))) {
      await runScout(c.env, mondayOf(now), { now, db: c.var.db });
    }
    return c.json<ScoutResponse>({ scout: await loadScout(c.var.db, now) });
  })
  .get("/:id/picture", async (c) => {
    const row = await c.var.db
      .select()
      .from(scoutPicks)
      .where(eq(scoutPicks.id, c.req.param("id")))
      .get();
    const object = row?.pictureType ? await c.env.PHOTOS.get(scoutPictureKey(row.id)) : null;
    if (!row || !object) return apiError(c, 404, "not_found", gone);
    return new Response(object.body, {
      headers: {
        "Content-Type": row.pictureType ?? "image/jpeg",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  })
  /**
   * Keep: the suggestion becomes an idea (the client picks its id), with its link and its picture, and Claude drafts
   * the rest from the link like any pasted model link (decision 0019). Asking again with the same id finds it done.
   */
  .put("/:id/keep", async (c) => {
    const parsed = keepBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !pickId.safeParse(c.req.param("id")).success) {
      return apiError(c, 400, "invalid", "That couldn't be read.");
    }
    const { id } = c.req.param();
    const db = c.var.db;
    const pick = await db.select().from(scoutPicks).where(eq(scoutPicks.id, id)).get();
    if (!pick) return apiError(c, 404, "not_found", gone);
    if (pick.status === "kept" && pick.itemId === parsed.data.itemId) {
      return c.json<{ pick: ScoutPick }>({ pick: toApiPick(pick) });
    }
    if (pick.status !== "suggested") return apiError(c, 409, "decided", "That one has been answered already.");
    const itemId = parsed.data.itemId;
    const now = new Date();
    // The idea first, then the claim on the suggestion: a retry after a half-finished keep finds the idea there.
    const [, , decided] = await db.batch([
      db
        .insert(items)
        .values({
          id: itemId,
          stage: "idea",
          title: pick.title,
          note: pick.url,
          createdBy: c.var.user.id,
          createdVia: c.var.via,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing(),
      recordChange(db, { entity: "item", id: itemId, itemId, action: "created", actor: c.var.actor }),
      db
        .update(scoutPicks)
        .set({ status: "kept", itemId, decidedBy: c.var.user.id, decidedAt: now })
        .where(and(eq(scoutPicks.id, id), eq(scoutPicks.status, "suggested")))
        .returning({ id: scoutPicks.id }),
      recordChange(db, { entity: "scout", id: pick.monday, itemId: null, action: "updated", actor: c.var.actor }),
    ]);
    if (!decided.length) {
      // The other person answered at the same moment: take the idea this made back.
      await db.update(items).set({ deletedAt: new Date() }).where(eq(items.id, itemId));
      return apiError(c, 409, "decided", "That one has been answered already.");
    }
    await copyPicture(c.env, db, pick, itemId, c.var.user.id);
    // The rest of the idea is drafted from its link, like any model link someone pastes.
    if (draftsEnabled(c.env) && (await startDraft(db, itemId, pick.url, c.var.user, null).catch(() => false))) {
      try {
        c.executionCtx.waitUntil(runDraft(c.env, itemId, db));
      } catch {
        // No execution context (a test): the cron's fallback does it.
      }
    }
    const row = await db.select().from(scoutPicks).where(eq(scoutPicks.id, id)).get();
    return c.json<{ pick: ScoutPick }>({ pick: toApiPick(row ?? pick) });
  })
  /** Undo for Keep: the idea it made goes to the bin (with the app's own undo) and the suggestion is waiting again. */
  .delete("/:id/keep", async (c) => {
    const { id } = c.req.param();
    const db = c.var.db;
    const pick = await db.select().from(scoutPicks).where(eq(scoutPicks.id, id)).get();
    if (!pick) return apiError(c, 404, "not_found", gone);
    if (pick.status === "kept" && pick.itemId) {
      const itemId = pick.itemId;
      await db.batch([
        // Only an idea nobody has touched since: one that was started is theirs now.
        db
          .update(items)
          .set({ deletedAt: new Date() })
          .where(and(eq(items.id, itemId), eq(items.stage, "idea"), isNull(items.deletedAt))),
        recordChange(db, { entity: "item", id: itemId, itemId, action: "deleted", actor: c.var.actor }),
        db
          .update(scoutPicks)
          .set({ status: "suggested", itemId: null, decidedBy: null, decidedAt: null })
          .where(and(eq(scoutPicks.id, id), eq(scoutPicks.status, "kept"))),
        recordChange(db, { entity: "scout", id: pick.monday, itemId: null, action: "updated", actor: c.var.actor }),
      ]);
    }
    const row = await db.select().from(scoutPicks).where(eq(scoutPicks.id, id)).get();
    return c.json<{ pick: ScoutPick }>({ pick: toApiPick(row ?? pick) });
  })
  /** "Not for us": the suggestion is put away, and the scout never suggests that model again. */
  .put("/:id/dismiss", async (c) => {
    const { id } = c.req.param();
    const db = c.var.db;
    const pick = await db.select().from(scoutPicks).where(eq(scoutPicks.id, id)).get();
    if (!pick) return apiError(c, 404, "not_found", gone);
    if (pick.status === "suggested") {
      await db.batch([
        db
          .update(scoutPicks)
          .set({ status: "dismissed", decidedBy: c.var.user.id, decidedAt: new Date() })
          .where(and(eq(scoutPicks.id, id), eq(scoutPicks.status, "suggested"))),
        recordChange(db, { entity: "scout", id: pick.monday, itemId: null, action: "updated", actor: c.var.actor }),
      ]);
    }
    const row = await db.select().from(scoutPicks).where(eq(scoutPicks.id, id)).get();
    return c.json<{ pick: ScoutPick }>({ pick: toApiPick(row ?? pick) });
  })
  .delete("/:id/dismiss", async (c) => {
    const { id } = c.req.param();
    const db = c.var.db;
    const pick = await db.select().from(scoutPicks).where(eq(scoutPicks.id, id)).get();
    if (!pick) return apiError(c, 404, "not_found", gone);
    if (pick.status === "dismissed") {
      await db.batch([
        db
          .update(scoutPicks)
          .set({ status: "suggested", decidedBy: null, decidedAt: null })
          .where(and(eq(scoutPicks.id, id), eq(scoutPicks.status, "dismissed"))),
        recordChange(db, { entity: "scout", id: pick.monday, itemId: null, action: "updated", actor: c.var.actor }),
      ]);
    }
    const row = await db.select().from(scoutPicks).where(eq(scoutPicks.id, id)).get();
    return c.json<{ pick: ScoutPick }>({ pick: toApiPick(row ?? pick) });
  });

/** The suggestion's picture becomes the new idea's first photo (needing a browser's resize, like any drafted one). */
async function copyPicture(env: Env, db: Db, pick: typeof scoutPicks.$inferSelect, itemId: string, owner: string) {
  if (!pick.pictureType) return;
  const object = await env.PHOTOS.get(scoutPictureKey(pick.id));
  if (!object) return;
  const image = readImage(new Uint8Array(await object.arrayBuffer()));
  const photoId = await photoIdFor(itemId, 0);
  const httpMetadata = { contentType: image.contentType };
  const customMetadata = { provisional: "1" };
  await Promise.all(
    (["large", "thumb"] as const).map((variant) =>
      env.PHOTOS.put(photoKey(photoId, variant), image.bytes, { httpMetadata, customMetadata }),
    ),
  );
  const now = new Date();
  await db.batch([
    db
      .insert(photos)
      .values({
        id: photoId,
        itemId,
        position: 0,
        width: image.width,
        height: image.height,
        color: NEUTRAL,
        contentType: image.contentType,
        needsResize: true,
        createdBy: owner,
        createdAt: now,
      })
      .onConflictDoNothing(),
    recordChange(db, { entity: "photo", id: photoId, itemId, action: "created", actor: { kind: "person", id: owner } }),
  ]);
}

export { keepBody as scoutKeepBody };
