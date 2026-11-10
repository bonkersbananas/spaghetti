import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { dueNudge, isQuietHour, nudgeMessage, type PushMessage } from "../../shared/push.ts";
import { getDb } from "../db/index.ts";
import { attempts, items, pushNudges, pushSubscriptions, users } from "../db/schema.ts";
import { importVapidKey, type PushResult, sendPush } from "./webpush.ts";

/** How far back an open attempt can still be due: well past the nudge window, so nothing is missed between cron runs. */
const LOOK_BACK_MS = 72 * 60 * 60 * 1000;

export type Vapid = { subject: string; publicKey: string; signingKey: CryptoKey };

export async function loadVapid(env: Env): Promise<Vapid | null> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    signingKey: await importVapidKey(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY),
  };
}

/** Sends to one subscription and forgets it when the push service says it is gone. */
export async function pushTo(
  env: Env,
  vapid: Vapid,
  subscription: { id: string; endpoint: string; p256dh: string; auth: string },
  message: PushMessage,
): Promise<PushResult> {
  const result = await sendPush(
    { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
    message,
    vapid,
    // A nudge that arrives hours late is noise: let the push service drop it after a few hours.
    { ttl: message.kind === "test" ? 60 : 4 * 60 * 60, urgency: message.kind === "test" ? "high" : "normal" },
  );
  if (result === "gone") await getDb(env.DB).delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
  return result;
}

/**
 * Sends the "how did it go?" nudges that are due (cron, every few minutes). An open attempt is due when the
 * bridge saw it come off the bed, or its slicer estimate plus ten minutes has passed. Each attempt is nudged
 * at most once per person: the person who started it, and whoever asked in settings to hear about the other
 * person's prints. Quiet hours (22:00 to 07:00 in the device's time zone) wait; a nudge that has waited past
 * the window, or whose attempt got an outcome meanwhile, is never sent.
 */
export async function sendNudges(env: Env, now = Date.now()) {
  const db = getDb(env.DB);
  const open = await db
    .select({ attempt: attempts, title: items.title })
    .from(attempts)
    .innerJoin(items, eq(items.id, attempts.itemId))
    .where(
      and(
        isNull(attempts.outcome),
        isNull(attempts.deletedAt),
        isNull(items.deletedAt),
        gt(attempts.printedAt, new Date(now - LOOK_BACK_MS)),
      ),
    );
  const due = open.flatMap(({ attempt, title }) => {
    const nudge = dueNudge(
      {
        outcome: attempt.outcome,
        printedAt: attempt.printedAt.getTime(),
        endedAt: attempt.endedAt?.getTime() ?? null,
        estimatedMinutes: attempt.settings.estimatedMinutes,
      },
      now,
    );
    return nudge ? [{ attempt, title: title ?? "", ...nudge }] : [];
  });
  if (!due.length) return { sent: 0 };

  const vapid = await loadVapid(env);
  if (!vapid) return { sent: 0 };
  const subscriptions = await db.select().from(pushSubscriptions);
  if (!subscriptions.length) return { sent: 0 };
  const names = new Map((await db.select({ id: users.id, name: users.name }).from(users)).map((u) => [u.id, u.name]));
  const already = await db
    .select()
    .from(pushNudges)
    .where(
      inArray(
        pushNudges.attemptId,
        due.map((d) => d.attempt.id),
      ),
    );
  const done = new Set(already.map((n) => `${n.attemptId}:${n.userId}`));

  let sent = 0;
  for (const { attempt, title, kind } of due) {
    const own = attempt.createdBy;
    const recipients = new Set(subscriptions.filter((s) => s.userId === own || s.alsoOthers).map((s) => s.userId));
    for (const userId of recipients) {
      if (done.has(`${attempt.id}:${userId}`)) continue;
      // Their devices: all of them for their own print, only those that asked for the other person's.
      const devices = subscriptions.filter((s) => s.userId === userId && (userId === own || s.alsoOthers));
      const awake = devices.filter((s) => !isQuietHour(s.timeZone, now));
      if (!awake.length) continue; // Waits for the morning.
      // Claimed before sending, so two overlapping runs can't both send it.
      const claim = await env.DB.prepare(
        "INSERT OR IGNORE INTO push_nudges (attempt_id, user_id, kind, sent_at) VALUES (?, ?, ?, ?)",
      )
        .bind(attempt.id, userId, kind, now)
        .run();
      if (!claim.meta.changes) continue;
      const message = nudgeMessage(kind, attempt, title, userId === own ? undefined : names.get(own));
      for (const device of awake) {
        if ((await pushTo(env, vapid, device, message)) === "sent") sent++;
      }
    }
  }
  return { sent };
}
