import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { AgentScope } from "../../shared/agents.ts";
import type { AttemptSettings, Outcome, TagKind } from "../../shared/attempts.ts";
import type { BridgeStatusData } from "../../shared/bridge.ts";
import type { ChangeAction, ChangeActorKind, ChangeEntity } from "../../shared/changes.ts";
import type { PersonColor } from "../../shared/people.ts";
import type { PrinterSetup, Remaining } from "../../shared/spools.ts";

/** The two people who share the workspace. Made with `pnpm user:add`. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  color: text("color").$type<PersonColor>().notNull(),
  passwordHash: text("password_hash").notNull(),
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
