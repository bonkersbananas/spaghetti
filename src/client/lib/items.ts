import type {
  Attempt,
  AttemptFile,
  Item,
  ItemResponse,
  ItemStage,
  ItemsResponse,
  Person,
  Photo,
  PhotoResponse,
  UnscrapRequest,
} from "@shared/api";
import { byPrintTime, describeChanges, mergeNote, unionTags } from "@shared/attempts";
import { type QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { ApiError, api } from "./api";
import {
  type OutboxEntry,
  type OutboxState,
  outbox,
  type PendingAttempt,
  type PendingFile,
  type PendingFinish,
  type UploadProgress,
  useOutbox,
} from "./outbox";
import { peopleQuery } from "./queries";
import { canEdit } from "./read-only";
import { forgetItem } from "./recent";
import { useAutosave, useFollowServer } from "./use-autosave";

/** Ideas live in one list, builds (building, done, shelved) in the other. */
export type ItemList = "ideas" | "builds";
export const listOf = (stage: ItemStage): ItemList => (stage === "idea" ? "ideas" : "builds");
const LISTS: ItemList[] = ["ideas", "builds"];

export const itemKeys = {
  all: ["items"] as const,
  list: (list: ItemList) => ["items", "list", list] as const,
  detail: (id: string) => ["items", "detail", id] as const,
};

/** The ideas inbox, newest first. */
export const ideasQuery = queryOptions({
  queryKey: itemKeys.list("ideas"),
  queryFn: async () => (await api<ItemsResponse>("/items?stage=idea")).items,
});

/** Every build, whatever its stage; the builds screen sorts and groups them. */
export const buildsQuery = queryOptions({
  queryKey: itemKeys.list("builds"),
  queryFn: async () => (await api<ItemsResponse>("/items?stage=building,done,shelved")).items,
});

export function itemQuery(id: string) {
  return queryOptions({
    queryKey: itemKeys.detail(id),
    queryFn: async () => {
      try {
        return (await api<ItemResponse>(`/items/${id}`)).item;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}

/** A photo as the UI shows it: from the server, or still on its way there. */
export interface PhotoView extends Photo {
  /** Set while the photo is only on this device. */
  upload?: UploadProgress | { status: "queued"; progress: 0 };
}

/** A slicer file as the UI shows it: on the server, or still on this device. */
export interface AttemptFileView extends AttemptFile {
  /** Still on its way to the server. */
  pending?: boolean;
  /** For a file still on its way: the saved file it will replace, which removing it must remove too. */
  replaces?: AttemptFile | null;
}

/** An attempt as the UI shows it, numbered from the first print. */
export interface AttemptView extends Omit<Attempt, "file"> {
  file: AttemptFileView | null;
  /** 1 for the first attempt. */
  number: number;
  /** The server doesn't have it yet. */
  pending: boolean;
  /** Finished on this device; the finish is waiting to be sent. */
  finishQueued?: boolean;
}

export interface ItemView extends Omit<Item, "photos" | "attempts"> {
  photos: PhotoView[];
  /** Oldest first. */
  attempts: AttemptView[];
  /** The server doesn't have it yet. */
  pending: boolean;
}

const sortPhotos = <T extends Photo>(photos: T[]) =>
  [...photos].sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);

/** Numbers attempts and works out what changed between them, as the server does. */
export function viewAttempts(
  attempts: Attempt[],
  pendingIds: ReadonlySet<string> = new Set(),
  pendingFiles: readonly PendingFile[] = [],
): AttemptView[] {
  const ordered = byPrintTime(attempts);
  return ordered.map((attempt, index) => {
    const before = ordered[index - 1];
    const waiting = pendingFiles.find((file) => file.attemptId === attempt.id);
    return {
      ...attempt,
      // A copy saved before parts existed has none.
      parts: attempt.parts ?? [],
      changes: before ? describeChanges(before.settings, attempt.settings) : [],
      file: waiting ? { ...fromPendingFile(waiting), replaces: attempt.file } : attempt.file,
      number: index + 1,
      pending: pendingIds.has(attempt.id),
    };
  });
}

/** A slicer file still on this device, as the attempt shows it. */
function fromPendingFile(file: PendingFile): AttemptFileView {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    stored: !!file.file,
    hasThumb: !!file.thumb,
    plate: file.plate,
    plateCount: file.plateCount,
    slicer: file.slicer ?? null,
    prefill: file.prefill,
    objects: file.objects ?? [],
    createdAt: file.queuedAt,
    pending: true,
  };
}

const sortByNewest = (items: Item[]) => items.sort((a, b) => b.createdAt - a.createdAt || (b.id > a.id ? 1 : -1));

/**
 * Applies a change to an item wherever it is cached: its list and its
 * detail. A change of stage moves it from the ideas to the builds or back.
 */
export function patchCachedItem(queryClient: QueryClient, id: string, change: (item: Item) => Item | null) {
  let moved: Item | undefined;
  for (const list of LISTS) {
    queryClient.setQueryData<Item[]>(itemKeys.list(list), (items) =>
      items?.flatMap((item) => {
        if (item.id !== id) return [item];
        const next = change(item);
        if (!next) return [];
        if (listOf(next.stage) === list) return [next];
        moved = next;
        return [];
      }),
    );
  }
  const detail = queryClient.setQueryData<Item | null>(itemKeys.detail(id), (item) => (item ? change(item) : item));
  // Make sure it is in the list it now belongs to (the detail copy is the fresher one).
  const target = detail ?? moved;
  if (!target) return;
  queryClient.setQueryData<Item[]>(itemKeys.list(listOf(target.stage)), (items) =>
    items && !items.some((item) => item.id === id) ? sortByNewest([...items, target]) : items,
  );
}

/** Puts an item into its list (newest first) and its detail cache. */
export function insertCachedItem(queryClient: QueryClient, item: Item) {
  for (const list of LISTS) {
    queryClient.setQueryData<Item[]>(itemKeys.list(list), (items) => {
      if (!items) return items;
      const rest = items.filter((existing) => existing.id !== item.id);
      return list === listOf(item.stage) ? sortByNewest([...rest, item]) : rest;
    });
  }
  queryClient.setQueryData(itemKeys.detail(item.id), item);
}

/** Finds an item in the cache: its detail, else whichever list holds it. */
export function cachedItem(queryClient: QueryClient, id: string): Item | undefined {
  const detail = queryClient.getQueryData<Item | null>(itemKeys.detail(id));
  if (detail) return detail;
  for (const list of LISTS) {
    const found = queryClient.getQueryData<Item[]>(itemKeys.list(list))?.find((item) => item.id === id);
    if (found) return found;
  }
  return undefined;
}

/** Keeps the caches in step with what the outbox delivers. */
export function connectOutbox(queryClient: QueryClient) {
  // What an attempt used comes off its spools on the server: ask for their grams again once it lands.
  const spoolsMoved = () => void queryClient.invalidateQueries({ queryKey: ["spools"] });
  outbox.handlers = {
    itemSaved: (item) => {
      // Edits made on the server copy since win over the outbox's.
      const cached = queryClient.getQueryData<Item | null>(itemKeys.detail(item.id));
      insertCachedItem(queryClient, cached ? { ...item, title: cached.title, note: cached.note } : item);
      // A capture that is just a model link is drafted by Claude in the background, once it is on the server.
      void import("./drafts").then((drafts) => drafts.draftSavedCapture(queryClient, item));
    },
    attemptSaved: (attempt) => {
      patchCachedItem(queryClient, attempt.itemId, (item) => ({
        ...item,
        // Logging an attempt makes an idea a build, on the server too.
        stage: item.stage === "idea" ? "building" : item.stage,
        startedAt: item.startedAt ?? attempt.createdAt,
        attempts: [...item.attempts.filter((a) => a.id !== attempt.id), attempt],
      }));
      if (attempt.outcome) spoolsMoved();
    },
    attemptFinished: (attempt, { finished, pending, photos }) => {
      spoolsMoved();
      patchCachedItem(queryClient, attempt.itemId, (item) => ({
        ...item,
        attempts: item.attempts.map((a) => (a.id === attempt.id ? attempt : a)),
      }));
      if (finished) return;
      // Someone else gave it an outcome first: theirs stands, and what was added is said once.
      const people = queryClient.getQueryData<Person[]>(peopleQuery.queryKey);
      const who = people?.find((person) => person.id === attempt.finishedBy)?.name ?? "Someone";
      const saved = cachedItem(queryClient, attempt.itemId);
      const number = saved ? viewAttempts(saved.attempts).find((a) => a.id === attempt.id)?.number : undefined;
      const added = [photos > 0 && (photos === 1 ? "photo" : "photos"), pending.note.trim() && "note"].filter(Boolean);
      toast.message(
        `${who} had already finished attempt ${number ?? ""}`.trim(),
        added.length
          ? `Your ${added.join(" and ")} ${added.length > 1 || photos > 1 ? "were" : "was"} added.`
          : undefined,
      );
    },
    photoSaved: (photo) => {
      patchCachedItem(queryClient, photo.itemId, (item) => ({
        ...item,
        photos: sortPhotos([...item.photos.filter((p) => p.id !== photo.id), photo]),
      }));
      // A photo of an attempt may start Claude looking at it (decision 0023): ask for the attempt's state now.
      if (photo.attemptId) void queryClient.invalidateQueries({ queryKey: itemKeys.detail(photo.itemId) });
    },
    fileSaved: (attempt) =>
      patchCachedItem(queryClient, attempt.itemId, (item) => ({
        ...item,
        attempts: item.attempts.map((a) => (a.id === attempt.id ? { ...a, file: attempt.file } : a)),
      })),
    photoDropped: (message) => toast.error("Photo not saved", message),
  };
  void outbox.resume();
}

function pendingPhotos(entry: OutboxEntry | undefined, state: OutboxState, after: Photo[]): PhotoView[] {
  if (!entry) return [];
  const known = new Set(after.map((photo) => photo.id));
  const last = after.reduce((max, photo) => Math.max(max, photo.position), -1);
  return entry.photos
    .filter((photo) => !known.has(photo.id))
    .map((photo, index) => ({
      id: photo.id,
      itemId: entry.itemId,
      attemptId: photo.attemptId ?? null,
      needsResize: false,
      position: photo.position ?? last + 1 + index,
      width: photo.processed?.width ?? 4,
      height: photo.processed?.height ?? 3,
      color: photo.processed?.color ?? "",
      takenAt: photo.processed?.takenAt ?? null,
      createdBy: entry.create?.createdBy ?? "",
      createdAt: entry.queuedAt,
      upload: state.progress[photo.id] ?? { status: "queued", progress: 0 },
    }));
}

function fromPendingAttempt(itemId: string, attempt: PendingAttempt): Attempt {
  return {
    ...attempt,
    itemId,
    finishedAt: attempt.outcome ? attempt.createdAt : null,
    endedAt: null,
    suggestedFailureTag: null,
    photoRead: null,
    finishedBy: attempt.outcome ? attempt.createdBy : null,
    createdVia: null,
    finishedVia: null,
    parts: attempt.parts ?? [],
    changes: [],
    file: null,
    updatedAt: attempt.createdAt,
  };
}

/** A print still printing on the server, shown as finished once its queued finish says so (the server decides when it lands). */
function applyFinish(attempt: Attempt, finish: PendingFinish): Attempt {
  return {
    ...attempt,
    outcome: finish.outcome,
    finishedAt: finish.finishedAt,
    note: mergeNote(attempt.note, finish.note),
    failureTags:
      finish.outcome === "success" ? attempt.failureTags : unionTags(attempt.failureTags, finish.failureTags),
    successNotes:
      finish.outcome === "failed" ? attempt.successNotes : unionTags(attempt.successNotes, finish.successNotes),
  };
}

function withAttempts(itemId: string, saved: Attempt[], entry: OutboxEntry | undefined): AttemptView[] {
  const finishes = entry?.finishes ?? [];
  const attempts = finishes.length
    ? saved.map((attempt) => {
        const finish = attempt.outcome === null ? finishes.find((f) => f.attemptId === attempt.id) : undefined;
        return finish ? applyFinish(attempt, finish) : attempt;
      })
    : saved;
  const files = entry?.files ?? [];
  const queued = new Set(finishes.map((finish) => finish.attemptId));
  const flag = (views: AttemptView[]) =>
    queued.size ? views.map((view) => (queued.has(view.id) ? { ...view, finishQueued: true } : view)) : views;
  if (!entry?.attempts?.length) return flag(viewAttempts(attempts, new Set(), files));
  const known = new Set(attempts.map((attempt) => attempt.id));
  const pending = entry.attempts.filter((attempt) => !known.has(attempt.id));
  return flag(
    viewAttempts(
      [...attempts, ...pending.map((attempt) => fromPendingAttempt(itemId, attempt))],
      new Set(pending.map((attempt) => attempt.id)),
      files,
    ),
  );
}

function withOutbox(item: Item, state: OutboxState): ItemView {
  const entry = state.entries.find((e) => e.itemId === item.id);
  const photos = [...item.photos, ...pendingPhotos(entry, state, item.photos)];
  return {
    ...item,
    // A pending attempt on an idea makes it a build straight away, as the server will.
    stage: item.stage === "idea" && entry?.attempts?.length ? "building" : item.stage,
    photos: entry ? sortPhotos(photos) : photos,
    parts: item.parts ?? [],
    attempts: withAttempts(item.id, item.attempts, entry),
    pending: false,
  };
}

function fromEntry(entry: OutboxEntry, state: OutboxState): ItemView | null {
  if (!entry.create) return null;
  const stage = entry.create.stage ?? (entry.attempts?.length ? "building" : "idea");
  return {
    id: entry.itemId,
    stage,
    title: entry.create.title,
    note: entry.create.note,
    createdBy: entry.create.createdBy,
    createdVia: null,
    createdAt: entry.create.createdAt,
    updatedAt: entry.create.createdAt,
    startedAt: stage === "idea" ? null : entry.create.createdAt,
    finishedAt: null,
    coverPhotoId: null,
    upNext: null,
    forWhom: null,
    parts: [],
    photos: sortPhotos(pendingPhotos(entry, state, [])),
    attempts: withAttempts(entry.itemId, [], entry),
    draft: null,
    pending: true,
  };
}

/** Server items plus what the outbox still holds for one list, newest first. */
function useList(list: ItemList) {
  const query = useQuery(list === "ideas" ? ideasQuery : buildsQuery);
  const state = useOutbox();
  const items = useMemo(() => {
    const server = query.data ?? [];
    const onServer = new Set(server.map((item) => item.id));
    const pending = state.entries
      .filter((entry) => !onServer.has(entry.itemId))
      .map((entry) => fromEntry(entry, state))
      .filter((item): item is ItemView => item !== null && listOf(item.stage) === list);
    const fromServer = server.map((item) => withOutbox(item, state)).filter((item) => listOf(item.stage) === list);
    return [...pending, ...fromServer].sort((a, b) => b.createdAt - a.createdAt || (b.id > a.id ? 1 : -1));
  }, [query.data, state, list]);
  return { items, isPending: query.isPending && !state.entries.length, error: query.error, refetch: query.refetch };
}

/**
 * The inbox as people see it: what the server has, plus captures still on
 * their way there (shown at once, with the local photo and upload progress).
 */
export function useIdeas() {
  return useList("ideas");
}

/** Every build, including ones still on their way to the server. */
export function useBuilds() {
  return useList("builds");
}

/** One item, from the outbox if the server doesn't have it yet. */
export function useItem(id: string) {
  const queryClient = useQueryClient();
  const state = useOutbox();
  const pendingEntry = state.entries.find((entry) => entry.itemId === id && entry.create);
  const query = useQuery({
    ...itemQuery(id),
    enabled: !pendingEntry,
    // Claude is looking at a photo of one of its attempts (decision 0023): ask again now and then instead of waiting
    // for the feed's slower beat, so the suggestion shows as soon as it is there.
    refetchInterval: (current) =>
      current.state.data?.attempts.some((attempt) => attempt.photoRead?.status === "reading") ? 3000 : false,
    // Opened from a list: show what the list already has, at once, as old as the list is
    // (so a list restored from the device is asked about again rather than trusted as fresh).
    initialData: () => {
      for (const list of LISTS) {
        const found = queryClient.getQueryData<Item[]>(itemKeys.list(list))?.find((item) => item.id === id);
        if (found) return found;
      }
      return undefined;
    },
    initialDataUpdatedAt: () => {
      for (const list of LISTS) {
        const state = queryClient.getQueryState<Item[]>(itemKeys.list(list));
        if (state?.data?.some((item) => item.id === id)) return state.dataUpdatedAt;
      }
      return undefined;
    },
  });
  const item = useMemo(() => {
    if (pendingEntry) return fromEntry(pendingEntry, state);
    return query.data ? withOutbox(query.data, state) : query.data;
  }, [pendingEntry, query.data, state]);
  return { item, isPending: !item && query.isPending, error: query.error };
}

/** Saves a title or note change; used by the detail screen's autosave. */
export async function saveItemChanges(
  queryClient: QueryClient,
  id: string,
  changes: { title?: string | null; note?: string; forWhom?: string | null },
) {
  patchCachedItem(queryClient, id, (item) => ({ ...item, ...changes }));
  const { forWhom: _forWhom, ...words } = changes;
  // An idea still in the outbox takes its words there; who it is for waits until the server has it.
  if (outbox.updatePending(id, words)) return;
  const { item } = await api<ItemResponse>(`/items/${id}`, {
    method: "PATCH",
    json: changes,
    // Finishes even if the page is closing.
    keepalive: true,
  });
  patchCachedItem(queryClient, id, (cached) => ({ ...item, photos: cached.photos }));
}

/**
 * The title and note of an idea or build, as fields that autosave. They follow the
 * server's copy (the other person's edit, a note added from the capture sheet) until
 * the person types in one, and a save sends only the field that was changed here:
 * the one beside it may have been edited by the other person meanwhile, and
 * sending its old text back would undo that.
 */
export function useItemFields(item: Pick<ItemView, "id" | "title" | "note" | "forWhom">) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(item.title ?? "");
  const [note, setNote] = useState(item.note);
  const [forWhom, setForWhom] = useState(item.forWhom ?? "");
  // What the server is known to have (as far as this screen has seen or sent).
  const known = useRef({ title: item.title ?? "", note: item.note, forWhom: item.forWhom ?? "" });
  useFollowServer(item.forWhom ?? "", forWhom, setForWhom, (value) => {
    known.current.forWhom = value;
  });
  useFollowServer(item.title ?? "", title, setTitle, (value) => {
    known.current.title = value;
  });
  useFollowServer(item.note, note, setNote, (value) => {
    known.current.note = value;
  });
  const saveState = useAutosave({ title, note, forWhom }, async (value) => {
    const changes: { title?: string | null; note?: string; forWhom?: string | null } = {};
    if (value.title !== known.current.title) changes.title = value.title.trim() || null;
    if (value.note !== known.current.note) changes.note = value.note;
    if (value.forWhom !== known.current.forWhom) changes.forWhom = value.forWhom.trim() || null;
    if (!Object.keys(changes).length) return;
    await saveItemChanges(queryClient, item.id, changes);
    known.current = { title: value.title, note: value.note, forWhom: value.forWhom };
  });
  return { title, setTitle, note, setNote, forWhom, setForWhom, saveState };
}

/** Builds made from the New build tile in this visit: if one is left untouched it removes itself (see discardIfUntouched). */
const fresh = new Set<string>();
export const markFresh = (id: string) => void fresh.add(id);

/**
 * A new build left with nothing in it (no title, note, photo, file or attempt) vanishes without a toast, the way a blank
 * capture does: people open "New build" by a stray tap and then clean up. Only builds made here this visit count, and
 * the empty ones aren't listed under Recently deleted either.
 */
export function discardIfUntouched(queryClient: QueryClient, item: ItemView) {
  if (!fresh.has(item.id)) return;
  const empty =
    item.stage === "building" &&
    !item.title?.trim() &&
    !item.note.trim() &&
    item.photos.length === 0 &&
    item.attempts.length === 0;
  if (!empty) return;
  deleteItem(queryClient, item, { silent: true });
}

/**
 * Deletes an item at once and offers Undo. Works for items the server
 * doesn't have yet, which simply leave the outbox.
 */
export function deleteItem(queryClient: QueryClient, item: ItemView, { silent = false } = {}) {
  if (!canEdit(item.pending)) return;
  fresh.delete(item.id);
  const noun = item.stage === "idea" ? "idea" : "build";
  const cached = queryClient.getQueryData<Item | null>(itemKeys.detail(item.id));
  const pendingEntry = outbox.remove(item.id);
  const onServer = !pendingEntry?.create;
  patchCachedItem(queryClient, item.id, () => null);
  // Gone from the palette's Recent too (it comes back when the item is next opened).
  forgetItem(item.id);
  const deleted = onServer
    ? api(`/items/${item.id}`, { method: "DELETE" }).catch((error) => {
        if (error instanceof ApiError && error.status === 404) return;
        if (silent) return;
        toast.error(`Couldn't delete that ${noun}`, "It's back where it was.");
        if (cached) insertCachedItem(queryClient, cached);
        if (pendingEntry) outbox.restore(pendingEntry);
        throw error;
      })
    : Promise.resolve();

  if (silent) return;
  toast.undo(noun === "idea" ? "Idea deleted" : "Build deleted", {
    description: item.title || undefined,
    onUndo: async () => {
      if (pendingEntry) outbox.restore(pendingEntry);
      if (!onServer) return;
      try {
        await deleted;
      } catch {
        return;
      }
      if (cached) insertCachedItem(queryClient, cached);
      try {
        const { item: restored } = await api<ItemResponse>(`/items/${item.id}/restore`, { method: "POST" });
        insertCachedItem(queryClient, restored);
      } catch {
        toast.error("Couldn't bring it back", "Try again in a moment.");
      }
      void queryClient.invalidateQueries({ queryKey: itemKeys.list(listOf(item.stage)) });
    },
  });
}

/**
 * Scraps a build that began as an idea: it goes back to Ideas as an idea (its attempts are deleted with the
 * build) instead of vanishing, and a toast offers Undo. The caller checks `beganAsIdea(item)`.
 */
export function scrapBuild(queryClient: QueryClient, item: ItemView) {
  if (!canEdit(item.pending)) return;
  const before = queryClient.getQueryData<Item | null>(itemKeys.detail(item.id)) ?? null;
  const name = item.title || item.note.split("\n").find((line) => line.trim()) || "The idea";
  const snapshot: UnscrapRequest = {
    stage: item.stage as UnscrapRequest["stage"],
    startedAt: item.startedAt ?? item.createdAt,
    finishedAt: item.finishedAt,
    coverPhotoId: item.coverPhotoId,
    attemptIds: item.attempts.map((attempt) => attempt.id),
  };
  patchCachedItem(queryClient, item.id, (cached) => ({
    ...cached,
    stage: "idea",
    startedAt: null,
    finishedAt: null,
    coverPhotoId: null,
    upNext: null,
    attempts: [],
  }));
  const scrapped = api<ItemResponse>(`/items/${item.id}/scrap`, { method: "POST" }).then(({ item: saved }) => {
    insertCachedItem(queryClient, saved);
  });
  scrapped.catch(() => {
    toast.error("Couldn't scrap that build", "It's back where it was.");
    if (before) insertCachedItem(queryClient, before);
    void queryClient.invalidateQueries({ queryKey: itemKeys.all });
  });

  toast.undo("Build scrapped", {
    description: `${name} is back in Ideas`,
    onUndo: async () => {
      try {
        await scrapped;
        const { item: restored } = await api<ItemResponse>(`/items/${item.id}/unscrap`, {
          method: "POST",
          json: snapshot,
        });
        insertCachedItem(queryClient, restored);
      } catch {
        toast.error("Couldn't bring it back", "Try again in a moment.");
      }
      void queryClient.invalidateQueries({ queryKey: itemKeys.all });
    },
  });
}

/** Removes one photo at once, with Undo. */
export function removePhoto(queryClient: QueryClient, photo: PhotoView) {
  if (!canEdit(!!photo.upload)) return;
  const pending = outbox.removePhoto(photo.id);
  let removed: Photo | undefined;
  patchCachedItem(queryClient, photo.itemId, (item) => {
    removed = item.photos.find((p) => p.id === photo.id);
    return { ...item, photos: item.photos.filter((p) => p.id !== photo.id) };
  });
  const deleted = removed
    ? api(`/photos/${photo.id}`, { method: "DELETE" }).catch(() => undefined)
    : Promise.resolve(undefined);

  toast.undo("Photo removed", {
    onUndo: async () => {
      if (pending) outbox.restorePhoto(pending.itemId, pending.photo);
      if (!removed) return;
      const restore = removed;
      patchCachedItem(queryClient, photo.itemId, (item) => ({
        ...item,
        photos: sortPhotos([...item.photos.filter((p) => p.id !== restore.id), restore]),
      }));
      await deleted;
      await api<PhotoResponse>(`/photos/${photo.id}/restore`, { method: "POST" }).catch(() =>
        toast.error("Couldn't bring the photo back"),
      );
    },
  });
}

/** Sets a new photo order (the first is the cover), optimistically. */
export async function reorderPhotos(queryClient: QueryClient, itemId: string, photoIds: string[]) {
  patchCachedItem(queryClient, itemId, (item) => {
    const byId = new Map(item.photos.map((photo) => [photo.id, photo]));
    const ordered = photoIds.flatMap((id) => byId.get(id) ?? []);
    const rest = item.photos.filter((photo) => !photoIds.includes(photo.id));
    return { ...item, photos: [...ordered, ...rest].map((photo, position) => ({ ...photo, position })) };
  });
  try {
    const { item } = await api<ItemResponse>(`/items/${itemId}/photos/order`, {
      method: "PUT",
      json: { photoIds },
    });
    patchCachedItem(queryClient, itemId, () => item);
  } catch {
    toast.error("Couldn't save the new order");
    void queryClient.invalidateQueries({ queryKey: itemKeys.all });
  }
}

/**
 * Adds photos to an existing item, or to one of its attempts: they show at
 * once and upload in the background.
 */
export function addPhotosToItem(itemId: string, files: File[], attemptId?: string) {
  if (!files.length) return;
  void outbox.add({
    itemId,
    photos: files.map((file) => ({ id: crypto.randomUUID(), file, ...(attemptId ? { attemptId } : {}) })),
    queuedAt: Date.now(),
  });
}
