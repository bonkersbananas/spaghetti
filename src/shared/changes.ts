/**
 * The change feed (`GET /api/changes`): a record of every write, in order, so
 * that a screen can learn what the other person did and refresh just that.
 * The Worker writes one row per write in the same D1 batch as the write; the
 * client, and later agents and webhooks, read the feed with a cursor.
 */

/** The kinds of change a person's own feed, an agent's token and a webhook can all see. */
export const PUBLIC_CHANGE_ENTITIES = [
  "item",
  "attempt",
  "photo",
  "file",
  "comment",
  "spool",
  "recipe",
  "slot",
  "printer",
  "tag",
  "agent",
  "person",
  "wishlist",
] as const;
/**
 * Changes about how people sign in (a sign-in link used, an invite made, a passkey added). They show in the app's
 * own feed, but never to an agent's token and never in a webhook: those are the people's alone (decision 0026).
 */
export const PRIVATE_CHANGE_ENTITIES = ["signin", "invite", "passkey"] as const;
/** What kind of thing changed. */
export const CHANGE_ENTITIES = [...PUBLIC_CHANGE_ENTITIES, ...PRIVATE_CHANGE_ENTITIES] as const;
export type ChangeEntity = (typeof CHANGE_ENTITIES)[number];
export const isPrivateChange = (entity: ChangeEntity) =>
  (PRIVATE_CHANGE_ENTITIES as readonly string[]).includes(entity);

/** `updated` covers every edit (a stage move, a note, a photo order); `deleted` and `restored` are the soft delete and its undo. */
export const CHANGE_ACTIONS = ["created", "updated", "deleted", "restored"] as const;
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];

/** Who made a change. Today always a person; an agent will be named here too (kind "agent", id its name). */
export const CHANGE_ACTOR_KINDS = ["person", "agent"] as const;
export type ChangeActorKind = (typeof CHANGE_ACTOR_KINDS)[number];

export interface ChangeActor {
  kind: ChangeActorKind;
  /** A person's user id, or an agent's name. */
  id: string;
}

export interface Change {
  /** Position in the feed: the cursor. Strictly increasing, never reused. */
  seq: number;
  entity: ChangeEntity;
  /**
   * The thing's id: a uuid for items, attempts, photos, files, spools and recipes; the slot
   * name ("A1", "Ext") for a slot; "x2d" for the printer; "<kind>:<slug>" for a tag; the
   * owner's user id for a wishlist (never which idea, so a private list stays private).
   */
  id: string;
  /**
   * The idea or build the change belongs to, for an item (its own id), an attempt, a photo
   * or a file: those all show on that item's screen. Null for the pantry and the printer.
   */
  itemId: string | null;
  action: ChangeAction;
  actor: ChangeActor;
  /** Epoch ms. */
  at: number;
}

/**
 * GET /api/changes?after=<cursor>
 *
 * - Without `after`: no changes, only `cursor`, the feed's current end. Start there.
 * - With `after`: the changes with a higher `seq`, oldest first, at most CHANGES_PAGE of them;
 *   `more` says there are further pages (ask again with the new `cursor`).
 * - Nothing new is a tiny answer: `{ changes: [], cursor: after }`.
 * - `reset` means the cursor can't be followed (older than the feed keeps, or from another
 *   database): treat everything as changed and carry on from the `cursor` given.
 */
export interface ChangesResponse {
  changes: Change[];
  cursor: number;
  more: boolean;
  reset: boolean;
}

export const CHANGES_PAGE = 200;
/** The feed keeps this long; the daily cron prunes older rows. */
export const CHANGES_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
