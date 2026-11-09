import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
 * Where an item is in its life. Phase 2 has ideas only; a build is the same
 * record moved on (phase 3 adds print attempts that point at it).
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
  },
  (table) => [index("items_stage_created_idx").on(table.stage, table.createdAt)],
);

/**
 * Photos, stored in R2 as two WebP or JPEG variants made in the browser:
 * `photos/<id>/large` (about 2048 px) and `photos/<id>/thumb` (about 480 px).
 * Every photo belongs to an item; phase 3 adds an optional attempt.
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
  },
  (table) => [index("photos_item_idx").on(table.itemId, table.position)],
);

export type Item = typeof items.$inferSelect;
export type Photo = typeof photos.$inferSelect;
