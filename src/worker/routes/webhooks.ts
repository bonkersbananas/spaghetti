import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Change } from "../../shared/changes.ts";
import {
  type DeliveriesResponse,
  type DeliveryInfo,
  type DeliveryResponse,
  MAX_WEBHOOKS,
  type NewWebhookResponse,
  RECENT_DELIVERIES,
  RETRY_WINDOW_MS,
  WEBHOOK_KINDS,
  type WebhookInfo,
  type WebhookPayload,
  type WebhooksResponse,
} from "../../shared/webhooks.ts";
import { actorOf } from "../changes.ts";
import { agents, changes, type Webhook, type WebhookDelivery, webhookDeliveries, webhooks } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { checkWebhookUrl, sendNow } from "../webhooks/deliver.ts";
import { generateSecret, sealSecret, secretKeySource, secretPrefix } from "../webhooks/secrets.ts";

const kinds = z
  .array(z.enum(WEBHOOK_KINDS))
  .min(1)
  .max(WEBHOOK_KINDS.length)
  .transform((list) =>
    list.includes("all") ? (["all"] as const) : WEBHOOK_KINDS.filter((kind) => list.includes(kind)),
  );

export const createWebhook = z.object({
  id: z.uuid().optional(),
  url: z.string().trim().min(1).max(2000),
  kinds,
  agentId: z.uuid().nullable().optional(),
});

const notFound = "That webhook isn't here.";

export const toWebhook = (row: Webhook): WebhookInfo => ({
  id: row.id,
  url: row.url,
  kinds: row.kinds,
  agentId: row.agentId,
  secretPrefix: row.secretPrefix,
  state: row.state,
  lastError: row.lastError,
  lastErrorAt: row.lastErrorAt?.getTime() ?? null,
  lastDeliveredAt: row.lastDeliveredAt?.getTime() ?? null,
  createdAt: row.createdAt.getTime(),
});

/** What a delivery was about, read from the payload that was (or will be) sent. */
function changeOf(row: WebhookDelivery): Pick<Change, "entity" | "action"> {
  try {
    const change = (JSON.parse(row.payload) as WebhookPayload).changes[0];
    if (change) return { entity: change.entity, action: change.action };
  } catch {
    // Falls through to the plain answer.
  }
  return { entity: "item", action: "updated" };
}

export const toDelivery = (row: WebhookDelivery): DeliveryInfo => ({
  ...changeOf(row),
  id: row.id,
  webhookId: row.webhookId,
  seq: row.seq,
  test: row.seq === null,
  status: row.status,
  attempts: row.attempts,
  httpStatus: row.httpStatus,
  error: row.error,
  nextAt: row.status === "pending" ? (row.nextAt?.getTime() ?? null) : null,
  createdAt: row.createdAt.getTime(),
  lastAttemptAt: row.lastAttemptAt?.getTime() ?? null,
});

/**
 * /api/webhooks: for signed-in people only (agent tokens never reach it: nothing here is in auth/scopes.ts).
 * A webhook belongs to the person who made it. The secret comes back once, when it is made.
 */
export const webhookRoutes = new Hono<AppEnv>()
  // Without WEBHOOK_SECRET_KEY nothing here works: say so plainly, the same for every endpoint.
  .use(async (c, next) => {
    if (!secretKeySource(c.env)) {
      return apiError(c, 503, "webhooks_unavailable", "Webhooks need a key on the server; see docs/deploy.md.");
    }
    await next();
  })
  .get("/", async (c) => {
    const rows = await c.var.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.ownerId, c.var.user.id), isNull(webhooks.deletedAt)))
      .orderBy(webhooks.createdAt);
    return c.json<WebhooksResponse>({ webhooks: rows.map(toWebhook) });
  })

  .post("/", async (c) => {
    const parsed = createWebhook.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return apiError(c, 400, "invalid", "A webhook needs an address and the kinds of change it wants.");
    const body = parsed.data;
    const url = checkWebhookUrl(c.env, body.url);
    if (!url) {
      return apiError(c, 422, "unsafe_url", "A webhook needs a public https address, like https://example.com/hook.");
    }
    const db = c.var.db;
    if (body.agentId) {
      const agent = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, body.agentId), eq(agents.ownerId, c.var.user.id)))
        .get();
      if (!agent) return apiError(c, 400, "invalid", "That agent isn't one of yours.");
    }
    const mine = await db
      .select({ count: sql<number>`count(*)` })
      .from(webhooks)
      .where(and(eq(webhooks.ownerId, c.var.user.id), isNull(webhooks.deletedAt)))
      .get();
    if ((mine?.count ?? 0) >= MAX_WEBHOOKS) {
      return apiError(c, 409, "too_many", `That's ${MAX_WEBHOOKS} webhooks already. Delete one first.`);
    }
    const id = body.id ?? crypto.randomUUID();
    if (await db.select({ id: webhooks.id }).from(webhooks).where(eq(webhooks.id, id)).get()) {
      return apiError(c, 409, "conflict", "That webhook already exists.");
    }
    const secret = generateSecret();
    // It starts from now: what already happened isn't replayed.
    const head =
      (
        await db
          .select({ head: sql<number>`coalesce(max(${changes.seq}), 0)` })
          .from(changes)
          .get()
      )?.head ?? 0;
    const [row] = await db
      .insert(webhooks)
      .values({
        id,
        ownerId: c.var.user.id,
        url: url.href,
        kinds: [...body.kinds],
        agentId: body.agentId ?? null,
        secretEnc: await sealSecret(c.env, secret),
        secretPrefix: secretPrefix(secret),
        cursor: head,
        createdAt: new Date(),
      })
      .returning();
    return c.json<NewWebhookResponse>({ webhook: toWebhook(row as Webhook), secret }, 201);
  })

  /** Takes it away; Undo is `POST /:id/restore`. Its deliveries go with it once it is purged. */
  .delete("/:id", async (c) => {
    const row = await mine(c, c.req.param("id"));
    if (!row) return apiError(c, 404, "not_found", notFound);
    await c.var.db.update(webhooks).set({ deletedAt: new Date() }).where(eq(webhooks.id, row.id));
    return c.body(null, 204);
  })

  .post("/:id/restore", async (c) => {
    const row = await mine(c, c.req.param("id"), true);
    if (!row) return apiError(c, 404, "not_found", notFound);
    // What happened while it was gone isn't sent when it comes back.
    const head =
      (
        await c.var.db
          .select({ head: sql<number>`coalesce(max(${changes.seq}), 0)` })
          .from(changes)
          .get()
      )?.head ?? 0;
    const [restored] = await c.var.db
      .update(webhooks)
      .set({ deletedAt: null, cursor: head })
      .where(eq(webhooks.id, row.id))
      .returning();
    return c.json({ webhook: toWebhook(restored as Webhook) });
  })

  /** The latest deliveries, newest first. */
  .get("/:id/deliveries", async (c) => {
    const row = await mine(c, c.req.param("id"));
    if (!row) return apiError(c, 404, "not_found", notFound);
    const rows = await c.var.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, row.id))
      .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
      .limit(RECENT_DELIVERIES);
    return c.json<DeliveriesResponse>({ deliveries: rows.map(toDelivery) });
  })

  /** "Send a test event": a made-up change, sent now. Answers with how it went. */
  .post("/:id/test", async (c) => {
    const row = await mine(c, c.req.param("id"));
    if (!row) return apiError(c, 404, "not_found", notFound);
    const now = new Date();
    const id = crypto.randomUUID();
    const change: Change = {
      seq: 0,
      entity: "item",
      id: "test",
      itemId: null,
      action: "updated",
      actor: actorOf(c.var.user),
      at: now.getTime(),
    };
    const payload: WebhookPayload = {
      deliveryId: id,
      webhookId: row.id,
      test: true,
      changes: [change],
      cursor: 0,
      more: false,
      reset: false,
    };
    const [created] = await c.var.db
      .insert(webhookDeliveries)
      .values({
        id,
        webhookId: row.id,
        seq: null,
        payload: JSON.stringify(payload),
        nextAt: now,
        createdAt: now,
        giveUpAt: new Date(now.getTime() + RETRY_WINDOW_MS),
      })
      .returning();
    const sent = await sendNow(c.env, c.var.db, row, created as WebhookDelivery);
    return c.json<DeliveryResponse>({ delivery: toDelivery(sent) }, 201);
  })

  /** Tries a delivery again now, whatever became of it, with a fresh day of retries. */
  .post("/:id/deliveries/:deliveryId/retry", async (c) => {
    const row = await mine(c, c.req.param("id"));
    if (!row) return apiError(c, 404, "not_found", notFound);
    const delivery = await c.var.db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.id, c.req.param("deliveryId")), eq(webhookDeliveries.webhookId, row.id)))
      .get();
    if (!delivery) return apiError(c, 404, "not_found", "That delivery isn't here.");
    return c.json<DeliveryResponse>({ delivery: toDelivery(await sendNow(c.env, c.var.db, row, delivery)) });
  });

async function mine(c: { var: AppEnv["Variables"] }, id: string, deleted = false) {
  const row = await c.var.db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.ownerId, c.var.user.id)))
    .get();
  return row && Boolean(row.deletedAt) === deleted ? row : null;
}
