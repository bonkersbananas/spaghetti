import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { AttemptSettings, Outcome, TagKind } from "../../shared/attempts.ts";
import type { PersonColor } from "../../shared/people.ts";

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
    note: text("note").notNull().default(""),
    /** Slugs: built in (shared/attempts.ts) or from the tags table. */
    failureTags: text("failure_tags", { mode: "json" }).$type<string[]>().notNull().default([]),
    successNotes: text("success_notes", { mode: "json" }).$type<string[]>().notNull().default([]),
    settings: text("settings", { mode: "json" }).$type<AttemptSettings>().notNull().default({}),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("attempts_item_printed_idx").on(table.itemId, table.printedAt)],
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
  },
  (table) => [index("photos_item_idx").on(table.itemId, table.position)],
);

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

export type Item = typeof items.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type Attempt = typeof attempts.$inferSelect;
export type Tag = typeof tags.$inferSelect;
