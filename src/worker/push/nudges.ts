import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import {
  dueNudge,
  isQuietHour,
  nudgeMessage,
  type PushMessage,
  UPKEEP_NUDGE_GAP_HOURS,
  upkeepMessage,
} from "../../shared/push.ts";
import { sinceWords } from "../../shared/upkeep.ts";
import { getDb } from "../db/index.ts";
import { attempts, items, pushNudges, pushSubscriptions, upkeepTasks, users } from "../db/schema.ts";
import { readsByAttempt, toApiPhotoRead } from "../photo-read/run.ts";
import { loadUpkeep } from "../routes/upkeep.ts";
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
export async function sendNudges(env: Env, now = Date.now(), deliver: typeof pushTo = pushTo) {
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
  // What Claude made of their photos, if anything: the push says so gently.
  const reads = await readsByAttempt(
    db,
    due.map((d) => d.attempt.id),
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
      const read = toApiPhotoRead(reads.get(attempt.id) ?? []);
      const suggestion =
        read?.status === "read" && read.outcome ? { outcome: read.outcome, reason: read.reason } : null;
      const message = nudgeMessage(kind, attempt, title, userId === own ? undefined : names.get(own), suggestion);
      let delivered = 0;
      for (const device of awake) {
        if ((await deliver(env, vapid, device, message)) === "sent") delivered++;
      }
      sent += delivered;
      // Nothing got through (a hiccup at the push service): release the claim so the next run tries again.
      if (!delivered) {
        await env.DB.prepare("DELETE FROM push_nudges WHERE attempt_id = ? AND user_id = ?")
          .bind(attempt.id, userId)
          .run();
      }
    }
  }
  return { sent };
}

/**
 * One gentle nudge when an upkeep task is due (cron, with the others): the most due task that hasn't been
 * nudged since it was last done, to the devices that switched "Tell me when upkeep is due" on, outside their
 * quiet hours. At most one a day for the whole printer: once any task was nudged in the last 24 hours, the
 * rest wait. A task is claimed before sending (nudged_at), and released if nothing got through.
 */
export async function sendUpkeepNudge(env: Env, now = Date.now()) {
  const db = getDb(env.DB);
  const devices = (await db.select().from(pushSubscriptions)).filter((s) => s.upkeepNudges);
  if (!devices.length) return { sent: 0 };
  const recent = await db
    .select({ id: upkeepTasks.id })
    .from(upkeepTasks)
    .where(gt(upkeepTasks.nudgedAt, new Date(now - UPKEEP_NUDGE_GAP_HOURS * 3_600_000)))
    .limit(1)
    .get();
  if (recent) return { sent: 0 };
  const awake = devices.filter((s) => !isQuietHour(s.timeZone, now));
  if (!awake.length) return { sent: 0 }; // Waits for the morning.
  const nudged = new Set(
    (await db.select({ id: upkeepTasks.id, at: upkeepTasks.nudgedAt }).from(upkeepTasks))
      .filter((row) => row.at)
      .map((row) => row.id),
  );
  const { tasks } = await loadUpkeep(db, now);
  const task = tasks.find((candidate) => candidate.due && !nudged.has(candidate.id));
  if (!task) return { sent: 0 };
  const vapid = await loadVapid(env);
  if (!vapid) return { sent: 0 };
  // The claim is a conditional update, so two overlapping runs can't both send it.
  const claim = await env.DB.prepare(
    `UPDATE upkeep_tasks SET nudged_at = ?1 WHERE id = ?2 AND nudged_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM upkeep_tasks WHERE nudged_at > ?3)`,
  )
    .bind(now, task.id, now - UPKEEP_NUDGE_GAP_HOURS * 3_600_000)
    .run();
  if (!claim.meta.changes) return { sent: 0 };
  const message = upkeepMessage(task, sinceWords(task, task.sinceHours, task.sinceDays));
  let delivered = 0;
  for (const device of awake) {
    if ((await pushTo(env, vapid, device, message)) === "sent") delivered++;
  }
  if (!delivered) await db.update(upkeepTasks).set({ nudgedAt: null }).where(eq(upkeepTasks.id, task.id));
  return { sent: delivered };
}
