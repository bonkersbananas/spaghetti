import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { fromBase64Url } from "../../shared/base64url.ts";
import { isTimeZone, type PushConfig, testMessage } from "../../shared/push.ts";
import { pushSubscriptions } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { loadVapid, pushTo } from "../push/nudges.ts";

const MAX_DEVICES = 10;

const endpoint = z.string().url().max(2048).startsWith("https://");
const timeZone = z.string().max(64).refine(isTimeZone, "Unknown time zone");
/** What a browser really gives: an uncompressed P-256 point and a 16-byte secret, base64url. */
const decodes = (text: string, length: number, first?: number) => {
  try {
    const bytes = fromBase64Url(text);
    return bytes.length === length && (first === undefined || bytes[0] === first);
  } catch {
    return false;
  }
};
const subscribe = z.object({
  endpoint,
  keys: z.object({
    p256dh: z
      .string()
      .max(256)
      .refine((k) => decodes(k, 65, 4), "Not a P-256 key"),
    auth: z
      .string()
      .max(64)
      .refine((k) => decodes(k, 16), "Not a 16-byte secret"),
  }),
  timeZone,
  alsoOthers: z.boolean().optional(),
  upkeepNudges: z.boolean().optional(),
});
const change = z.object({
  endpoint,
  alsoOthers: z.boolean().optional(),
  upkeepNudges: z.boolean().optional(),
  timeZone: timeZone.optional(),
});
const target = z.object({ endpoint });

/**
 * This person's devices for web push. Person-only: not in auth/scopes.ts, and its reads are listed in
 * PERSON_ONLY_READS, so a token is refused with person_only.
 */
export const pushRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await c.var.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, c.var.user.id));
    return c.json<PushConfig>({
      publicKey: c.env.VAPID_PUBLIC_KEY || null,
      canSend: Boolean(c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY),
      subscriptions: rows.map((row) => ({
        endpoint: row.endpoint,
        alsoOthers: row.alsoOthers,
        upkeepNudges: row.upkeepNudges,
        timeZone: row.timeZone,
      })),
    });
  })
  /** Turns notifications on for a device (or refreshes it: the browser may renew its subscription). */
  .put("/subscription", async (c) => {
    const parsed = subscribe.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That subscription couldn't be read.");
    const { keys, ...body } = parsed.data;
    const db = c.var.db;
    const mine = await db
      .select({ endpoint: pushSubscriptions.endpoint })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, c.var.user.id));
    if (mine.length >= MAX_DEVICES && !mine.some((row) => row.endpoint === body.endpoint)) {
      return apiError(
        c,
        409,
        "too_many_devices",
        "That's a lot of devices. Turn notifications off on one you don't use.",
      );
    }
    await db
      .insert(pushSubscriptions)
      .values({
        id: crypto.randomUUID(),
        userId: c.var.user.id,
        endpoint: body.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        timeZone: body.timeZone,
        alsoOthers: body.alsoOthers ?? false,
        upkeepNudges: body.upkeepNudges ?? false,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        // A device that changed hands is this person's now; the "also others" choice is kept unless said.
        set: {
          userId: c.var.user.id,
          p256dh: keys.p256dh,
          auth: keys.auth,
          timeZone: body.timeZone,
          ...(body.alsoOthers === undefined ? {} : { alsoOthers: body.alsoOthers }),
          ...(body.upkeepNudges === undefined ? {} : { upkeepNudges: body.upkeepNudges }),
        },
      });
    return c.body(null, 204);
  })
  .patch("/subscription", async (c) => {
    const parsed = change.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That change couldn't be read.");
    const { endpoint: url, ...set } = parsed.data;
    const updated = await c.var.db
      .update(pushSubscriptions)
      .set(set)
      .where(and(eq(pushSubscriptions.endpoint, url), eq(pushSubscriptions.userId, c.var.user.id)))
      .returning({ id: pushSubscriptions.id });
    if (!updated.length) return apiError(c, 404, "not_found", "This device isn't signed up for notifications.");
    return c.body(null, 204);
  })
  /** Turns notifications off for a device. Not finding it is fine: the device is already off. */
  .delete("/subscription", async (c) => {
    const parsed = target.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That device couldn't be read.");
    await c.var.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, parsed.data.endpoint), eq(pushSubscriptions.userId, c.var.user.id)));
    return c.body(null, 204);
  })
  /** A test notification to this device. */
  .post("/test", async (c) => {
    const parsed = target.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That device couldn't be read.");
    const device = await c.var.db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, parsed.data.endpoint), eq(pushSubscriptions.userId, c.var.user.id)))
      .get();
    if (!device) return apiError(c, 404, "not_found", "This device isn't signed up for notifications.");
    const vapid = await loadVapid(c.env);
    if (!vapid) return apiError(c, 503, "not_configured", "This server can't send notifications: it has no VAPID key.");
    const result = await pushTo(c.env, vapid, device, testMessage);
    if (result === "gone")
      return apiError(c, 410, "gone", "This device has dropped its subscription. Turn notifications on again.");
    if (result === "failed")
      return apiError(c, 502, "push_failed", "The push service didn't take it. Try again in a moment.");
    return c.body(null, 204);
  });

/** For the OpenAPI document (worker/openapi). */
export { change as pushChange, subscribe, target as pushTarget };
