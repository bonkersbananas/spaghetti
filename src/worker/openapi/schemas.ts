import { z } from "zod";
import { AGENT_SCOPES } from "../../shared/agents.ts";
import { OUTCOMES } from "../../shared/attempts.ts";
import { CHANGE_ACTIONS, CHANGE_ACTOR_KINDS, CHANGE_ENTITIES } from "../../shared/changes.ts";
import { LABEL_FIELDS } from "../../shared/label-read.ts";
import { REACTION_KINDS } from "../../shared/reactions.ts";
import { DELIVERY_STATUSES, WEBHOOK_KINDS } from "../../shared/webhooks.ts";
import { settings } from "../routes/attempts.ts";

/**
 * What the API answers, as zod schemas, for the OpenAPI document. The requests are described by the schemas the
 * routes validate with; the answers are plain objects built by the routes, so these are written to match the
 * types in shared/ (and test/worker/openapi.test.ts checks real answers against them, so they can't drift).
 * Nested detail that is long and rarely needed (an attempt's settings) is described once, loosely.
 */

const epoch = z.number().int().describe("Epoch milliseconds.");
const id = z.string().describe("A UUID.");

export const ApiError = z
  .object({
    error: z.object({
      code: z.string().describe("Stable, for code to branch on."),
      message: z.string().describe("A plain sentence."),
    }),
  })
  .meta({ id: "Error", description: "Every refusal looks like this." });

export const Ok = z.object({ ok: z.literal(true) }).meta({ id: "Ok" });

export const Person = z
  .object({
    id,
    username: z.string(),
    name: z.string(),
    color: z.string(),
    photoUrl: z.string().nullable().describe("Their picture, versioned, or null for initials."),
  })
  .meta({ id: "Person" });

export const Wishlist = z
  .object({
    personId: id,
    private: z.boolean().describe("Kept to themselves; someone else's private list comes with no entries."),
    entries: z
      .array(z.object({ itemId: id, position: z.number().int().describe("1 is the top."), addedAt: z.number() }))
      .describe("Top first; ideas only."),
  })
  .meta({ id: "Wishlist" });

export const Photo = z
  .object({
    id,
    itemId: id,
    position: z.number().int(),
    width: z.number().int(),
    height: z.number().int(),
    color: z.string().describe("Average color, #rrggbb."),
    takenAt: epoch.nullable(),
    attemptId: id.nullable(),
    needsResize: z.boolean(),
    createdBy: id,
    createdAt: epoch,
  })
  .meta({ id: "Photo", description: "Its pixels are at /api/photos/{id}/large and /thumb." });

const Part = z
  .object({
    id,
    itemId: id,
    name: z.string(),
    quantity: z.number().int(),
    position: z.number().int(),
    photoId: id.nullable(),
    createdAt: epoch,
    updatedAt: epoch,
  })
  .meta({ id: "Part" });

const AttemptFile = z
  .object({
    id,
    name: z.string(),
    size: z.number().int(),
    stored: z.boolean(),
    hasThumb: z.boolean(),
    plate: z.number().int(),
    plateCount: z.number().int(),
    slicer: z.string().nullable(),
    prefill: settings,
    objects: z.array(z.string()),
    createdAt: epoch,
  })
  .meta({ id: "AttemptFile" });

export const Attempt = z
  .object({
    id,
    itemId: id,
    outcome: z.enum(OUTCOMES).nullable().describe("Null while it is still printing."),
    printedAt: epoch,
    finishedAt: epoch.nullable(),
    endedAt: epoch.nullable().describe("When the printer bridge saw the print stop."),
    suggestedFailureTag: z.string().nullable(),
    photoRead: z
      .looseObject({})
      .nullable()
      .describe("What Claude made of the attempt's photo; only ever a suggestion."),
    coach: z
      .looseObject({})
      .nullable()
      .describe("What Claude suggests trying next after a Partly or Spaghetti answer; only ever suggestions."),
    note: z.string(),
    failureTags: z.array(z.string()),
    successNotes: z.array(z.string()),
    settings,
    parts: z.array(z.object({ partId: id, count: z.number().int() })),
    changes: z.array(z.looseObject({})).describe("What changed since the attempt before it."),
    file: AttemptFile.nullable(),
    createdBy: id,
    createdVia: id.nullable().describe("The agent it was logged through."),
    finishedBy: id.nullable(),
    finishedVia: id.nullable(),
    createdAt: epoch,
    updatedAt: epoch,
  })
  .meta({ id: "Attempt" });

export const Reaction = z
  .object({ kind: z.enum(REACTION_KINDS), userId: id.describe("Who gave it."), at: epoch })
  .meta({ id: "Reaction", description: "One person's reaction to an idea, build or comment." });

export const Item = z
  .object({
    id,
    stage: z.enum(["idea", "building", "done", "shelved"]),
    title: z.string().nullable(),
    note: z.string(),
    createdBy: id,
    createdVia: id.nullable().describe("The agent it was captured through."),
    createdAt: epoch,
    updatedAt: epoch,
    startedAt: epoch.nullable(),
    finishedAt: epoch.nullable(),
    coverPhotoId: id.nullable(),
    upNext: z.number().int().nullable(),
    forWhom: z.string().nullable(),
    parts: z.array(Part),
    photos: z.array(Photo),
    attempts: z.array(Attempt),
    draft: z.looseObject({}).nullable().describe("Claude's draft from a model page, while there is one."),
    reactions: z.array(Reaction).describe("Who reacted, and how, oldest first."),
  })
  .meta({ id: "Item", description: "An idea, or a build (an idea that is being printed)." });

export const Change = z
  .object({
    seq: z.number().int().describe("Position in the feed: the cursor."),
    entity: z.enum(CHANGE_ENTITIES),
    id: z.string().describe('The thing\'s id (a slot\'s name, "x2d" for the printer, "<kind>:<slug>" for a tag).'),
    itemId: id.nullable().describe("The idea or build it belongs to."),
    action: z.enum(CHANGE_ACTIONS),
    actor: z.object({ kind: z.enum(CHANGE_ACTOR_KINDS), id: z.string() }),
    at: epoch,
  })
  .meta({ id: "Change" });

export const ChangesResponse = z
  .object({
    changes: z.array(Change),
    cursor: z.number().int(),
    more: z.boolean().describe("Ask again with the new cursor."),
    reset: z.boolean().describe("The cursor couldn't be followed: treat everything as changed."),
  })
  .meta({ id: "ChangesResponse" });

export const Spool = z
  .object({
    id,
    material: z.string(),
    brand: z.string().nullable(),
    colorName: z.string().nullable(),
    colorHex: z.string().nullable(),
    finish: z.string().nullable(),
    remaining: z.string().describe("The level: derived from the grams when there are gram data."),
    netGrams: z.number().int().nullable(),
    tareGrams: z.number().int().nullable(),
    gramsLeft: z.number().nullable(),
    gramsApproximate: z.boolean(),
    weighedAt: epoch.nullable(),
    note: z.string(),
    driedAt: epoch.nullable(),
    photo: z.object({ id, width: z.number(), height: z.number(), color: z.string() }).nullable(),
    slot: z.string().nullable().describe('"A1" to "D4", "Ext", or null.'),
    trayUuid: z.string().nullable(),
    diameterMm: z.number().nullable(),
    nozzleTempMin: z.number().int().nullable(),
    nozzleTempMax: z.number().int().nullable(),
    bedTempMin: z.number().int().nullable(),
    bedTempMax: z.number().int().nullable(),
    dryTempC: z.number().int().nullable(),
    dryHours: z.number().int().nullable(),
    productCode: z.string().nullable().describe("Bambu's RFID or product code, when a label printed one."),
    fromLabel: z
      .array(z.enum(LABEL_FIELDS))
      .describe("The fields Claude filled in from a label photo that nobody has edited since."),
    labelRead: z
      .object({
        status: z.enum(["reading", "multiple", "unreadable", "failed", "cap"]),
        photoId: id,
        spools: z.array(z.record(z.string(), z.unknown())).describe("The spools found, for status `multiple`."),
      })
      .nullable()
      .describe("A label read going on, waiting for a tap, or that found nothing; null otherwise."),
    createdBy: id,
    createdAt: epoch,
    updatedAt: epoch,
  })
  .meta({ id: "Spool" });

const AgentToken = z
  .object({
    id,
    prefix: z.string().describe("The start of the token, for telling tokens apart."),
    scopes: z.array(z.enum(AGENT_SCOPES)),
    createdAt: epoch,
    lastUsedAt: epoch.nullable(),
    revokedAt: epoch.nullable(),
  })
  .meta({ id: "AgentToken" });

export const Agent = z
  .object({
    id,
    name: z.string(),
    ownerId: id,
    createdAt: epoch,
    tokens: z.array(AgentToken),
    connection: z
      .object({
        app: z.string(),
        scopes: z.array(z.enum(AGENT_SCOPES)),
        connected: z.boolean(),
        connectedAt: epoch,
        lastUsedAt: epoch.nullable(),
      })
      .nullable()
      .describe("Set for an app connected by OAuth (its short-lived tokens are not listed)."),
  })
  .meta({ id: "Agent", description: "Tokens are listed only for their owner." });

export const NewToken = z
  .object({ agent: Agent, tokenId: id, token: z.string().describe("Shown once; only a hash is kept.") })
  .meta({ id: "NewToken" });

export const Webhook = z
  .object({
    id,
    url: z.string(),
    kinds: z.array(z.enum(WEBHOOK_KINDS)),
    agentId: id.nullable(),
    secretPrefix: z.string(),
    state: z.enum(["active", "failing"]),
    lastError: z.string().nullable(),
    lastErrorAt: epoch.nullable(),
    lastDeliveredAt: epoch.nullable(),
    createdAt: epoch,
  })
  .meta({ id: "Webhook", description: "Never carries the secret." });

export const Delivery = z
  .object({
    id,
    webhookId: id,
    seq: z.number().int().nullable().describe("The change's cursor; null for a test event."),
    test: z.boolean(),
    entity: z.enum(CHANGE_ENTITIES),
    action: z.enum(CHANGE_ACTIONS),
    status: z.enum(DELIVERY_STATUSES),
    attempts: z.number().int(),
    httpStatus: z.number().int().nullable(),
    error: z.string().nullable(),
    nextAt: epoch.nullable(),
    createdAt: epoch,
    lastAttemptAt: epoch.nullable(),
  })
  .meta({ id: "Delivery" });

export const WebhookPayload = z
  .object({
    deliveryId: id.describe("The same across retries: dedupe on it."),
    webhookId: id,
    test: z.boolean(),
    changes: z.array(Change).length(1),
    cursor: z.number().int().describe("The change's seq."),
    more: z.literal(false),
    reset: z.literal(false),
  })
  .meta({
    id: "WebhookPayload",
    description: "What a webhook receives: the change feed's own shape, one change at a time.",
  });

/** An answer whose top-level keys are known and whose insides are described in docs/api.md. */
export const loose = (description: string, shape: Record<string, z.ZodType> = {}) =>
  z.looseObject(shape).meta({ description });

export const list = <T extends z.ZodType>(key: string, of: T) => z.object({ [key]: z.array(of) });
export const one = <T extends z.ZodType>(key: string, of: T) => z.object({ [key]: of });
