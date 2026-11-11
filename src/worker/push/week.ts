import { eq } from "drizzle-orm";
import { isQuietHour } from "../../shared/push.ts";
import { isWeekPushTime, mondayOf, weekIsWorthAPush, weekMessage } from "../../shared/week.ts";
import { getDb } from "../db/index.ts";
import { pushSubscriptions, weekPushes } from "../db/schema.ts";
import { loadWeek } from "../week/load.ts";
import { writeWeekNote } from "../week/note.ts";
import { loadVapid, pushTo } from "./nudges.ts";

/** Time to wait for Claude's paragraph before the push goes out without it (the page shows it when it lands). */
const NOTE_WAIT_MS = 45_000;

/**
 * "Your week", once, on Sunday evening (cron, with the others: every five minutes, but only from 19:00 to 22:00
 * Sunday in the workspace's time zone does it do anything). For each person with a device that has "Your week" on,
 * when the week had at least one print or idea. Claude's paragraph is written first, when there is a key, so the
 * page is complete when the notification is tapped. Once per person and week is the primary key of `week_pushes`,
 * claimed before sending and released when nothing got through, so overlapping runs and the next five-minute run
 * can't send it twice.
 */
export async function sendWeekPush(env: Env, now = Date.now(), deliver: typeof pushTo = pushTo) {
  if (!isWeekPushTime(now)) return { sent: 0 };
  const db = getDb(env.DB);
  const monday = mondayOf(now);
  const devices = (await db.select().from(pushSubscriptions)).filter((s) => s.weekNudges);
  if (!devices.length) return { sent: 0 };
  const already = new Set(
    (await db.select({ userId: weekPushes.userId }).from(weekPushes).where(eq(weekPushes.monday, monday))).map(
      (row) => row.userId,
    ),
  );
  const people = [...new Set(devices.map((d) => d.userId))].filter((userId) => !already.has(userId));
  if (!people.length) return { sent: 0 };
  const vapid = await loadVapid(env);
  if (!vapid) return { sent: 0 };

  if (!weekIsWorthAPush(await loadWeek(env, monday, now, db))) return { sent: 0 };
  // Claude's paragraph first. It never blocks the push for long, and a failure only means the page has no paragraph.
  await Promise.race([
    writeWeekNote(env, monday, { now, db, timeoutMs: NOTE_WAIT_MS }).catch(() => "failed"),
    new Promise((resolve) => setTimeout(resolve, NOTE_WAIT_MS + 5_000)),
  ]);
  const message = weekMessage(await loadWeek(env, monday, now, db));

  let sent = 0;
  for (const userId of people) {
    const awake = devices.filter((d) => d.userId === userId && !isQuietHour(d.timeZone, now));
    if (!awake.length) continue;
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO week_pushes (monday, user_id, sent_at) VALUES (?, ?, ?)")
      .bind(monday, userId, now)
      .run();
    if (!claim.meta.changes) continue;
    let delivered = 0;
    for (const device of awake) {
      if ((await deliver(env, vapid, device, message)) === "sent") delivered++;
    }
    sent += delivered;
    if (!delivered) {
      await env.DB.prepare("DELETE FROM week_pushes WHERE monday = ? AND user_id = ?").bind(monday, userId).run();
    }
  }
  return { sent };
}
