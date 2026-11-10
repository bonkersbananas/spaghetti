import { type SQL, sql } from "drizzle-orm";
import type { Change, ChangeAction, ChangeActor, ChangeEntity } from "../shared/changes.ts";
import type { Db } from "./db/index.ts";
import { changes, type User } from "./db/schema.ts";

/** Who is acting: the signed-in person. An agent working for someone will be named here later. */
export const actorOf = (user: Pick<User, "id">): ChangeActor => ({ kind: "person", id: user.id });

export interface ChangeInput {
  entity: ChangeEntity;
  id: string | SQL;
  /** The idea or build it belongs to; an item's own id for an item. May be a subquery. */
  itemId?: string | SQL | null;
  action: ChangeAction;
  actor: ChangeActor;
}

/**
 * The statement that records a change, to go in `db.batch([...])` right after
 * the write it describes. It inserts only if that write changed a row
 * (`changes() > 0`, SQLite's count for the statement before it), so a write
 * that did nothing (a retry of a capture, a delete of something already
 * deleted) records nothing, and the feed and the data are committed or
 * rolled back together. Statements that follow it can chain on it the same way
 * (`changes() > 0` is true when the change was recorded).
 */
export function recordChange(db: Db, input: ChangeInput) {
  // NULL for `seq` lets SQLite number the row.
  return db
    .insert(changes)
    .select(sql`SELECT NULL, ${input.entity}, ${input.id}, ${input.itemId ?? null}, ${input.action},
    ${input.actor.kind}, ${input.actor.id}, ${Date.now()} WHERE changes() > 0`);
}

/** A row of the changes table as the API shows it. */
export function toApiChange(row: typeof changes.$inferSelect): Change {
  return {
    seq: row.seq,
    entity: row.entity,
    id: row.entityId,
    itemId: row.itemId,
    action: row.action,
    actor: { kind: row.actorKind, id: row.actorId },
    at: row.at.getTime(),
  };
}

/** The statement `sql\`changes() > 0\`` as a condition: "the statement before this one changed something". */
export const afterChange = sql`changes() > 0`;

/** The item an attempt belongs to, as a subquery, for statements that only know the attempt's id. */
export const itemOfAttempt = (attemptId: string) => sql`(SELECT item_id FROM attempts WHERE id = ${attemptId})`;

/** The id of an attempt's file (one at a time), as a subquery. */
export const fileOfAttempt = (attemptId: string) => sql`(SELECT id FROM attempt_files WHERE attempt_id = ${attemptId})`;
