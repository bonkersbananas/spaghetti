import type {
  Attempt,
  AttemptResponse,
  Item,
  ItemResponse,
  ItemStage,
  Photo,
  Tag,
  TagResponse,
  TagsResponse,
} from "@shared/api";
import type { SettingsMerge } from "@shared/attempt-fields";
import {
  type AttemptSettings,
  BUILT_IN_TAGS,
  type Outcome,
  slugify,
  type TagDefinition,
  type TagKind,
} from "@shared/attempts";
import type { BridgeProgress } from "@shared/bridge";
import type { AttemptPart } from "@shared/parts";
import { isOffTheBed, livePrintProgress, printProgress } from "@shared/print-progress";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "@/components/ui/Toast";
import { ApiError, api } from "./api";
import type { DraftPhoto } from "./capture";
import {
  type AttemptView,
  cachedItem,
  type ItemView,
  markFresh,
  type PhotoView,
  patchCachedItem,
  useBuilds,
} from "./items";
import { outbox, type PendingAttemptChanges } from "./outbox";
import { canEdit } from "./read-only";

/** The fields of a stage change, as the server sets them. */
function stageFields(item: Pick<Item, "startedAt">, stage: ItemStage, now = Date.now()) {
  switch (stage) {
    case "idea":
      return { stage, startedAt: null, finishedAt: null };
    case "building":
      return { stage, startedAt: item.startedAt ?? now, finishedAt: null };
    default:
      return { stage, startedAt: item.startedAt ?? now, finishedAt: now };
  }
}

/** Moves an item to another stage at once; the server follows, and a failure puts it back. */
async function changeStage(
  queryClient: QueryClient,
  id: string,
  stage: ItemStage,
  extra: { coverPhotoId?: string | null; upNext?: number | null } = {},
) {
  const before = cachedItem(queryClient, id);
  // Starting a build takes the idea off the Up next queue; the undo can put it back (extra.upNext).
  patchCachedItem(queryClient, id, (item) => ({
    ...item,
    ...stageFields(item, stage),
    ...(stage !== "idea" ? { upNext: null } : {}),
    ...extra,
  }));
  if (outbox.updatePending(id, { stage })) return;
  try {
    const { item: saved } = await api<ItemResponse>(`/items/${id}`, {
      method: "PATCH",
      json: { stage, ...extra },
    });
    patchCachedItem(queryClient, id, (item) => ({
      ...item,
      stage: saved.stage,
      startedAt: saved.startedAt,
      finishedAt: saved.finishedAt,
      coverPhotoId: saved.coverPhotoId,
      upNext: saved.upNext,
      updatedAt: saved.updatedAt,
    }));
  } catch {
    if (before) {
      patchCachedItem(queryClient, id, (item) => ({
        ...item,
        stage: before.stage,
        startedAt: before.startedAt,
        finishedAt: before.finishedAt,
        coverPhotoId: before.coverPhotoId,
        upNext: before.upNext,
      }));
    }
    toast.error("Couldn't save that change", "It's back the way it was. Try again in a moment.");
  }
}

/** An idea goes on the bed: the same record, with its photos and notes, becomes a build. */
export function startBuild(queryClient: QueryClient, item: ItemView) {
  if (!canEdit(item.pending)) return;
  const wasUpNext = cachedItem(queryClient, item.id)?.upNext ?? item.upNext;
  void changeStage(queryClient, item.id, "building");
  toast.undo("Started building", {
    description:
      wasUpNext !== null
        ? "Off the Up next list. It stays in Ideas under Started."
        : "It stays in Ideas under Started. Log the first attempt when it prints.",
    onUndo: () => void changeStage(queryClient, item.id, "idea", wasUpNext !== null ? { upNext: wasUpNext } : {}),
  });
}

/** A build from scratch, with nothing in it yet. Returns its id. */
export function createBuild(createdBy: string): string {
  const itemId = crypto.randomUUID();
  const now = Date.now();
  markFresh(itemId);
  void outbox.add({
    itemId,
    create: { title: null, note: "", createdAt: now, createdBy, stage: "building" },
    photos: [],
    queuedAt: now,
  });
  return itemId;
}

const newest = <T extends Photo>(photos: T[]) =>
  photos.reduce<T | undefined>((best, photo) => (!best || photo.createdAt > best.createdAt ? photo : best), undefined);

/**
 * The photo a build leads with: its final photo once done, else its own
 * cover (from the idea), else the newest photo of its best attempt.
 */
export function heroPhoto(item: Pick<ItemView, "photos" | "attempts" | "coverPhotoId">): PhotoView | undefined {
  const cover = item.coverPhotoId ? item.photos.find((photo) => photo.id === item.coverPhotoId) : undefined;
  return cover ?? item.photos.find((photo) => !photo.attemptId) ?? finalPhotoGuess(item);
}

/** The newest photo of the latest attempt that worked, else the newest of any attempt. */
export function finalPhotoGuess(item: Pick<ItemView, "photos" | "attempts">): PhotoView | undefined {
  const worked = [...item.attempts].reverse().find((attempt) => attempt.outcome === "success");
  const workedPhotos = worked ? item.photos.filter((photo) => photo.attemptId === worked.id) : [];
  return newest(workedPhotos) ?? newest(item.photos.filter((photo) => photo.attemptId)) ?? item.photos[0];
}

/** The newest photo of anything in the build: what the builds list shows for work in progress. */
export function newestPhoto(item: Pick<ItemView, "photos">): PhotoView | undefined {
  return newest(item.photos);
}

/**
 * Marks a build done, with its final photo, in one action. A build that took
 * some spaghetti to get there earns a small moment of delight.
 */
export function finishBuild(queryClient: QueryClient, item: ItemView) {
  if (!canEdit(item.pending)) return;
  const previousCover = item.coverPhotoId;
  const final = finalPhotoGuess(item);
  void changeStage(queryClient, item.id, "done", final && !final.upload ? { coverPhotoId: final.id } : {});
  const undo = () => void changeStage(queryClient, item.id, "building", { coverPhotoId: previousCover });
  const failures = item.attempts.filter((attempt) => attempt.outcome === "failed").length;
  if (failures > 0) {
    const tries = item.attempts.length;
    toast.delight(
      "Al dente",
      `Done in ${tries} attempts, ${failures === 1 ? "one" : failures} of them spaghetti. Worth every strand.`,
      { label: "Undo", onClick: undo },
    );
  } else {
    toast.undo("Build done", { description: item.title ?? undefined, onUndo: undo });
  }
}

export function shelveBuild(queryClient: QueryClient, item: ItemView) {
  if (!canEdit(item.pending)) return;
  const before = item.stage;
  void changeStage(queryClient, item.id, "shelved");
  toast.undo("Shelved", {
    description: "It waits under Builds whenever you want to pick it up again.",
    onUndo: () => void changeStage(queryClient, item.id, before),
  });
}

/** Back on the bed: a done or shelved build becomes active again. */
export function reopenBuild(queryClient: QueryClient, item: ItemView) {
  if (!canEdit(item.pending)) return;
  const before = item.stage;
  void changeStage(queryClient, item.id, "building");
  toast.undo("Back on the bed", { onUndo: () => void changeStage(queryClient, item.id, before) });
}

/** What the attempt sheet hands over when someone logs an attempt. */
export interface AttemptDraft {
  outcome: Outcome | null;
  printedAt: number;
  note: string;
  failureTags: string[];
  successNotes: string[];
  settings: AttemptSettings;
  /** What it printed of the build's parts. */
  parts: AttemptPart[];
  photos: DraftPhoto[];
}

/**
 * Logs an attempt: it shows at once, and the outbox sends it and then its
 * photos in the background, retrying until the server has them.
 */
export function logAttempt(item: Pick<ItemView, "id">, draft: AttemptDraft, createdBy: string): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  void outbox.add({
    itemId: item.id,
    attempts: [
      {
        id,
        outcome: draft.outcome,
        printedAt: Math.min(draft.printedAt, now),
        note: draft.note.trim(),
        failureTags: draft.outcome && draft.outcome !== "success" ? draft.failureTags : [],
        successNotes: draft.outcome && draft.outcome !== "failed" ? draft.successNotes : [],
        settings: draft.settings,
        ...(draft.parts.length ? { parts: draft.parts } : {}),
        createdBy,
        createdAt: now,
      },
    ],
    photos: draft.photos.map((photo) => ({
      id: photo.id,
      attemptId: id,
      ...(photo.processed ? { processed: photo.processed } : { file: photo.file }),
    })),
    queuedAt: now,
  });
  return id;
}

/** What someone added to a note in a form that started from `base`: the rest after it, or all of it if it was rewritten. */
function addedNote(base: string, next: string): string {
  const before = base.trim();
  const after = next.trim();
  if (after === before) return "";
  return before && after.startsWith(before) ? after.slice(before.length).trim() : after;
}

/**
 * Finishes a print that is saved on the server while it can't be reached: the
 * finish waits in the outbox (outcome, when, note and tags) and goes up with
 * its photos when the connection is back. The server only fills what is empty,
 * so it can't overwrite what someone else did meanwhile.
 */
export function queueFinish(
  itemId: string,
  attempt: Pick<AttemptView, "id" | "note">,
  draft: { outcome: Outcome; note: string; failureTags: string[]; successNotes: string[] },
) {
  void outbox.addFinish(itemId, {
    attemptId: attempt.id,
    outcome: draft.outcome,
    finishedAt: Date.now(),
    note: addedNote(attempt.note, draft.note),
    failureTags: draft.failureTags,
    successNotes: draft.successNotes,
  });
}

/** Saves edits to an attempt (autosave): the cache first, then the server or the outbox. */
export async function saveAttemptChanges(
  queryClient: QueryClient,
  itemId: string,
  attemptId: string,
  changes: PendingAttemptChanges,
  /** Which settings `changes.settings` changes, when only some did: the server applies just those to its own copy. */
  settingsMerge?: SettingsMerge,
) {
  const now = Date.now();
  patchCachedItem(queryClient, itemId, (item) => ({
    ...item,
    attempts: item.attempts.map((attempt) =>
      attempt.id === attemptId
        ? {
            ...attempt,
            ...changes,
            finishedAt:
              changes.outcome === undefined ? attempt.finishedAt : changes.outcome ? (attempt.finishedAt ?? now) : null,
          }
        : attempt,
    ),
  }));
  if (outbox.updatePendingAttempt(attemptId, changes)) return;
  const { settings: _whole, ...rest } = changes;
  const { attempt: saved } = await api<AttemptResponse>(`/attempts/${attemptId}`, {
    method: "PATCH",
    // Settings go as the settings that changed (merged on the server), unless the whole object is the change.
    json: settingsMerge ? { ...rest, settingsMerge } : changes,
    keepalive: true,
  });
  // The outcome, filaments or spools may have changed what a spool has left.
  void queryClient.invalidateQueries({ queryKey: ["spools"] });
  // Only what the server works out itself: later local edits stay.
  patchCachedItem(queryClient, itemId, (item) => ({
    ...item,
    attempts: item.attempts.map((attempt) =>
      attempt.id === attemptId ? { ...attempt, finishedAt: saved.finishedAt, updatedAt: saved.updatedAt } : attempt,
    ),
  }));
}

/** Deletes an attempt and its photos at once, with Undo. */
export function deleteAttempt(queryClient: QueryClient, itemId: string, attempt: AttemptView) {
  if (!canEdit(attempt.pending)) return;
  const pending = outbox.removeAttempt(attempt.id);
  const queuedPhotos = pending ? [] : outbox.dropAttemptPhotos(attempt.id);
  let removed: { attempt: Attempt; photos: Photo[] } | undefined;
  patchCachedItem(queryClient, itemId, (item) => {
    const found = item.attempts.find((a) => a.id === attempt.id);
    if (found) removed = { attempt: found, photos: item.photos.filter((photo) => photo.attemptId === attempt.id) };
    return {
      ...item,
      attempts: item.attempts.filter((a) => a.id !== attempt.id),
      photos: item.photos.filter((photo) => photo.attemptId !== attempt.id),
    };
  });
  const putBack = (restore: { attempt: Attempt; photos: Photo[] }) =>
    patchCachedItem(queryClient, itemId, (item) => ({
      ...item,
      attempts: [...item.attempts.filter((a) => a.id !== restore.attempt.id), restore.attempt],
      photos: [...item.photos.filter((photo) => photo.attemptId !== restore.attempt.id), ...restore.photos].sort(
        (a, b) => a.position - b.position || a.createdAt - b.createdAt,
      ),
    }));
  const toRestore = removed;
  const deleted = toRestore
    ? api(`/attempts/${attempt.id}`, { method: "DELETE" }).then(
        () => {
          void queryClient.invalidateQueries({ queryKey: ["spools"] });
          return true;
        },
        (error) => {
          // Already gone on the server: that's what was asked.
          if (error instanceof ApiError && error.status === 404) return true;
          putBack(toRestore);
          outbox.restorePhotos(itemId, queuedPhotos);
          toast.error(`Couldn't delete attempt ${attempt.number}`, "It's back where it was.");
          return false;
        },
      )
    : Promise.resolve(true);

  toast.undo(`Attempt ${attempt.number} deleted`, {
    onUndo: async () => {
      if (pending) outbox.restoreAttempt(pending);
      if (!toRestore) return;
      // The delete failed and the attempt is back already.
      if (!(await deleted)) return;
      putBack(toRestore);
      try {
        await api<AttemptResponse>(`/attempts/${attempt.id}/restore`, { method: "POST" });
        void queryClient.invalidateQueries({ queryKey: ["spools"] });
        // Photos still on this device go up once the attempt is back.
        outbox.restorePhotos(itemId, queuedPhotos);
      } catch {
        toast.error("Couldn't bring the attempt back", "Try again in a moment.");
      }
    },
  });
}

/** The print running right now, if any: the newest attempt still printing, across builds. */
export function usePrintingNow(): { item: ItemView; attempt: AttemptView } | null {
  const { items } = useBuilds();
  return useMemo(() => findPrinting(items), [items]);
}

export function findPrinting(items: ItemView[]): { item: ItemView; attempt: AttemptView } | null {
  let found: { item: ItemView; attempt: AttemptView } | null = null;
  for (const item of items) {
    if (item.stage !== "building") continue;
    for (const attempt of item.attempts) {
      if (attempt.outcome !== null) continue;
      if (!found || attempt.printedAt > found.attempt.printedAt) found = { item, attempt };
    }
  }
  return found;
}

/**
 * Every attempt on the bed that still has no outcome. Prints still printing come first (the one that should be
 * done by now, then the newest), then the ones the printer says are off the bed and wait for "how did it go?".
 * Today lists them all; the sidebar shows the first.
 */
export function printingAttempts(
  items: ItemView[],
  now = Date.now(),
  /** The bridge's report, when there is one: a print it follows is ranked by what the printer says, as its card shows. */
  live?: BridgeProgress | null,
): Array<{ item: ItemView; attempt: AttemptView }> {
  const found: Array<{ item: ItemView; attempt: AttemptView }> = [];
  for (const item of items) {
    if (item.stage !== "building") continue;
    for (const attempt of item.attempts) if (attempt.outcome === null) found.push({ item, attempt });
  }
  const rank = (attempt: AttemptView) =>
    isOffTheBed(attempt)
      ? 2
      : (
            (live?.attemptId === attempt.id ? livePrintProgress(live, now) : null) ??
            printProgress(attempt.printedAt, attempt.settings.estimatedMinutes, now)
          ).state === "due"
        ? 0
        : 1;
  return found.sort((a, b) => rank(a.attempt) - rank(b.attempt) || b.attempt.printedAt - a.attempt.printedAt);
}

/** Failure tags and success notes people added themselves. */
export const tagsQuery = queryOptions({
  queryKey: ["tags"] as const,
  queryFn: async () => (await api<TagsResponse>("/tags")).tags,
  staleTime: 5 * 60_000,
});

/** Built-in tags first, then people's own, for one kind. */
export function useTagOptions(kind: TagKind): TagDefinition[] {
  const { data } = useQuery(tagsQuery);
  return useMemo(() => {
    const builtIn = BUILT_IN_TAGS[kind];
    const own = (data ?? []).filter((tag) => tag.kind === kind && !builtIn.some((b) => b.slug === tag.slug));
    return [...builtIn, ...own.map(({ slug, label }) => ({ slug, label }))];
  }, [data, kind]);
}

/** Adds someone's own tag on the fly; returns its slug, or null when the label has nothing usable. */
export function addTag(queryClient: QueryClient, kind: TagKind, label: string): string | null {
  const trimmed = label.trim().slice(0, 40);
  const slug = slugify(trimmed);
  if (!slug) return null;
  if (BUILT_IN_TAGS[kind].some((tag) => tag.slug === slug)) return slug;
  queryClient.setQueryData<Tag[]>(tagsQuery.queryKey, (tags) =>
    tags?.some((tag) => tag.kind === kind && tag.slug === slug)
      ? tags
      : [...(tags ?? []), { kind, slug, label: trimmed }],
  );
  void api<TagResponse>("/tags", { method: "POST", json: { kind, label: trimmed } }).catch(() =>
    toast.error("Couldn't save that tag", "It's on this attempt, but won't be offered next time."),
  );
  return slug;
}
