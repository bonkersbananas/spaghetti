import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AgentScope } from "../../shared/agents.ts";
import type { AttemptSettings, Outcome, TagKind } from "../../shared/attempts.ts";
import type { BridgeStatusData } from "../../shared/bridge.ts";
import type { ChangeAction, ChangeActorKind, ChangeEntity } from "../../shared/changes.ts";
import type { CoachItem } from "../../shared/coach.ts";
import type { DraftFailure, DraftFindings, ItemDraft } from "../../shared/draft.ts";
import type { ModelSiteId } from "../../shared/model-links.ts";
import type { AttemptPart } from "../../shared/parts.ts";
import type { PersonColor } from "../../shared/people.ts";
import type { PrinterSetup, Remaining } from "../../shared/spools.ts";
import type { DeliveryStatus, WebhookKind, WebhookState } from "../../shared/webhooks.ts";

/** The two people who share the workspace. Made with `pnpm user:add`. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  color: text("color").$type<PersonColor>().notNull(),
  passwordHash: text("password_hash").notNull(),
  /** R2 key of the profile picture (people/<id>/<version>); null means initials. */
  photoKey: text("photo_key"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Signed-in devices. The cookie holds a random token; only its SHA-256 hash
 * is stored, so a leaked database can't be used to sign in.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    userAgent: text("user_agent"),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

/**
 * Wrong current passwords typed when changing one, per person, so the change-password route
 * can't be used to guess. Rows older than the window are ignored and cleared on success.
 */
export const passwordFailures = sqliteTable(
  "password_failures",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("password_failures_user_idx").on(table.userId, table.at)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;

/**
 * Where an item is in its life. A build is the same record as the idea it
 * grew from, moved on; print attempts point at it.
 */
export const ITEM_STAGES = ["idea", "building", "done", "shelved"] as const;
export type ItemStage = (typeof ITEM_STAGES)[number];

/**
 * An idea, and later the build it grows into. Ids are made by the client, so
 * a capture can be shown, queued and retried before the server has it.
 * Deleting sets `deletedAt` (undo clears it); the daily purge removes rows
 * and their photos for good after a while.
 */
export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    stage: text("stage").$type<ItemStage>().notNull().default("idea"),
    title: text("title"),
    note: text("note").notNull().default(""),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    /** The agent it was made through, when it was ("via Claude for Alex"); `createdBy` is then the agent's owner. */
    createdVia: text("created_via"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    /** When it became a build; cleared if it goes back to being an idea. */
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    /** When it was marked done or shelved. */
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    /** The photo picked as the build's final one (checked by the API, not a foreign key). */
    coverPhotoId: text("cover_photo_id"),
    /** Its place in the Up next queue (1 is first), or null when it isn't queued. Only ideas are queued. */
    upNext: integer("up_next"),
    /** Who it is for ("Mila"): optional, shown quietly under the title and searchable. */
    forWhom: text("for_whom"),
  },
  (table) => [index("items_stage_created_idx").on(table.stage, table.createdAt)],
);

/**
 * One go at printing a build: what was printed, how, and how it went. The
 * client picks the id. `outcome` is null while it is still printing.
 * Deleting is soft, like items; the purge removes it (and its photos) later.
 */
export const attempts = sqliteTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    outcome: text("outcome").$type<Outcome>(),
    printedAt: integer("printed_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    /**
     * When the print stopped on the printer (the printer bridge says so), before anyone said how it went.
     * `finishedAt` stays "when an outcome was given".
     */
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    /** A failure tag the printer suggests (a failed or cancelled print, spaghetti seen): a suggestion, never a verdict. */
    suggestedFailureTag: text("suggested_failure_tag"),
    note: text("note").notNull().default(""),
    /** Slugs: built in (shared/attempts.ts) or from the tags table. */
    failureTags: text("failure_tags", { mode: "json" }).$type<string[]>().notNull().default([]),
    successNotes: text("success_notes", { mode: "json" }).$type<string[]>().notNull().default([]),
    settings: text("settings", { mode: "json" }).$type<AttemptSettings>().notNull().default({}),
    /** What it printed of the build's parts, with good pieces counted (shared/parts.ts). */
    parts: text("parts", { mode: "json" }).$type<AttemptPart[]>().notNull().default([]),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    /** Who gave it its outcome (for "Sam had already finished attempt 3"). */
    finishedBy: text("finished_by").references(() => users.id),
    /** The agent it was made / finished through, if any. */
    createdVia: text("created_via"),
    finishedVia: text("finished_via"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("attempts_item_printed_idx").on(table.itemId, table.printedAt),
    // The "how did it go?" nudges look at prints with no outcome, every few minutes: that is a handful of rows.
    index("attempts_open_idx").on(table.printedAt).where(sql`${table.outcome} is null and ${table.deletedAt} is null`),
  ],
);

/**
 * What a build is made of, when it is more than one thing ("Hull half ×2"). Hard-deleted (the client's undo puts
 * the row back under the same id), so attempts' counts for a part that is gone are simply not shown.
 */
export const parts = sqliteTable(
  "parts",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    position: integer("position").notNull().default(0),
    /** One of the build's photos (not a foreign key: a removed photo just stops showing). */
    photoId: text("photo_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("parts_item_idx").on(table.itemId, table.position)],
);

/**
 * Photos, stored in R2 as two WebP or JPEG variants made in the browser:
 * `photos/<id>/large` (about 2048 px) and `photos/<id>/thumb` (about 480 px).
 * Every photo belongs to an item, and optionally to one of its print attempts.
 */
export const photos = sqliteTable(
  "photos",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    /** Order within the item; the lowest is the cover. */
    position: integer("position").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** The photo's average color (#rrggbb), shown while it loads. */
    color: text("color").notNull(),
    contentType: text("content_type").notNull(),
    /** When the picture was taken, from its EXIF data, if the browser could read it. */
    takenAt: integer("taken_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    /** The print attempt it shows, or null for the item's own photos. */
    attemptId: text("attempt_id").references(() => attempts.id, { onDelete: "cascade" }),
    /**
     * It arrived without a browser to resize it (an agent, later the printer bridge): the bytes in R2 are
     * the original, stored as both variants, and `color` is a placeholder. The next signed-in browser
     * that sees it resizes it and uploads the real variants, which clears this.
     */
    needsResize: integer("needs_resize", { mode: "boolean" }).notNull().default(false),
    /** When a browser took the job of resizing it, so two people's browsers don't both do it. */
    resizeClaimedAt: integer("resize_claimed_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("photos_item_idx").on(table.itemId, table.position)],
);

/** Named settings of an attempt that worked (docs/decisions/0017). */
export const recipes = sqliteTable("recipes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  note: text("note").notNull().default(""),
  /** Uppercase filament type of the attempt it came from. */
  material: text("material").notNull(),
  /** The finish of the spool it was printed on, if it had one. */
  finish: text("finish"),
  /** The attempt's chosen settings (shared/recipes.ts recipeSettings); never edited, a newer recipe replaces it. */
  settings: text("settings", { mode: "json" }).$type<AttemptSettings>().notNull().default({}),
  /** The attempt and build it came from. Not foreign keys: the recipe outlives them (the link just goes quiet). */
  sourceAttemptId: text("source_attempt_id"),
  sourceItemId: text("source_item_id"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

/**
 * Failure tags and success notes people added to the built-in ones. The slug
 * is made from the label and is what attempts store.
 */
export const tags = sqliteTable(
  "tags",
  {
    kind: text("kind").$type<TagKind>().notNull(),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.kind, table.slug] })],
);

/**
 * What a link in a note points at: its page's title and site name, kept so a
 * note's link cards cost one fetch per address, not one per look. A page that
 * couldn't be read is remembered too (`failed`), for a day.
 */
export const linkPreviews = sqliteTable("link_previews", {
  url: text("url").primaryKey(),
  title: text("title"),
  site: text("site"),
  failed: integer("failed", { mode: "boolean" }).notNull().default(false),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Claude's draft of an idea from a model page (decision 0019). One row per idea, made when the draft is asked
 * for; `status` is "reading" until a worker has finished (`claimedAt` says which worker is on it, so the cron
 * can pick up one that was lost), then "drafted" or "failed". `result` is what Claude wrote and `applied` which
 * of the idea's empty fields it filled, so undo and the "drafted" mark know what to take back.
 */
export const itemDrafts = sqliteTable("item_drafts", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => items.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  site: text("site").$type<ModelSiteId>().notNull(),
  status: text("status").$type<ItemDraft["status"]>().notNull(),
  failure: text("failure").$type<DraftFailure>(),
  /** When a worker took the job (null: nobody yet); a claim older than a few minutes is abandoned. */
  claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
  /** How many times a worker took it, so a page that keeps timing out isn't tried for ever. */
  tries: integer("tries").notNull().default(0),
  result: text("result", { mode: "json" }).$type<DraftResult>(),
  applied: text("applied", { mode: "json" }).$type<ItemDraft["applied"]>().notNull().default(sql`'[]'`),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  draftedAt: integer("drafted_at", { mode: "timestamp_ms" }),
});

/** One call to Claude, kept for the day's cap (the whole workspace shares it). */
export const draftRuns = sqliteTable("draft_runs", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  at: integer("at", { mode: "timestamp_ms" }).notNull(),
  /** How it ended: "drafted", or why not (see RunDiagnosis in worker/draft/claude.ts). Null while it runs or if the Worker was lost. */
  outcome: text("outcome"),
  /** The rest of the diagnosis as JSON: HTTP status, error type, stop reason, web fetch error codes, the SDK's message. */
  detail: text("detail"),
});

/**
 * Claude looking at one attempt photo (decision 0023): the job, its answer and the record of the run, in one row per
 * photo (a photo is never read twice). Also what the day's cap counts (rows with `ranAt`).
 */
export const photoReads = sqliteTable(
  "photo_reads",
  {
    photoId: text("photo_id")
      .primaryKey()
      .references(() => photos.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    /** reading: waiting or running; read: a suggestion; unsure: Claude couldn't tell; failed: the call didn't work; skipped: the attempt had its outcome first. */
    status: text("status").$type<"reading" | "read" | "unsure" | "failed" | "skipped">().notNull(),
    outcome: text("outcome").$type<Outcome>(),
    failureTags: text("failure_tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    successNotes: text("success_notes", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    reason: text("reason"),
    /** When a worker took the job; a claim older than a few minutes is abandoned (the cron picks it up). */
    claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
    tries: integer("tries").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    /** When the call to Claude was made (what the cap counts); null when it never got that far. */
    ranAt: integer("ran_at", { mode: "timestamp_ms" }),
    /** How it ended: "read", or why not (see worker/photo-read/claude.ts). */
    runOutcome: text("run_outcome"),
    /** The rest of the diagnosis as JSON: model, stop reason, HTTP status, error type, the SDK's message, how long it took. */
    detail: text("detail"),
  },
  (table) => [index("photo_reads_attempt_idx").on(table.attemptId, table.createdAt)],
);

export type PhotoReadRow = typeof photoReads.$inferSelect;

/**
 * The failure coach for one attempt (decision 0026): the job, what Claude suggested for the next try and the record of
 * the run, one row per attempt (an attempt is coached once). Also what the day's cap counts (rows with `ranAt`).
 */
export const coachRuns = sqliteTable("coach_runs", {
  attemptId: text("attempt_id")
    .primaryKey()
    .references(() => attempts.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull(),
  /** thinking: waiting or running; done: suggestions; nothing: Claude had nothing useful to say; failed: the call didn't work; skipped: the attempt wasn't Partly or Spaghetti by then. */
  status: text("status").$type<"thinking" | "done" | "nothing" | "failed" | "skipped">().notNull(),
  /** `[{ id, title, why, settings, note }]` (shared/coach.ts CoachItem without `dismissed`). */
  suggestions: text("suggestions", { mode: "json" })
    .$type<Array<Omit<CoachItem, "dismissed">>>()
    .notNull()
    .default(sql`'[]'`),
  /** Ids of suggestions someone dismissed. */
  dismissed: text("dismissed", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
  tries: integer("tries").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  /** When the call to Claude was made (what the cap counts). */
  ranAt: integer("ran_at", { mode: "timestamp_ms" }),
  /** "done", or why not: nothing, refusal, api_error, timeout, cap… (worker/coach/claude.ts). */
  runOutcome: text("run_outcome"),
  /** Model, stop reason, HTTP status, error type, how long it took; never the prompt. */
  detail: text("detail"),
});

export type CoachRunRow = typeof coachRuns.$inferSelect;
export type ItemDraftRow = typeof itemDrafts.$inferSelect;

export type Item = typeof items.$inferSelect;
export type RecipeRow = typeof recipes.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type Attempt = typeof attempts.$inferSelect;
export type Tag = typeof tags.$inferSelect;

/**
 * The spools on the shelf: the filament library. The client picks the id.
 * A spool's photo (usually its label) is stored like other photos, in R2 as
 * `photos/<photoId>/large` and `/thumb`. Deleting is soft, with undo.
 */
export const spools = sqliteTable(
  "spools",
  {
    id: text("id").primaryKey(),
    /** "PLA", "PETG"… as people (or a slicer file) say it. */
    material: text("material").notNull(),
    brand: text("brand"),
    colorName: text("color_name"),
    /** Lowercase #rrggbb. */
    colorHex: text("color_hex"),
    /** "matte", "silk"… (shared/spools.ts), or people's own word. */
    finish: text("finish"),
    /** The level set by hand (or reported by the AMS). Once the spool has gram data, the level follows the grams instead. */
    remaining: text("remaining").$type<Remaining>().notNull().default("full"),
    /** What the spool held when new, in grams. Null: no gram data, the level stays hand-set (decision 0009). */
    netGrams: integer("net_grams"),
    /** What the empty spool weighs, so a weighing on a scale can leave it out. */
    tareGrams: integer("tare_grams"),
    note: text("note").notNull().default(""),
    driedAt: integer("dried_at", { mode: "timestamp_ms" }),
    photoId: text("photo_id"),
    photoWidth: integer("photo_width"),
    photoHeight: integer("photo_height"),
    photoColor: text("photo_color"),
    /** The RFID tray UUID of a Bambu spool, as the AMS reports it, so the printer bridge finds it again. */
    trayUuid: text("tray_uuid"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("spools_material_idx").on(table.material)],
);

/**
 * A weighing: filament left on a spool at a moment, the baseline the usage after it counts down from.
 * The client picks the id, so a retry is the same weighing. Removing one (the undo) is a delete.
 */
export const spoolWeighings = sqliteTable(
  "spool_weighings",
  {
    id: text("id").primaryKey(),
    spoolId: text("spool_id")
      .notNull()
      .references(() => spools.id, { onDelete: "cascade" }),
    /** Grams of filament left: the scale's figure minus the empty spool. */
    gramsLeft: integer("grams_left").notNull(),
    /** What the scale said, when it was entered that way. */
    onScale: integer("on_scale"),
    weighedAt: integer("weighed_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
  },
  (table) => [index("spool_weighings_spool_idx").on(table.spoolId, table.weighedAt)],
);

/**
 * What is loaded where: AMS slots ("A1" to "D4") and the external spool
 * holder ("Ext"). A spool sits in one slot at most. A deleted spool keeps
 * its row, so undo puts it back where it was; it reads as an empty slot.
 */
export const amsSlots = sqliteTable("ams_slots", {
  slot: text("slot").primaryKey(),
  spoolId: text("spool_id")
    .notNull()
    .unique()
    .references(() => spools.id, { onDelete: "cascade" }),
  updatedBy: text("updated_by")
    .notNull()
    .references(() => users.id),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** The printer as it's set up here: one row (id "x2d"), its setup as JSON. */
export const printer = sqliteTable("printer", {
  id: text("id").primaryKey(),
  setup: text("setup", { mode: "json" }).$type<PrinterSetup>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * What the printer bridge last told the app: one row (id "bridge"). `status` holds the printer's progress and the
 * trays it couldn't match to a spool; `lastSeenAt` moves with every message, so "last heard" is honest.
 */
export const bridge = sqliteTable("bridge", {
  id: text("id").primaryKey(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status", { mode: "json" }).$type<BridgeStatusData>().notNull(),
});

/**
 * The slicer file an attempt was printed from (.3mf or .gcode.3mf): what the
 * browser read from it (`prefill`), its plate's thumbnail, and the file itself
 * in R2 (`files/<id>/file`, `/thumb`) when it was under the size cap. One per
 * attempt; deleting is soft (undo), and the purge removes the bytes.
 */
export const attemptFiles = sqliteTable(
  "attempt_files",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    /** The bytes are in R2; false when the file was over the cap and only what it said is kept. */
    stored: integer("stored", { mode: "boolean" }).notNull(),
    hasThumb: integer("has_thumb", { mode: "boolean" }).notNull(),
    /** Which plate was printed (from 1), of how many. */
    plate: integer("plate").notNull(),
    plateCount: integer("plate_count").notNull(),
    /** "BambuStudio 02.01.00.00" */
    slicer: text("slicer"),
    /** The settings read from the file, so the app can mark the values that came from it. */
    prefill: text("prefill", { mode: "json" }).$type<AttemptSettings>().notNull(),
    /** The object names on that plate, as the file spells them: where a build's parts can come from. */
    objects: text("objects", { mode: "json" }).$type<string[]>().notNull().default([]),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("attempt_files_attempt_idx").on(table.attemptId)],
);

export type Spool = typeof spools.$inferSelect;
export type AmsSlot = typeof amsSlots.$inferSelect;
export type Part = typeof parts.$inferSelect;
export type AttemptFileRow = typeof attemptFiles.$inferSelect;

/**
 * The change feed: one row for every write anyone made (`GET /api/changes`),
 * written in the same D1 batch as the write itself, so it never misses a
 * change or invents one. `seq` is the cursor. Rows are old news after
 * CHANGES_KEEP_MS and are pruned by the daily cron.
 */
export const changes = sqliteTable(
  "changes",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    /** What kind of thing changed: see CHANGE_ENTITIES in shared/changes.ts. */
    entity: text("entity").$type<ChangeEntity>().notNull(),
    /** The thing's id ("A1" for a slot, "failure:warping" for a tag). */
    entityId: text("entity_id").notNull(),
    /** The idea or build it belongs to (an item's own id for an item); null for the pantry and the printer. */
    itemId: text("item_id"),
    action: text("action").$type<ChangeAction>().notNull(),
    /** Who did it: "person" with their user id; "agent" later, with the agent's name. */
    actorKind: text("actor_kind").$type<ChangeActorKind>().notNull(),
    actorId: text("actor_id").notNull(),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("changes_at_idx").on(table.at)],
);

/**
 * A named identity that acts for one of the two people: "Claude for Alex",
 * "Printer bridge". It reaches the API with a bearer token (`agent_tokens`);
 * what it writes is recorded as the owner's (so avatars and "captured by" work
 * as they do) with `created_via` / `finished_via` naming the agent, and in the
 * change feed with the actor `{ kind: "agent", id }`.
 */
export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("agents_owner_idx").on(table.ownerId)],
);

/**
 * An agent's tokens (`Authorization: Bearer spg_…`). Only the SHA-256 hash is
 * stored, plus the first characters (`prefix`) so a person can tell tokens apart.
 * Revoking sets `revokedAt` and takes effect on the next request.
 */
export const agentTokens = sqliteTable(
  "agent_tokens",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    hash: text("hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<AgentScope[]>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    /** Updated at most every few minutes, not on every request. */
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("agent_tokens_agent_idx").on(table.agentId)],
);

export type Agent = typeof agents.$inferSelect;
export type AgentToken = typeof agentTokens.$inferSelect;

/**
 * A device that gets web push: one browser's push subscription for one person. `endpoint` is the push service's
 * address for it (unique; a 404 or 410 from it removes the row). `timeZone` is the device's, for quiet hours.
 * `alsoOthers`: also tell this person about the other person's prints.
 */
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    timeZone: text("time_zone").notNull(),
    alsoOthers: integer("also_others", { mode: "boolean" }).notNull().default(false),
    /** Also tell this device when printer upkeep is due (at most one nudge a day, shared/upkeep.ts). */
    upkeepNudges: integer("upkeep_nudges", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("push_subscriptions_user_idx").on(table.userId)],
);

/** A "how did it go?" nudge that went out (or was claimed) for an attempt and a person: at most one each, ever. */
export const pushNudges = sqliteTable(
  "push_nudges",
  {
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"off_the_bed" | "overdue">().notNull(),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.attemptId, table.userId] })],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

/**
 * A printer upkeep task ("Clean the build plate") with its interval in print hours and/or days, whichever
 * comes first. The starting list is seeded on first read (shared/upkeep.ts). `nudgedAt` is when its "due" nudge
 * went out (cleared by Done), so it is nudged once. Deleting is soft, with undo.
 */
export const upkeepTasks = sqliteTable("upkeep_tasks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  note: text("note").notNull().default(""),
  intervalHours: integer("interval_hours"),
  intervalDays: integer("interval_days"),
  position: integer("position").notNull(),
  nudgedAt: integer("nudged_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

/** One "Done" on a task: who, when, the printer's hours at that moment, an optional note and photo (in R2 like any photo). */
export const upkeepLogs = sqliteTable(
  "upkeep_logs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => upkeepTasks.id, { onDelete: "cascade" }),
    doneBy: text("done_by")
      .notNull()
      .references(() => users.id),
    doneVia: text("done_via"),
    doneAt: integer("done_at", { mode: "timestamp_ms" }).notNull(),
    printerHours: real("printer_hours").notNull(),
    note: text("note").notNull().default(""),
    photoId: text("photo_id"),
    photoWidth: integer("photo_width"),
    photoHeight: integer("photo_height"),
    photoColor: text("photo_color"),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("upkeep_logs_task_idx").on(table.taskId, table.doneAt)],
);

/** What Claude wrote for a draft: the text, the findings, and the pictures it pointed at. */
export interface DraftResult {
  title: string | null;
  note: string | null;
  findings: DraftFindings;
  /** The photos it stored on the idea, so undo can take them off again. */
  photoIds: string[];
}

/**
 * A comment in the short thread under an idea or build. The client picks the id (so sending is idempotent and
 * optimistic), `authorId` is the person it counts as (an agent's comment is its owner's, with `via` naming the
 * agent), `editedAt` is set once the body changed. Deleting is soft with an undo; the daily purge removes it
 * after 30 days (decision 0006). `notifiedAt` is when a push for it was claimed (null: not yet), so a burst of
 * comments is told in one push.
 */
export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    via: text("via"),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    notifiedAt: integer("notified_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("comments_item_idx").on(table.itemId, table.createdAt)],
);

/**
 * How far one person has read one thread: the comments of the other person created after `readAt` are unread
 * for them. Per person, never shared (decision 0024).
 */
export const commentReads = sqliteTable(
  "comment_reads",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    readAt: integer("read_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.itemId] })],
);

export type CommentRow = typeof comments.$inferSelect;

/**
 * A webhook: the change feed POSTed to `url`, signed with a secret (decision 0025). The secret is stored
 * encrypted (`secretEnc`: AES-GCM under a key derived from a Worker secret), because the HMAC key has to
 * be recoverable to sign; a copy of the database alone can't sign anything. `cursor` is the last change
 * (`changes.seq`) already turned into a delivery.
 */
export const webhooks = sqliteTable(
  "webhooks",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    kinds: text("kinds", { mode: "json" }).$type<WebhookKind[]>().notNull(),
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    secretEnc: text("secret_enc").notNull(),
    secretPrefix: text("secret_prefix").notNull(),
    state: text("state").$type<WebhookState>().notNull().default("active"),
    lastError: text("last_error"),
    lastErrorAt: integer("last_error_at", { mode: "timestamp_ms" }),
    lastDeliveredAt: integer("last_delivered_at", { mode: "timestamp_ms" }),
    cursor: integer("cursor").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("webhooks_owner_idx").on(table.ownerId)],
);

/**
 * One change (or a test event) on its way to one webhook. `payload` is the JSON that is sent, kept so a retry
 * sends the same bytes (the change feed only holds ids, nothing personal). `nextAt` is when it is due while
 * pending; a lease on it keeps two runs from sending it twice.
 */
export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    /** The change's `seq`; null for a test event. */
    seq: integer("seq"),
    payload: text("payload").notNull(),
    status: text("status").$type<DeliveryStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    httpStatus: integer("http_status"),
    error: text("error"),
    nextAt: integer("next_at", { mode: "timestamp_ms" }),
    lastAttemptAt: integer("last_attempt_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    /** Retrying stops at this time (a day after `createdAt`; a manual retry starts a new window). */
    giveUpAt: integer("give_up_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("webhook_deliveries_due_idx").on(table.status, table.nextAt),
    index("webhook_deliveries_webhook_idx").on(table.webhookId, table.createdAt),
    // A change becomes a delivery once per webhook, however often the fan-out runs.
    uniqueIndex("webhook_deliveries_seq_idx").on(table.webhookId, table.seq),
  ],
);

export type Webhook = typeof webhooks.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
