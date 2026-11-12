import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { type EmojiUse, isEmoji, LEGACY_REACTIONS, type Reaction } from "../../shared/reactions.ts";
import { recordChange } from "../changes.ts";
import type { Db } from "../db/index.ts";
import { comments, items, type ReactionRow, reactions } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";

const notFound = "That isn't here any more.";

export const toApiReaction = (row: Pick<ReactionRow, "kind" | "userId" | "createdAt">): Reaction => ({
  kind: row.kind,
  userId: row.userId,
  at: row.createdAt.getTime(),
});

/** The reactions to each of these targets (items or comments), oldest first. */
export async function reactionsFor(db: Db, targetIds: string[]) {
  const byTarget = new Map<string, Reaction[]>();
  // D1 takes at most 100 bound parameters a statement.
  for (let start = 0; start < targetIds.length; start += 90) {
    const ids = targetIds.slice(start, start + 90);
    const rows = await db
      .select()
      .from(reactions)
      .where(inArray(reactions.targetId, ids))
      .orderBy(asc(reactions.createdAt));
    for (const row of rows) {
      const list = byTarget.get(row.targetId);
      if (list) list.push(toApiReaction(row));
      else byTarget.set(row.targetId, [toApiReaction(row)]);
    }
  }
  return byTarget;
}

/** The reactions to every comment of an item, by comment. */
export async function commentReactions(db: Db, itemId: string) {
  const rows = await db.select().from(reactions).where(eq(reactions.itemId, itemId)).orderBy(asc(reactions.createdAt));
  const byComment = new Map<string, Reaction[]>();
  for (const row of rows) {
    if (!row.commentId) continue;
    const list = byComment.get(row.commentId);
    if (list) list.push(toApiReaction(row));
    else byComment.set(row.commentId, [toApiReaction(row)]);
  }
  return byComment;
}

interface Target {
  targetId: string;
  itemId: string;
  commentId: string | null;
}

/**
 * Gives (`on`) or takes back a reaction. Both are idempotent: giving one twice or taking back one that isn't there
 * changes nothing and records nothing. A change is recorded as an update of what was reacted to (the item, or the
 * comment), since the reactions are part of it.
 */
async function react(c: Context<AppEnv>, target: Target, kind: string, on: boolean) {
  const db = c.var.db;
  const me = c.var.user.id;
  const write = on
    ? db
        .insert(reactions)
        .values({ ...target, userId: me, kind, createdAt: new Date() })
        .onConflictDoNothing()
    : db
        .delete(reactions)
        .where(and(eq(reactions.targetId, target.targetId), eq(reactions.userId, me), eq(reactions.kind, kind)));
  await db.batch([
    write,
    recordChange(db, {
      entity: target.commentId ? "comment" : "item",
      id: target.targetId,
      itemId: target.itemId,
      action: "updated",
      actor: c.var.actor,
    }),
  ]);
  const list = (await reactionsFor(db, [target.targetId])).get(target.targetId) ?? [];
  return c.json<{ reactions: Reaction[] }>({ reactions: list });
}

async function liveItem(c: Context<AppEnv>): Promise<Target | null> {
  const id = c.req.param("id") ?? "";
  const row = await c.var.db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, id), isNull(items.deletedAt)))
    .get();
  return row ? { targetId: row.id, itemId: row.id, commentId: null } : null;
}

async function liveComment(c: Context<AppEnv>): Promise<Target | null> {
  const id = c.req.param("id") ?? "";
  const row = await c.var.db
    .select({ id: comments.id, itemId: comments.itemId })
    .from(comments)
    .innerJoin(items, and(eq(items.id, comments.itemId), isNull(items.deletedAt)))
    .where(and(eq(comments.id, id), isNull(comments.deletedAt)))
    .get();
  return row ? { targetId: row.id, itemId: row.itemId, commentId: row.id } : null;
}

/** PUT gives the reaction, DELETE takes it back; both answer with the target's reactions as they now are. */
function reactionRoutes(find: (c: Context<AppEnv>) => Promise<Target | null>) {
  const handle = (on: boolean) => async (c: Context<AppEnv>) => {
    const named = c.req.param("kind") ?? "";
    // A tab opened before the emoji still sends the six old names (love, chef, …): they mean the emoji they became.
    const kind = Object.hasOwn(LEGACY_REACTIONS, named) ? (LEGACY_REACTIONS[named] as string) : named;
    if (!isEmoji(kind)) return apiError(c, 400, "invalid", "A reaction is one emoji.");
    const target = await find(c);
    if (!target) return apiError(c, 404, "not_found", notFound);
    return react(c, target, kind, on);
  };
  return new Hono<AppEnv>().put("/:id/reactions/:kind", handle(true)).delete("/:id/reactions/:kind", handle(false));
}

/** /api/items/:id/reactions/:kind: reacting to an idea or build (your own too). Person-only. */
export const itemReactionRoutes = reactionRoutes(liveItem);

/** /api/comments/:id/reactions/:kind: reacting to a comment (your own too). Person-only. */
export const commentReactionRoutes = reactionRoutes(liveComment);

/**
 * GET /api/reactions/used: what the quick row and "recently used" are made of. Popular counts every reaction on a
 * live thing by both people; recent is the signed-in person's own, newest first. Person-only.
 */
export const reactionUseRoutes = new Hono<AppEnv>().get("/used", async (c) => {
  const db = c.var.db;
  const [popular, recent] = await Promise.all([
    db
      .select({ kind: reactions.kind })
      .from(reactions)
      .groupBy(reactions.kind)
      .orderBy(desc(sql`count(*)`), desc(sql`max(${reactions.createdAt})`))
      .limit(12),
    db
      .select({ kind: reactions.kind })
      .from(reactions)
      .where(eq(reactions.userId, c.var.user.id))
      .groupBy(reactions.kind)
      .orderBy(desc(sql`max(${reactions.createdAt})`))
      .limit(24),
  ]);
  return c.json<EmojiUse>({ popular: popular.map((row) => row.kind), recent: recent.map((row) => row.kind) });
});
