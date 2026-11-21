import type { Comment, CommentsResponse, UnreadCommentsResponse } from "@shared/comments";
import { isUnread } from "@shared/comments";
import { type QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { isOnline } from "./connection";
import { reactTo } from "./reactions";
import { canEdit } from "./read-only";
import { unreadQuery } from "./unread-comments";

// --- queries --------------------------------------------------------------------------------------

/** One thread; the root "comments" is what the change feed refreshes and the offline copy keeps. */
export const commentsQuery = (itemId: string) =>
  queryOptions({
    queryKey: ["comments", itemId] as const,
    queryFn: async () => {
      const answer = await api<CommentsResponse>(`/items/${itemId}/comments`);
      // An answer that was on its way while a comment was sent (or one the server read before the send landed) doesn't
      // have it yet: it stays in the thread until its own answer comes.
      const unsent = [...unsentComments.values()].filter(
        (c) => c.itemId === itemId && !answer.comments.some((known) => known.id === c.id),
      );
      return unsent.length ? { ...answer, comments: [...answer.comments, ...unsent] } : answer;
    },
    staleTime: 30_000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
  });

// --- drafts: a half-written comment survives navigation and reloads --------------------------------

const DRAFT_PREFIX = "spaghetti.comment-draft.";
const drafts = new Map<string, string>();
const draftListeners = new Set<() => void>();

function readDraft(itemId: string): string {
  const known = drafts.get(itemId);
  if (known !== undefined) return known;
  let text = "";
  try {
    text = localStorage.getItem(DRAFT_PREFIX + itemId) ?? "";
  } catch {
    // Storage blocked: the draft lives as long as the page.
  }
  drafts.set(itemId, text);
  return text;
}

/** Sets (or, with an empty text, clears) the draft of a thread, on this device. */
export function setDraft(itemId: string, text: string) {
  drafts.set(itemId, text);
  try {
    if (text) localStorage.setItem(DRAFT_PREFIX + itemId, text);
    else localStorage.removeItem(DRAFT_PREFIX + itemId);
  } catch {
    // See above.
  }
  for (const listener of draftListeners) listener();
}

/** The thread's draft and its setter. Shared by every field showing the same thread (the inline one, the phone sheet). */
export function useDraft(itemId: string): [string, (text: string) => void] {
  const text = useSyncExternalStore(
    (listener) => {
      draftListeners.add(listener);
      return () => draftListeners.delete(listener);
    },
    () => readDraft(itemId),
    () => "",
  );
  return [text, (next) => setDraft(itemId, next)];
}

// --- writing ---------------------------------------------------------------------------------------

const withComments = (queryClient: QueryClient, itemId: string, change: (list: Comment[]) => Comment[]) =>
  queryClient.setQueryData<CommentsResponse>(commentsQuery(itemId).queryKey, (current) =>
    current ? { ...current, comments: change(current.comments) } : current,
  );

/** Comments sent and not yet answered, as they are in the thread now (an edit updates them): see commentsQuery. */
const unsentComments = new Map<string, Comment>();

const SEND_RETRIES = [1500, 4000];

/** Comments on their way to the server, by id: a change to one (edit, delete) goes after its send, or it would find nothing. */
const sending = new Map<string, Promise<void>>();
/** Sends that gave up: a delete waiting for one has nothing to do. */
const failedSends = new Set<string>();
class Skipped extends Error {}
const afterSend = (id: string) => sending.get(id) ?? Promise.resolve();

/** Comments whose first send failed and wait to be retried: their text is only in memory until they land. */
const retrying = new Map<string, { itemId: string; body: string; restored?: boolean }>();

if (typeof window !== "undefined") {
  // A page that goes away between retries (a reload, a phone app switch) would lose them: back into the draft they go.
  window.addEventListener("pagehide", () => {
    for (const entry of retrying.values()) {
      const { itemId, body } = entry;
      const typed = readDraft(itemId);
      if (entry.restored) continue;
      setDraft(itemId, typed ? `${body}\n${typed}` : body);
      entry.restored = true;
    }
  });
}

/**
 * Sends a comment: it is in the thread at once, the draft is cleared, and the request goes in the
 * background (retried twice). If it still can't be sent the text goes back into the draft, so nothing
 * typed is ever lost.
 */
export function sendComment(queryClient: QueryClient, itemId: string, me: string, text: string) {
  const body = text.trim();
  if (!body || !canEdit()) return false;
  const id = crypto.randomUUID();
  const comment: Comment = { id, itemId, authorId: me, via: null, body, createdAt: Date.now(), editedAt: null };
  unsentComments.set(id, comment);
  // Before the thread has loaded there is no copy to add to: it starts as this one comment, and the answer joins it.
  if (!queryClient.getQueryData(commentsQuery(itemId).queryKey)) {
    queryClient.setQueryData<CommentsResponse>(commentsQuery(itemId).queryKey, { comments: [comment], readAt: null });
  } else withComments(queryClient, itemId, (list) => [...list, comment]);
  setDraft(itemId, "");
  const done = (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const { comment: saved } = await api<{ comment: Comment }>(`/items/${itemId}/comments`, {
          method: "POST",
          json: { id, body },
        });
        const sent = retrying.get(id);
        retrying.delete(id);
        // The page came back (back/forward cache) and the retry landed: it is not unsent any more.
        if (sent?.restored) setDraft(itemId, readDraft(itemId).replace(`${body}\n`, "").replace(body, ""));
        // Edited meanwhile: the new words stay (the answer still has the first ones).
        withComments(queryClient, itemId, (list) =>
          list.map((c) =>
            c.id === id ? (c.body === body ? saved : { ...saved, body: c.body, editedAt: c.editedAt }) : c,
          ),
        );
        // Writing counts as reading the thread; the server did the same.
        queryClient.setQueryData<CommentsResponse>(commentsQuery(itemId).queryKey, (current) =>
          current ? { ...current, readAt: Math.max(current.readAt ?? 0, saved.createdAt) } : current,
        );
        void queryClient.invalidateQueries({ queryKey: unreadQuery.queryKey });
        return;
      } catch (error) {
        const wait = SEND_RETRIES[attempt];
        const final = (error as { status?: number }).status !== undefined && (error as { status: number }).status < 500;
        if (wait === undefined || final) {
          const restored = retrying.get(id)?.restored;
          retrying.delete(id);
          failedSends.add(id);
          withComments(queryClient, itemId, (list) => list.filter((c) => c.id !== id));
          // Back in the box, ahead of anything typed since.
          const typed = readDraft(itemId);
          if (!restored) setDraft(itemId, typed ? `${body}\n${typed}` : body);
          toast.error("Couldn't send that", "Your message is back in the box.");
          return;
        }
        if (!retrying.has(id)) retrying.set(id, { itemId, body });
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  })();
  sending.set(id, done);
  void done.finally(() => {
    sending.delete(id);
    unsentComments.delete(id);
  });
  return true;
}

/** Changes the text of your own comment, at once; put back if the server says no. */
export function editComment(queryClient: QueryClient, comment: Comment, text: string) {
  const body = text.trim();
  if (!body || body === comment.body || !canEdit()) return;
  const edited = { ...comment, body, editedAt: Date.now() };
  if (unsentComments.has(comment.id)) unsentComments.set(comment.id, edited);
  withComments(queryClient, comment.itemId, (list) => list.map((c) => (c.id === comment.id ? edited : c)));
  afterSend(comment.id)
    .then(() => api<{ comment: Comment }>(`/comments/${comment.id}`, { method: "PATCH", json: { body } }))
    .then(({ comment: saved }) =>
      // Edited again since: that newer text stays.
      withComments(queryClient, comment.itemId, (list) =>
        list.map((c) => (c.id === comment.id && c.body === body ? saved : c)),
      ),
    )
    .catch(() => {
      withComments(queryClient, comment.itemId, (list) => list.map((c) => (c.id === comment.id ? comment : c)));
      toast.error("Couldn't change that comment", "It's back as it was.");
    });
}

/** Deletes your comment at once and offers Undo. */
export function deleteComment(queryClient: QueryClient, comment: Comment) {
  if (!canEdit()) return;
  unsentComments.delete(comment.id);
  withComments(queryClient, comment.itemId, (list) => list.filter((c) => c.id !== comment.id));
  const put = () =>
    withComments(queryClient, comment.itemId, (list) =>
      list.some((c) => c.id === comment.id) ? list : [...list, comment].sort((a, b) => a.createdAt - b.createdAt),
    );
  const deleted = afterSend(comment.id)
    .then(() => {
      // The send it waited for failed: the comment is already out of the thread and its words are back in the box.
      if (failedSends.delete(comment.id)) throw new Skipped();
      return api(`/comments/${comment.id}`, { method: "DELETE" });
    })
    .catch((error) => {
      if (error instanceof Skipped) throw error;
      put();
      toast.error("Couldn't delete that comment", "It's back where it was.");
      throw new Error("delete failed");
    });
  deleted.catch(() => undefined);
  toast.undo("Comment deleted", {
    description: comment.body.length > 60 ? `${comment.body.slice(0, 59)}…` : comment.body,
    onUndo: async () => {
      try {
        await deleted;
      } catch {
        return;
      }
      put();
      try {
        const { comment: restored } = await api<{ comment: Comment }>(`/comments/${comment.id}/restore`, {
          method: "POST",
        });
        withComments(queryClient, comment.itemId, (list) => list.map((c) => (c.id === comment.id ? restored : c)));
      } catch {
        withComments(queryClient, comment.itemId, (list) => list.filter((c) => c.id !== comment.id));
        toast.error("Couldn't bring it back", "Try again in a moment.");
      }
    },
  });
}

/** Gives or takes back your reaction to a comment, at once (lib/reactions.ts). */
export function reactToComment(queryClient: QueryClient, comment: Comment, kind: string, me: string) {
  reactTo(
    {
      path: `/comments/${comment.id}`,
      read: () =>
        queryClient
          .getQueryData<CommentsResponse>(commentsQuery(comment.itemId).queryKey)
          ?.comments.find((c) => c.id === comment.id)?.reactions,
      write: (reactions) =>
        withComments(queryClient, comment.itemId, (list) =>
          list.map((c) => (c.id === comment.id ? { ...c, reactions } : c)),
        ),
    },
    kind,
    me,
    queryClient,
  );
}

// --- reading ---------------------------------------------------------------------------------------

/**
 * Follows a thread, and says "I've read this" while it is open. `dividerAt` is how far the person had read when the
 * thread opened: the "new" divider is computed from it and stays put while they read what is under it, even though
 * the server's read time moves on at once.
 */
export function useThread(itemId: string, me: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery(commentsQuery(itemId));
  const data = query.data;
  // Fixed once the thread has been asked about (not from an old copy kept on the device) or can't be.
  const settled = query.isFetchedAfterMount || query.isError || (!!data && !isOnline());
  const dividerRef = useRef<{ at: number | null } | null>(null);
  if (!dividerRef.current && data && settled) dividerRef.current = { at: data.readAt };

  const unread = !!me && !!data?.comments.some((comment) => isUnread(comment, me, data.readAt));
  const marking = useRef(false);
  useEffect(() => {
    if (!unread || !settled || marking.current || !isOnline() || document.visibilityState === "hidden") return;
    marking.current = true;
    const readAt = Date.now();
    queryClient.setQueryData<CommentsResponse>(commentsQuery(itemId).queryKey, (current) =>
      current ? { ...current, readAt: Math.max(current.readAt ?? 0, readAt) } : current,
    );
    queryClient.setQueryData<UnreadCommentsResponse>(unreadQuery.queryKey, (current) =>
      current ? { threads: current.threads.filter((thread) => thread.itemId !== itemId) } : current,
    );
    api(`/items/${itemId}/comments/read`, { method: "POST" })
      .catch(() => queryClient.invalidateQueries({ queryKey: unreadQuery.queryKey }))
      .finally(() => {
        marking.current = false;
      });
  }, [unread, settled, itemId, queryClient]);

  return {
    comments: data?.comments ?? [],
    isPending: query.isPending,
    dividerAt: dividerRef.current ? dividerRef.current.at : null,
    ready: !!dividerRef.current,
  };
}
