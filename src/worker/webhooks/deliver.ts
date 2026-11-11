import { and, asc, eq, gt, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { CHANGES_PAGE } from "../../shared/changes.ts";
import { checkLinkUrl } from "../../shared/link-safety.ts";
import {
  DELIVERIES_KEEP_MS,
  DELIVERY_HEADER,
  DELIVERY_TIMEOUT_MS,
  RETRY_DELAYS_MS,
  RETRY_WINDOW_MS,
  SIGNATURE_HEADER,
  SIGNATURE_VERSION,
  TIMESTAMP_HEADER,
  type WebhookPayload,
  wantsChange,
} from "../../shared/webhooks.ts";
import { toApiChange } from "../changes.ts";
import { type Db, getDb } from "../db/index.ts";
import { changes, type Webhook, type WebhookDelivery, webhookDeliveries, webhooks } from "../db/schema.ts";
import { resolvesPublic } from "../link-preview.ts";
import { openSecret, sign } from "./secrets.ts";

/** A delivery is leased for this long while it is being sent, so two runs never send it twice. */
const LEASE_MS = 2 * 60 * 1000;
/** What one run of the cron sends, at most, and how many at once. */
const RUN_LIMIT = 40;
const CONCURRENCY = 8;

/** Where a webhook may point: the same host rules as link previews (https, a public name), except for the test stand-in. */
export function checkWebhookUrl(env: Env, raw: string): URL | null {
  if (env.WEBHOOKS_ALLOW_LOCAL === "1") {
    try {
      const url = new URL(raw);
      return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  }
  return checkLinkUrl(raw);
}

export type Outcome =
  | { ok: true; status: number }
  | { ok: false; status: number | null; error: string; final?: boolean };

/**
 * One POST. Refuses what shouldn't be reached (a private address, now or after DNS changed), doesn't follow
 * redirects, gives up after DELIVERY_TIMEOUT_MS, and never reads the receiver's answer: only its status counts,
 * so nothing it says is kept or logged.
 */
export async function post(
  env: Env,
  webhook: Pick<Webhook, "url" | "secretEnc">,
  delivery: Pick<WebhookDelivery, "id" | "payload">,
  publicHosts: Map<string, Promise<boolean>> = new Map(),
): Promise<Outcome> {
  const url = checkWebhookUrl(env, webhook.url);
  if (!url)
    return { ok: false, status: null, error: "That address isn't allowed: it must be public and https.", final: true };
  const signal = AbortSignal.timeout(DELIVERY_TIMEOUT_MS);
  try {
    if (env.WEBHOOKS_ALLOW_LOCAL !== "1") {
      const host = url.hostname.replace(/\.$/, "");
      const known = publicHosts.get(host) ?? resolvesPublic(host, signal);
      publicHosts.set(host, known);
      if (!(await known)) {
        return {
          ok: false,
          status: null,
          error: "That address points somewhere private, or doesn't resolve.",
          final: true,
        };
      }
    }
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await sign(await openSecret(env, webhook.secretEnc), timestamp, delivery.payload);
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Spaghetti-Webhooks/1.0",
        [TIMESTAMP_HEADER]: timestamp,
        [SIGNATURE_HEADER]: `${SIGNATURE_VERSION}=${signature}`,
        [DELIVERY_HEADER]: delivery.id,
      },
      body: delivery.payload,
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 200 && response.status < 300) return { ok: true, status: response.status };
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        status: response.status,
        error: `It answered ${response.status}: redirects aren't followed.`,
      };
    }
    return { ok: false, status: response.status, error: `It answered ${response.status}.` };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, status: null, error: timedOut ? "It didn't answer in time." : "Couldn't connect to it." };
  }
}

/** Sends a delivery that is already leased and records what came of it. Returns the row as it now is. */
async function attempt(
  env: Env,
  db: Db,
  webhook: Webhook,
  delivery: WebhookDelivery,
  publicHosts?: Map<string, Promise<boolean>>,
): Promise<WebhookDelivery> {
  const outcome = await post(env, webhook, delivery, publicHosts);
  const now = new Date();
  const attempts = delivery.attempts + 1;
  if (outcome.ok) {
    const done = {
      status: "delivered" as const,
      attempts,
      httpStatus: outcome.status,
      error: null,
      nextAt: null,
      lastAttemptAt: now,
    };
    await db.batch([
      db.update(webhookDeliveries).set(done).where(eq(webhookDeliveries.id, delivery.id)),
      db
        .update(webhooks)
        .set({ state: "active", lastError: null, lastErrorAt: null, lastDeliveredAt: now })
        .where(eq(webhooks.id, webhook.id)),
    ]);
    return { ...delivery, ...done };
  }
  const delay = RETRY_DELAYS_MS[attempts - 1];
  const next = delay === undefined ? null : now.getTime() + delay;
  const giveUp = outcome.final || next === null || next > delivery.giveUpAt.getTime();
  const base = { attempts, httpStatus: outcome.status, error: outcome.error, lastAttemptAt: now };
  if (giveUp) {
    const failed = { ...base, status: "failed" as const, nextAt: null };
    await db.batch([
      db.update(webhookDeliveries).set(failed).where(eq(webhookDeliveries.id, delivery.id)),
      db
        .update(webhooks)
        .set({ state: "failing", lastError: outcome.error, lastErrorAt: now })
        .where(eq(webhooks.id, webhook.id)),
    ]);
    return { ...delivery, ...failed };
  }
  const retrying = { ...base, status: "pending" as const, nextAt: new Date(next) };
  await db.update(webhookDeliveries).set(retrying).where(eq(webhookDeliveries.id, delivery.id));
  return { ...delivery, ...retrying };
}

/** Takes the lease on a pending delivery; false when another run got there first. */
async function lease(db: Db, delivery: WebhookDelivery, now: number): Promise<boolean> {
  const claimed = await db
    .update(webhookDeliveries)
    .set({ nextAt: new Date(now + LEASE_MS) })
    .where(
      and(
        eq(webhookDeliveries.id, delivery.id),
        eq(webhookDeliveries.status, "pending"),
        delivery.nextAt ? eq(webhookDeliveries.nextAt, delivery.nextAt) : isNull(webhookDeliveries.nextAt),
      ),
    )
    .run();
  return (claimed.meta?.changes ?? 0) > 0;
}

/**
 * Turns the changes since each webhook's cursor into deliveries (one per change it asked for), then moves the
 * cursor. Safe to run twice at once: a change becomes a delivery once per webhook (a unique index).
 */
export async function fanOut(db: Db, now = Date.now()): Promise<number> {
  const active = await db.select().from(webhooks).where(isNull(webhooks.deletedAt));
  let made = 0;
  for (const webhook of active) {
    const head =
      (
        await db
          .select({ head: sql<number>`coalesce(max(${changes.seq}), 0)` })
          .from(changes)
          .get()
      )?.head ?? 0;
    if (webhook.cursor > head) {
      await db.update(webhooks).set({ cursor: head }).where(eq(webhooks.id, webhook.id));
      continue;
    }
    for (;;) {
      const rows = await db
        .select()
        .from(changes)
        .where(gt(changes.seq, webhook.cursor))
        .orderBy(asc(changes.seq))
        .limit(CHANGES_PAGE);
      if (!rows.length) break;
      const wanted = rows.filter((row) => wantsChange(webhook.kinds, row.entity));
      const statements = wanted.map((row) => {
        const change = toApiChange(row);
        const id = crypto.randomUUID();
        const payload: WebhookPayload = {
          deliveryId: id,
          webhookId: webhook.id,
          test: false,
          changes: [change],
          cursor: change.seq,
          more: false,
          reset: false,
        };
        return db
          .insert(webhookDeliveries)
          .values({
            id,
            webhookId: webhook.id,
            seq: change.seq,
            payload: JSON.stringify(payload),
            nextAt: new Date(now),
            createdAt: new Date(now),
            giveUpAt: new Date(now + RETRY_WINDOW_MS),
          })
          .onConflictDoNothing();
      });
      const last = rows.at(-1)?.seq ?? webhook.cursor;
      const move = db.update(webhooks).set({ cursor: last }).where(eq(webhooks.id, webhook.id));
      const [first, ...rest] = [...statements, move];
      await db.batch([first, ...rest] as [typeof move, ...(typeof move)[]]);
      made += wanted.length;
      webhook.cursor = last;
      if (rows.length < CHANGES_PAGE) break;
    }
  }
  return made;
}

/** Sends what is due: fresh deliveries and retries whose time has come. */
export async function sendDue(env: Env, db: Db, now = Date.now()): Promise<{ sent: number; failed: number }> {
  const due = await db
    .select({ delivery: webhookDeliveries, webhook: webhooks })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
    .where(
      and(
        eq(webhookDeliveries.status, "pending"),
        lte(webhookDeliveries.nextAt, new Date(now)),
        isNull(webhooks.deletedAt),
      ),
    )
    .orderBy(asc(webhookDeliveries.createdAt))
    .limit(RUN_LIMIT);
  const publicHosts = new Map<string, Promise<boolean>>();
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    await Promise.all(
      due.slice(i, i + CONCURRENCY).map(async ({ delivery, webhook }) => {
        if (!(await lease(db, delivery, now))) return;
        const after = await attempt(env, db, webhook, delivery, publicHosts);
        if (after.status === "delivered") sent++;
        else failed++;
      }),
    );
  }
  return { sent, failed };
}

/** The cron's job: make deliveries, send what is due, tidy old ones. Never throws (the cron runs other things too). */
export async function runWebhooks(env: Env, now = Date.now()) {
  const db = getDb(env.DB);
  const made = await fanOut(db, now);
  const result = await sendDue(env, db, now);
  return { made, ...result };
}

/** The daily tidy: finished deliveries older than a week. */
export async function pruneDeliveries(env: Env, now = Date.now()) {
  await getDb(env.DB)
    .delete(webhookDeliveries)
    .where(
      and(ne(webhookDeliveries.status, "pending"), lt(webhookDeliveries.createdAt, new Date(now - DELIVERIES_KEEP_MS))),
    );
}

/** Sends one delivery now (a test event, or "Retry"), starting a fresh day of retries. */
export async function sendNow(env: Env, db: Db, webhook: Webhook, delivery: WebhookDelivery): Promise<WebhookDelivery> {
  const now = Date.now();
  const fresh = { ...delivery, status: "pending" as const, attempts: 0, giveUpAt: new Date(now + RETRY_WINDOW_MS) };
  await db
    .update(webhookDeliveries)
    .set({ status: "pending", attempts: 0, nextAt: new Date(now + LEASE_MS), giveUpAt: fresh.giveUpAt })
    .where(
      and(eq(webhookDeliveries.id, delivery.id), inArray(webhookDeliveries.status, ["pending", "failed", "delivered"])),
    );
  return attempt(env, db, webhook, fresh);
}
