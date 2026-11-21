/**
 * Which build a print belongs to (decision 0076), on this device: the builds and ideas it may belong to, moving an
 * attempt to another build (or a new one) with its photos, and the answer "it's new" to the printer's question. The
 * caches change at once; the server follows, and a failure puts everything back. One toast undoes a move.
 */
import type { Item, MoveAttemptResponse, PrintSuggestionsResponse } from "@shared/api";
import { type MatchReason, namesIn, rowWords, sharedWords } from "@shared/print-match";
import { inlineTime } from "@shared/time";
import { type QueryClient, queryOptions, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { type AttemptView, cachedItem, type ItemView, insertCachedItem, patchCachedItem } from "./items";
import { canEdit } from "./read-only";
import { itemName } from "./recent";

/** The builds and ideas an attempt's print may belong to, best first, with why (the server's matcher). */
export function suggestionsQuery(attemptId: string) {
  return queryOptions({
    queryKey: ["print-suggestions", attemptId],
    queryFn: async () => (await api<PrintSuggestionsResponse>(`/attempts/${attemptId}/suggestions`)).suggestions,
    staleTime: 60_000,
  });
}

/** What tells one offered build from another: when it was saved or started, and how far it got. */
function apart(build: ItemView): string {
  if (build.stage === "idea") return `Saved ${inlineTime(build.createdAt)}`;
  const tries = build.attempts.length;
  const started = `Started ${inlineTime(build.startedAt ?? build.createdAt)}`;
  return tries ? `${started} · ${tries} ${tries === 1 ? "attempt" : "attempts"}` : started;
}

/**
 * The guesses for a print, as they read: what they all have in common said once ("Both print planter-v2."), and for
 * each a line of what sets it apart; when their reasons differ, each line is its own reason ("Same file: ring").
 */
export function offerLines(offers: ReadonlyArray<{ build: ItemView; reasons: MatchReason[] }>): {
  shared: string | null;
  lines: string[];
  names: string[];
} {
  const shared = sharedWords(offers);
  return {
    shared,
    lines: offers.map(({ build, reasons }) => (shared ? apart(build) : rowWords(reasons))),
    names: offers.flatMap(({ reasons }) => namesIn(reasons)),
  };
}

/** Where an attempt goes: a build (or idea) there is, or a new build. */
export type MoveTarget = { item: ItemView } | { newBuild: { title: string | null } };

/**
 * Whether the build an attempt leaves goes with it, as the server decides: the build the printer made for this very
 * print, still with the printer's title and nothing else in it or given to it. Comments, reactions and live links the
 * server checks too; a build with them stays, which the answer corrects.
 */
function goesWith(from: ItemView, attempt: AttemptView): boolean {
  const print = attempt.print;
  return (
    !!print &&
    print.ownItemId === from.id &&
    from.title === print.ownTitle &&
    !from.note.trim() &&
    !from.forWhom &&
    !from.twistId &&
    !from.parts.length &&
    !from.files?.length &&
    !from.reactions?.length &&
    from.attempts.every((other) => other.id === attempt.id) &&
    from.photos.every((photo) => photo.attemptId === attempt.id)
  );
}

/** A build made for a moved attempt, as the cache shows it until the server's copy arrives. */
function newBuildItem(id: string, title: string | null, attempt: AttemptView, photos: Item["photos"]): Item {
  const now = Date.now();
  return {
    id,
    stage: "building",
    title,
    note: "",
    createdBy: attempt.createdBy,
    createdVia: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: null,
    coverPhotoId: null,
    upNext: null,
    forWhom: null,
    twistId: null,
    parts: [],
    photos,
    files: [],
    attempts: [],
    draft: null,
    reactions: [],
  };
}

interface MoveOptions {
  attempt: AttemptView;
  /** The build it is in now. */
  from: ItemView;
  to: MoveTarget;
  /** Opens a build (the toast's View, and where a page goes when its build went with the print). */
  go: (itemId: string, attemptId: string) => void;
  /** Called with where it went once the move is under way. */
  onMoved?: (result: { toId: string; fromGoes: boolean }) => void;
}

/**
 * Moves an attempt to another build, an idea (which becomes a build) or a new build, with its photos, note, outcome
 * and settings. A printer's build left empty goes with it. "A new build" for a print the app matched brings back the
 * printer's own build. The toast says where it went, with View and Undo.
 */
export function moveAttempt(queryClient: QueryClient, { attempt, from, to, go, onMoved }: MoveOptions): boolean {
  if (!canEdit(attempt.pending || from.pending)) return false;
  const own = attempt.print?.ownItemId;
  const targetId = "item" in to ? to.item.id : own && own !== from.id ? own : crypto.randomUUID();
  const newTitle = "newBuild" in to ? (to.newBuild.title ?? attempt.print?.name ?? null) : null;
  const fromBefore = cachedItem(queryClient, from.id) ?? (from as Item);
  const toBefore = "item" in to ? (cachedItem(queryClient, to.item.id) ?? (to.item as Item)) : null;
  const fromGoes = goesWith(from, attempt);

  // The attempt and its photos, as they will be in the build they go to.
  const photos = from.photos.filter((photo) => photo.attemptId === attempt.id);
  const base = (toBefore?.photos ?? []).reduce((top, photo) => Math.max(top, photo.position), -1) + 1;
  const moving = photos.map((photo, index) => ({ ...photo, itemId: targetId, position: base + index }));
  const { number: _number, pending: _pending, finishQueued: _queued, ...plain } = attempt;
  const moved = { ...plain, itemId: targetId, parts: [], file: attempt.file } as Item["attempts"][number];

  const show = () => {
    if (fromGoes) patchCachedItem(queryClient, from.id, () => null);
    else {
      patchCachedItem(queryClient, from.id, (cached) => ({
        ...cached,
        attempts: cached.attempts.filter((one) => one.id !== attempt.id),
        photos: cached.photos.filter((photo) => photo.attemptId !== attempt.id),
      }));
    }
    if (toBefore) {
      patchCachedItem(queryClient, targetId, (cached) => ({
        ...cached,
        // An idea becomes a build by its first print.
        ...(cached.stage === "idea" ? { stage: "building", startedAt: Date.now(), upNext: null } : {}),
        attempts: [...cached.attempts.filter((one) => one.id !== attempt.id), moved],
        photos: [...cached.photos, ...moving],
        updatedAt: Date.now(),
      }));
    } else {
      insertCachedItem(queryClient, { ...newBuildItem(targetId, newTitle, attempt, moving), attempts: [moved] });
    }
  };
  const putBack = () => {
    insertCachedItem(queryClient, fromBefore);
    if (toBefore) insertCachedItem(queryClient, toBefore);
    else patchCachedItem(queryClient, targetId, () => null);
  };
  const settle = ({ from: left, to: there }: MoveAttemptResponse, leftId: string) => {
    insertCachedItem(queryClient, there);
    if (left) insertCachedItem(queryClient, left);
    else patchCachedItem(queryClient, leftId, () => null);
    void queryClient.invalidateQueries({ queryKey: ["print-suggestions"] });
  };

  show();
  const sent = api<MoveAttemptResponse>(`/attempts/${attempt.id}/move`, {
    method: "POST",
    json: "item" in to ? { targetId } : { newBuild: { id: targetId, title: newTitle } },
  }).then(
    (answer) => {
      settle(answer, from.id);
      return true;
    },
    () => {
      putBack();
      toast.error("Couldn't move that", "It's back where it was.");
      return false;
    },
  );

  const name =
    "item" in to ? itemName(to.item, to.item.stage === "idea" ? "idea" : "build") : newTitle || "its own build";
  toast.undo(`Moved to ${name}`, {
    description: fromGoes ? `Attempt ${attempt.number}'s build went with it` : undefined,
    view: { label: "View", onClick: () => go(targetId, attempt.id) },
    onUndo: async () => {
      if (!(await sent)) return;
      putBack();
      try {
        settle(await api<MoveAttemptResponse>(`/attempts/${attempt.id}/unmove`, { method: "POST" }), targetId);
      } catch {
        toast.error("Couldn't move it back", "Try again in a moment.");
        void queryClient.invalidateQueries({ queryKey: ["items"] });
      }
    },
  });
  onMoved?.({ toId: targetId, fromGoes });
  return true;
}

/** Sets the printer's question on an attempt in the caches. */
function setAsking(queryClient: QueryClient, itemId: string, attemptId: string, asking: boolean) {
  patchCachedItem(queryClient, itemId, (cached) => ({
    ...cached,
    attempts: cached.attempts.map((one) =>
      one.id === attemptId && one.print ? { ...one, print: { ...one.print, asking } } : one,
    ),
  }));
}

/** "Its own build": the print stays in the build the printer made for it and the question goes; Undo asks again. */
export function keepAsNew(queryClient: QueryClient, item: ItemView, attempt: AttemptView): boolean {
  if (!canEdit(attempt.pending)) return false;
  const send = (asking: boolean) =>
    api(`/attempts/${attempt.id}/print`, { method: "PUT", json: { asking } }).catch(() => {
      setAsking(queryClient, item.id, attempt.id, !asking);
      toast.error("Couldn't save that", "Try again in a moment.");
    });
  setAsking(queryClient, item.id, attempt.id, false);
  const sent = send(false);
  toast.undo("Kept in its own build", {
    description: itemName(item, "build"),
    onUndo: async () => {
      await sent;
      setAsking(queryClient, item.id, attempt.id, true);
      void send(true);
    },
  });
  return true;
}

/**
 * Moving this attempt from where the screen shows it: the toast's View opens the build it went to, and the page of a
 * build that went with it follows the print there.
 */
export function useMoveAttempt(item: ItemView, attempt: AttemptView) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const go = (buildId: string, attemptId: string) =>
    void navigate({ to: "/builds/$buildId", params: { buildId }, search: { attempt: attemptId } });
  return {
    move: (to: MoveTarget) =>
      moveAttempt(queryClient, {
        attempt,
        from: item,
        to,
        go,
        onMoved: ({ toId, fromGoes }) => {
          // Read where the page is when the move goes, not as a hook: the printing card on any screen calls this.
          if (fromGoes && window.location.pathname === `/builds/${item.id}`) go(toId, attempt.id);
        },
      }),
    keep: () => keepAsNew(queryClient, item, attempt),
  };
}
