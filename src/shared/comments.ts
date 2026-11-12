/**
 * The short thread under an idea or build: the types the API speaks, how messages group, where the
 * "new" divider goes and what a push for a burst of comments says. Pure, so the client, the Worker and
 * the unit tests read the same rules (decision 0024).
 */

import { findLinks } from "./links.ts";
import type { Reaction } from "./reactions.ts";

export const COMMENT_MAX = 2000;

/** One comment. `authorId` is the person it counts as; an agent's comment is its owner's, with `via` naming the agent. */
export interface Comment {
  id: string;
  itemId: string;
  authorId: string;
  /** The agent it was written through ("Claude for Alex"), or null. */
  via: string | null;
  body: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms of the last edit, or null if never edited. */
  editedAt: number | null;
  /** Who reacted to it, and how (shared/reactions.ts). Absent in a copy saved by an older version. */
  reactions?: Reaction[];
}

/** GET /api/items/:id/comments: the live comments, oldest first, and how far the signed-in person has read. */
export interface CommentsResponse {
  comments: Comment[];
  /** Epoch ms; the other person's comments created after it are unread. Null: never opened. */
  readAt: number | null;
}

/** GET /api/comments/unread: the threads with comments the signed-in person hasn't read. */
export interface UnreadCommentsResponse {
  threads: Array<{
    itemId: string;
    count: number;
    latestAt: number;
    /** The newest unread comment (the start of its text), for Today's line; absent in a copy saved by an older version. */
    latestId?: string;
    latestAuthorId?: string;
    latestBody?: string;
    /** Its idea's or build's title (null when untitled) and stage, to name it and to link to the right page. */
    title?: string | null;
    stage?: string;
  }>;
}

/** Messages by one person within this long of each other sit together under one name and time. */
export const GROUP_GAP_MS = 5 * 60 * 1000;

export interface MessageGroup {
  kind: "group";
  /** The first message's id: a stable key. */
  key: string;
  authorId: string;
  via: string | null;
  comments: Comment[];
}

export interface NewDivider {
  kind: "new";
}

export type ThreadEntry = MessageGroup | NewDivider;

/** Whether this comment is unread for `me`: the other person's, and written after they last looked. */
export function isUnread(comment: Pick<Comment, "authorId" | "createdAt">, me: string, readAt: number | null) {
  return comment.authorId !== me && (readAt === null || comment.createdAt > readAt);
}

/**
 * Lays a thread out like a messaging app: consecutive comments from one person (through the same agent or
 * not) within GROUP_GAP_MS share a group, and a "new" divider goes before the first comment the person hasn't
 * read, always starting a new group. `dividerAt` is the read time the divider is computed from: the screen
 * keeps the one from when it was opened, so the divider doesn't vanish while you read what's under it.
 */
export function groupThread(
  comments: Comment[],
  { me, dividerAt, gapMs = GROUP_GAP_MS }: { me: string; dividerAt: number | null; gapMs?: number },
): ThreadEntry[] {
  const entries: ThreadEntry[] = [];
  let current: MessageGroup | null = null;
  let dividerPlaced = false;
  for (const comment of comments) {
    let startsNew = false;
    if (!dividerPlaced && isUnread(comment, me, dividerAt)) {
      dividerPlaced = true;
      entries.push({ kind: "new" });
      startsNew = true;
    }
    const last: Comment | undefined = current?.comments[current.comments.length - 1];
    if (
      !startsNew &&
      current &&
      last &&
      current.authorId === comment.authorId &&
      current.via === comment.via &&
      comment.createdAt - last.createdAt <= gapMs
    ) {
      current.comments.push(comment);
      continue;
    }
    current = { kind: "group", key: comment.id, authorId: comment.authorId, via: comment.via, comments: [comment] };
    entries.push(current);
  }
  return entries;
}

/** Quick bursts are told in one push: comments written within this long are waited for before it is sent. */
export const PUSH_BATCH_MS = 20 * 1000;
const PUSH_BODY_MAX = 110;

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * What the push for a batch of comments says: "Marie on Tugboat" over the (first) comment, or over the count
 * and the latest one when there were several. `bodies` are oldest first.
 */
export function commentPushText(author: string, itemTitle: string, bodies: string[]): { title: string; body: string } {
  const title = `${author} on ${squash(itemTitle) || "an idea"}`;
  const clean = bodies.map(squash).filter(Boolean);
  const last = clean[clean.length - 1] ?? "";
  if (clean.length <= 1) return { title, body: clip(last, PUSH_BODY_MAX) };
  return { title, body: clip(`${clean.length} new comments. ${last}`, PUSH_BODY_MAX) };
}

/** Today's line for comments you haven't read: one thread's newest comment, or the count when there are several. */
export function unreadLine(
  threads: UnreadCommentsResponse["threads"],
  nameOf: (authorId: string) => string,
): { lead: string; quote: string; total: number; thread: UnreadCommentsResponse["threads"][number] } | null {
  const [latest] = threads;
  if (!latest?.latestId || !latest.latestAuthorId) return null;
  const total = threads.reduce((sum, thread) => sum + thread.count, 0);
  const what = squash(latest.title ?? "") || (latest.stage === "idea" ? "an idea" : "a build");
  const lead = `${nameOf(latest.latestAuthorId)} on ${what}`;
  const quote = clip(squash(latest.latestBody ?? ""), 90);
  // The count goes in the line's label on Today ("New comments 3"), so the lead names only the latest.
  return { lead, quote, total, thread: latest };
}

/** Where a comment's push opens: the thread on the idea's or build's page. */
export const threadUrl = (itemId: string, stage: string) =>
  `/${stage === "idea" ? "ideas" : "builds"}/${encodeURIComponent(itemId)}?thread=1`;

/**
 * A message that ends with a link (or is only a link) shows that link as a card in place of the raw address;
 * a link in the middle of a sentence stays in the text. `text` is what is left to show in the bubble (may be empty).
 */
export function splitTrailingLink(body: string): { text: string; url: string | null } {
  const trimmed = body.trimEnd();
  const last = findLinks(trimmed).at(-1);
  if (!last || last.end !== trimmed.length) return { text: body, url: null };
  return { text: trimmed.slice(0, last.start).trimEnd(), url: last.url };
}
