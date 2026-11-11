import { and, asc, eq, isNull } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  COMMENT_MAX,
  type Comment,
  type CommentsResponse,
  type UnreadCommentsResponse,
} from "../../shared/comments.ts";
import { recordChange } from "../changes.ts";
import { type CommentRow, commentReads, comments, items } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { pushCommentSoon } from "../push/comments.ts";

const body = z.string().trim().min(1).max(COMMENT_MAX);
const createComment = z.object({ id: z.uuid(), body });
const updateComment = z.object({ body });

const notFound = "That isn't here any more.";

export function toApiComment(row: CommentRow): Comment {
  return {
    id: row.id,
    itemId: row.itemId,
    authorId: row.authorId,
    via: row.via,
    body: row.body,
    createdAt: row.createdAt.getTime(),
    editedAt: row.editedAt?.getTime() ?? null,
  };
}

/** /api/items/:id/comments: a thread, writing to it, and marking it read. */
export const itemCommentRoutes = new Hono<AppEnv>()
  .get("/:id/comments", async (c) => {
    const db = c.var.db;
    const itemId = c.req.param("id");
    const item = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
      .get();
    if (!item) return apiError(c, 404, "not_found", notFound);
    const [rows, read] = await Promise.all([
      db
        .select()
        .from(comments)
        .where(and(eq(comments.itemId, itemId), isNull(comments.deletedAt)))
        .orderBy(asc(comments.createdAt)),
      db
        .select({ readAt: commentReads.readAt })
        .from(commentReads)
        .where(and(eq(commentReads.itemId, itemId), eq(commentReads.userId, c.var.user.id)))
        .get(),
    ]);
    return c.json<CommentsResponse>({ comments: rows.map(toApiComment), readAt: read?.readAt.getTime() ?? null });
  })

  /** Writes a comment. The id is the client's, so a retry returns the same comment. A person writing counts as having read the thread. */
  .post("/:id/comments", async (c) => {
    const parsed = createComment.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That comment couldn't be read.");
    const db = c.var.db;
    const itemId = c.req.param("id");
    const me = c.var.user;
    const existing = await db.select().from(comments).where(eq(comments.id, parsed.data.id)).get();
    if (existing) {
      if (existing.itemId !== itemId || existing.authorId !== me.id) {
        return apiError(c, 409, "exists", "That id is taken.");
      }
      if (existing.deletedAt) return apiError(c, 409, "deleted", "That comment was deleted.");
      return c.json<{ comment: Comment }>({ comment: toApiComment(existing) }, 201);
    }
    const item = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
      .get();
    if (!item) return apiError(c, 404, "not_found", notFound);
    const now = new Date();
    const [[row]] = await db.batch([
      db
        .insert(comments)
        .values({
          id: parsed.data.id,
          itemId,
          authorId: me.id,
          via: c.var.via,
          body: parsed.data.body,
          createdAt: now,
        })
        .returning(),
      recordChange(db, { entity: "comment", id: parsed.data.id, itemId, action: "created", actor: c.var.actor }),
    ]);
    if (!row) return apiError(c, 500, "failed", "That didn't save.");
    if (!c.var.via) await markRead(c.env.DB, me.id, itemId, now.getTime());
    c.executionCtx.waitUntil(
      pushCommentSoon(c.env, itemId, me.id).catch((e) => console.error("comment push failed", e)),
    );
    return c.json<{ comment: Comment }>({ comment: toApiComment(row) }, 201);
  })

  /** "I've read this thread": the other person's comments up to now stop being new for you. Person-only. */
  .post("/:id/comments/read", async (c) => {
    const itemId = c.req.param("id");
    const item = await c.var.db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
      .get();
    if (!item) return apiError(c, 404, "not_found", notFound);
    const readAt = Date.now();
    await markRead(c.env.DB, c.var.user.id, itemId, readAt);
    return c.json({ readAt });
  });

/** Only moves forward, so a late answer from an old tab never makes read comments new again. */
async function markRead(db: D1Database, userId: string, itemId: string, at: number) {
  await db
    .prepare(
      `INSERT INTO comment_reads (user_id, item_id, read_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (user_id, item_id) DO UPDATE SET read_at = max(read_at, excluded.read_at)`,
    )
    .bind(userId, itemId, at)
    .run();
}

/** Your own comment (through the same agent, for an agent's token) or nothing. */
async function ownComment(
  c: Context<AppEnv>,
  deleted: boolean,
): Promise<{ row: CommentRow; error?: undefined } | { error: Response; row?: undefined }> {
  const row = await c.var.db
    .select()
    .from(comments)
    .where(eq(comments.id, c.req.param("id") ?? ""))
    .get();
  if (!row || !!row.deletedAt !== deleted) return { error: apiError(c, 404, "not_found", notFound) };
  if (row.authorId !== c.var.user.id || (c.var.via && row.via !== c.var.via)) {
    return { error: apiError(c, 403, "not_yours", "You can only change your own comments.") };
  }
  return { row };
}

/** /api/comments: the unread threads, and editing and deleting your own comments. */
export const commentRoutes = new Hono<AppEnv>()
  .get("/unread", async (c) => {
    const me = c.var.user.id;
    const result = await c.env.DB.prepare(
      `SELECT c.item_id AS itemId, count(*) AS count, max(c.created_at) AS latestAt
         FROM comments c
         JOIN items i ON i.id = c.item_id AND i.deleted_at IS NULL
         LEFT JOIN comment_reads r ON r.item_id = c.item_id AND r.user_id = ?1
        WHERE c.deleted_at IS NULL AND c.author_id != ?1 AND (r.read_at IS NULL OR c.created_at > r.read_at)
        GROUP BY c.item_id
        ORDER BY latestAt DESC`,
    )
      .bind(me)
      .all<{ itemId: string; count: number; latestAt: number }>();
    return c.json<UnreadCommentsResponse>({ threads: result.results });
  })

  .patch("/:id", async (c) => {
    const parsed = updateComment.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That comment couldn't be read.");
    const found = await ownComment(c, false);
    if (found.error) return found.error;
    const { row } = found;
    if (row.body === parsed.data.body) return c.json<{ comment: Comment }>({ comment: toApiComment(row) });
    const db = c.var.db;
    const [[updated]] = await db.batch([
      db
        .update(comments)
        .set({ body: parsed.data.body, editedAt: new Date() })
        .where(and(eq(comments.id, row.id), isNull(comments.deletedAt)))
        .returning(),
      recordChange(db, { entity: "comment", id: row.id, itemId: row.itemId, action: "updated", actor: c.var.actor }),
    ]);
    if (!updated) return apiError(c, 404, "not_found", notFound);
    return c.json<{ comment: Comment }>({ comment: toApiComment(updated) });
  })

  .delete("/:id", async (c) => {
    const found = await ownComment(c, false);
    if (found.error) return found.error;
    const db = c.var.db;
    await db.batch([
      db
        .update(comments)
        .set({ deletedAt: new Date() })
        .where(and(eq(comments.id, found.row.id), isNull(comments.deletedAt))),
      recordChange(db, {
        entity: "comment",
        id: found.row.id,
        itemId: found.row.itemId,
        action: "deleted",
        actor: c.var.actor,
      }),
    ]);
    return c.body(null, 204);
  })

  /** Undo for a delete. */
  .post("/:id/restore", async (c) => {
    const found = await ownComment(c, true);
    if (found.error) return found.error;
    const db = c.var.db;
    const [[restored]] = await db.batch([
      db.update(comments).set({ deletedAt: null }).where(eq(comments.id, found.row.id)).returning(),
      recordChange(db, {
        entity: "comment",
        id: found.row.id,
        itemId: found.row.itemId,
        action: "restored",
        actor: c.var.actor,
      }),
    ]);
    return c.json<{ comment: Comment }>({ comment: toApiComment(restored ?? found.row) });
  });
