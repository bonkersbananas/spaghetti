import { eq } from "drizzle-orm";
import { commentPushText, PUSH_BATCH_MS, threadUrl } from "../../shared/comments.ts";
import { isQuietHour, type PushMessage } from "../../shared/push.ts";
import { getDb } from "../db/index.ts";
import { items, pushSubscriptions, users } from "../db/schema.ts";
import { loadVapid, pushTo } from "./nudges.ts";

/** A comment older than this when its push is claimed is old news (a Worker that was cut off): it isn't pushed. */
const STALE_MS = 60 * 60 * 1000;

/**
 * The push for new comments by `authorId` on an item, to the other person's devices that have push on.
 * A burst is one push: the comments are claimed together (`notified_at`, a conditional update, so two
 * overlapping calls can't both send), and the route waits PUSH_BATCH_MS before calling this, so everything
 * written in that window is in it and the later calls find nothing left. Quiet hours stay quiet: the claim is
 * made and nothing is sent, the unread marker is what they find in the morning.
 */
export async function sendCommentPush(env: Env, itemId: string, authorId: string, now = Date.now()) {
  const db = getDb(env.DB);
  const devices = (await db.select().from(pushSubscriptions)).filter((s) => s.userId !== authorId);
  if (!devices.length) return { sent: 0 };
  const claimed = await env.DB.prepare(
    `UPDATE comments SET notified_at = ?1
      WHERE item_id = ?2 AND author_id = ?3 AND deleted_at IS NULL AND notified_at IS NULL AND created_at > ?4
      RETURNING body, created_at`,
  )
    .bind(now, itemId, authorId, now - STALE_MS)
    .all<{ body: string; created_at: number }>();
  if (!claimed.results.length) return { sent: 0 };
  const awake = devices.filter((s) => !isQuietHour(s.timeZone, now));
  if (!awake.length) return { sent: 0 };
  const vapid = await loadVapid(env);
  if (!vapid) return { sent: 0 };
  const item = await db
    .select({ title: items.title, stage: items.stage })
    .from(items)
    .where(eq(items.id, itemId))
    .get();
  const author = await db.select({ name: users.name }).from(users).where(eq(users.id, authorId)).get();
  if (!item) return { sent: 0 };
  const bodies = claimed.results.sort((a, b) => a.created_at - b.created_at).map((row) => row.body);
  const text = commentPushText(
    author?.name ?? "Someone",
    item.title?.trim() || (item.stage === "idea" ? "an idea" : "a build"),
    bodies,
  );
  const message: PushMessage = {
    kind: "comment",
    ...text,
    tag: `comments-${itemId}`,
    url: threadUrl(itemId, item.stage),
    itemId,
    actions: [],
  };
  let sent = 0;
  for (const device of awake) if ((await pushTo(env, vapid, device, message)) === "sent") sent++;
  return { sent };
}

/** After the response: wait out the batch window, then push (only when someone could be told, so nothing idles for nothing). */
export async function pushCommentSoon(env: Env, itemId: string, authorId: string) {
  const others = (await getDb(env.DB).select({ userId: pushSubscriptions.userId }).from(pushSubscriptions)).filter(
    (s) => s.userId !== authorId,
  );
  if (!others.length || !env.VAPID_PRIVATE_KEY) return;
  await new Promise((resolve) => setTimeout(resolve, PUSH_BATCH_MS));
  await sendCommentPush(env, itemId, authorId);
}
