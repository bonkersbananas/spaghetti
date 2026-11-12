/**
 * Webhooks: the change feed (`GET /api/changes`) pushed to an address a person
 * chose, so an agent doesn't have to poll. Each change is POSTed as JSON, signed
 * with HMAC-SHA256 over the timestamp and the body (docs/api.md, "Webhooks";
 * decision 0025).
 */
import type { Change, ChangeAction, ChangeEntity } from "./changes.ts";
import { isPrivateChange, PUBLIC_CHANGE_ENTITIES } from "./changes.ts";

/** What a webhook can ask for: one or more kinds of change (the feed's `entity`), or everything. */
export const WEBHOOK_KINDS = ["all", ...PUBLIC_CHANGE_ENTITIES] as const;
export type WebhookKind = (typeof WEBHOOK_KINDS)[number];

/** In the words the app shows. */
export const WEBHOOK_KIND_LABELS: Record<WebhookKind, string> = {
  all: "Everything",
  item: "Ideas and builds",
  attempt: "Attempts",
  photo: "Photos",
  file: "Slicer files",
  comment: "Comments",
  spool: "Spools",
  recipe: "Recipes",
  shopping: "Shopping list",
  slot: "AMS slots",
  printer: "Printer",
  tag: "Tags",
  agent: "Agents",
  person: "People",
  wishlist: "Wishlists",
  scout: "Idea scout",
};

/** Whether a webhook that asked for `kinds` wants a change of this entity. */
export const wantsChange = (kinds: readonly WebhookKind[], entity: ChangeEntity) =>
  !isPrivateChange(entity) && (kinds.includes("all") || (kinds as readonly string[]).includes(entity));

/** active: deliveries are arriving. failing: one gave up after a day of retries; the next success makes it active again. */
export type WebhookState = "active" | "failing";

/** Never carries the secret: it is shown once, when the webhook is made. */
export interface WebhookInfo {
  id: string;
  url: string;
  kinds: WebhookKind[];
  /** The agent this one is for, if a person said so (a label; it doesn't limit what is sent). */
  agentId: string | null;
  /** The start of the secret ("whsec_Ab3x"), for telling webhooks apart. Never enough to sign. */
  secretPrefix: string;
  state: WebhookState;
  /** What went wrong last, in a sentence; null while all is well. */
  lastError: string | null;
  lastErrorAt: number | null;
  /** The last time a delivery arrived (a 2xx), epoch ms. */
  lastDeliveredAt: number | null;
  createdAt: number;
}

export interface WebhooksResponse {
  webhooks: WebhookInfo[];
}

export interface NewWebhookResponse {
  webhook: WebhookInfo;
  /** The signing secret, once. Only a prefix is readable afterwards. */
  secret: string;
}

/** pending: waiting for its turn or a retry. delivered: the receiver answered 2xx. failed: gave up after a day. */
export const DELIVERY_STATUSES = ["pending", "delivered", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface DeliveryInfo {
  id: string;
  webhookId: string;
  /** The change's cursor; null for a test event. */
  seq: number | null;
  test: boolean;
  /** What the change was about, from its payload: an item, an attempt… `item` for a test event. */
  entity: ChangeEntity;
  action: ChangeAction;
  status: DeliveryStatus;
  /** How many times it has been tried. */
  attempts: number;
  /** The receiver's last HTTP status, if it answered. */
  httpStatus: number | null;
  /** What went wrong on the last try, in a sentence. */
  error: string | null;
  /** The next try, epoch ms, while pending and retrying. */
  nextAt: number | null;
  createdAt: number;
  /** When it last was tried. */
  lastAttemptAt: number | null;
}

export interface DeliveriesResponse {
  deliveries: DeliveryInfo[];
}

export interface DeliveryResponse {
  delivery: DeliveryInfo;
}

/** What is POSTed: the change feed's own shape (`ChangesResponse`), one change at a time, with who it is for. */
export interface WebhookPayload {
  /** Unique per delivery; the same across retries. */
  deliveryId: string;
  webhookId: string;
  /** True for "Send a test event": the change is made up. */
  test: boolean;
  changes: Change[];
  /** The change's `seq`, so a receiver can carry on from there with `GET /api/changes?after=`. */
  cursor: number;
  more: false;
  reset: false;
}

export const SIGNATURE_HEADER = "Spaghetti-Signature";
export const TIMESTAMP_HEADER = "Spaghetti-Timestamp";
export const DELIVERY_HEADER = "Spaghetti-Delivery";
export const SIGNATURE_VERSION = "v1";

/** Every secret starts with this, so a leaked one is easy to spot. */
export const SECRET_PREFIX = "whsec_";
export const SECRET_SHOWN_CHARS = 10;

export const MINUTE = 60 * 1000;
/** Waits before each retry, after the first try fails. Together they stay under RETRY_WINDOW_MS. */
export const RETRY_DELAYS_MS = [1, 5, 30, 120, 360, 720].map((minutes) => minutes * MINUTE);
/** Retries stop a day after the change was made. */
export const RETRY_WINDOW_MS = 24 * 60 * MINUTE;
/** A receiver has this long to answer. */
export const DELIVERY_TIMEOUT_MS = 10_000;
/** The most webhooks a person keeps. */
export const MAX_WEBHOOKS = 10;
/** How many deliveries the app shows for a webhook. */
export const RECENT_DELIVERIES = 20;
/** Finished deliveries are kept this long, then the daily cron removes them. */
export const DELIVERIES_KEEP_MS = 7 * 24 * 60 * MINUTE;

/** The sentence the Agents page shows for a webhook's state. */
export const webhookStatusText = (webhook: Pick<WebhookInfo, "state" | "lastError">) =>
  webhook.state === "failing" ? `Failing: ${webhook.lastError ?? "no answer"}` : "Working";
