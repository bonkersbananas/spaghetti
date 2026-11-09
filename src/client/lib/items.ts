import type { Item, ItemResponse, ItemsResponse, Photo, PhotoResponse } from "@shared/api";
import { type QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "@/components/ui/Toast";
import { ApiError, api } from "./api";
import { type OutboxEntry, type OutboxState, outbox, type UploadProgress, useOutbox } from "./outbox";

export const itemKeys = {
  all: ["items"] as const,
  list: (stage: Item["stage"]) => ["items", "list", stage] as const,
  detail: (id: string) => ["items", "detail", id] as const,
};

/** The ideas inbox, newest first. */
export const ideasQuery = queryOptions({
  queryKey: itemKeys.list("idea"),
  queryFn: async () => (await api<ItemsResponse>("/items?stage=idea")).items,
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

export interface ItemView extends Omit<Item, "photos"> {
  photos: PhotoView[];
  /** The server doesn't have it yet. */
  pending: boolean;
}

const sortPhotos = (photos: Photo[]) =>
  [...photos].sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);

/** Applies a change to an item wherever it is cached: its list and its detail. */
export function patchCachedItem(queryClient: QueryClient, id: string, change: (item: Item) => Item | null) {
  queryClient.setQueriesData<Item[]>({ queryKey: ["items", "list"] }, (items) =>
    items?.flatMap((item) => {
      if (item.id !== id) return [item];
      const next = change(item);
      return next ? [next] : [];
    }),
  );
  queryClient.setQueryData<Item | null>(itemKeys.detail(id), (item) => (item ? change(item) : item));
}

/** Puts an item into its list (newest first) and its detail cache. */
export function insertCachedItem(queryClient: QueryClient, item: Item) {
  queryClient.setQueryData<Item[]>(itemKeys.list(item.stage), (items) => {
    if (!items) return items;
    const rest = items.filter((existing) => existing.id !== item.id);
    return [...rest, item].sort((a, b) => b.createdAt - a.createdAt || (b.id > a.id ? 1 : -1));
  });
  queryClient.setQueryData(itemKeys.detail(item.id), item);
}

/** Keeps the caches in step with what the outbox delivers. */
export function connectOutbox(queryClient: QueryClient) {
  outbox.handlers = {
    itemSaved: (item) => {
      // Edits made on the server copy since win over the outbox's.
      const cached = queryClient.getQueryData<Item | null>(itemKeys.detail(item.id));
      insertCachedItem(queryClient, cached ? { ...item, title: cached.title, note: cached.note } : item);
    },
    photoSaved: (photo) =>
      patchCachedItem(queryClient, photo.itemId, (item) => ({
        ...item,
        photos: sortPhotos([...item.photos.filter((p) => p.id !== photo.id), photo]),
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

function withOutbox(item: Item, state: OutboxState): ItemView {
  const entry = state.entries.find((e) => e.itemId === item.id);
  const photos = [...item.photos, ...pendingPhotos(entry, state, item.photos)];
  return { ...item, photos: entry ? sortPhotos(photos) : photos, pending: false };
}

function fromEntry(entry: OutboxEntry, state: OutboxState): ItemView | null {
  if (!entry.create) return null;
  return {
    id: entry.itemId,
    stage: "idea",
    title: entry.create.title,
    note: entry.create.note,
    createdBy: entry.create.createdBy,
    createdAt: entry.create.createdAt,
    updatedAt: entry.create.createdAt,
    photos: sortPhotos(pendingPhotos(entry, state, [])),
    pending: true,
  };
}

/**
 * The inbox as people see it: what the server has, plus captures still on
 * their way there (shown at once, with the local photo and upload progress).
 */
export function useIdeas() {
  const query = useQuery(ideasQuery);
  const state = useOutbox();
  const items = useMemo(() => {
    const server = query.data ?? [];
    const onServer = new Set(server.map((item) => item.id));
    const pending = state.entries
      .filter((entry) => !onServer.has(entry.itemId))
      .map((entry) => fromEntry(entry, state))
      .filter((item): item is ItemView => item !== null);
    return [...pending, ...server.map((item) => withOutbox(item, state))].sort(
      (a, b) => b.createdAt - a.createdAt || (b.id > a.id ? 1 : -1),
    );
  }, [query.data, state]);
  return { items, isPending: query.isPending && !state.entries.length, error: query.error, refetch: query.refetch };
}

/** One item, from the outbox if the server doesn't have it yet. */
export function useItem(id: string) {
  const queryClient = useQueryClient();
  const state = useOutbox();
  const pendingEntry = state.entries.find((entry) => entry.itemId === id && entry.create);
  const query = useQuery({
    ...itemQuery(id),
    enabled: !pendingEntry,
    // Opened from the inbox: show what the list already has, at once.
    initialData: () => queryClient.getQueryData<Item[]>(itemKeys.list("idea"))?.find((item) => item.id === id),
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
  changes: { title?: string | null; note?: string },
) {
  patchCachedItem(queryClient, id, (item) => ({ ...item, ...changes }));
  if (outbox.updatePending(id, changes)) return;
  const { item } = await api<ItemResponse>(`/items/${id}`, {
    method: "PATCH",
    json: changes,
    // Finishes even if the page is closing.
    keepalive: true,
  });
  patchCachedItem(queryClient, id, (cached) => ({ ...item, photos: cached.photos }));
}

/**
 * Deletes an item at once and offers Undo. Works for items the server
 * doesn't have yet, which simply leave the outbox.
 */
export function deleteItem(queryClient: QueryClient, item: ItemView) {
  const cached = queryClient.getQueryData<Item | null>(itemKeys.detail(item.id));
  const pendingEntry = outbox.remove(item.id);
  const onServer = !pendingEntry?.create;
  patchCachedItem(queryClient, item.id, () => null);
  const deleted = onServer
    ? api(`/items/${item.id}`, { method: "DELETE" }).catch((error) => {
        if (error instanceof ApiError && error.status === 404) return;
        toast.error("Couldn't delete that idea", "It's back where it was.");
        if (cached) insertCachedItem(queryClient, cached);
        if (pendingEntry) outbox.restore(pendingEntry);
        throw error;
      })
    : Promise.resolve();

  toast.undo("Idea deleted", {
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
      void queryClient.invalidateQueries({ queryKey: itemKeys.list("idea") });
    },
  });
}

/** Removes one photo at once, with Undo. */
export function removePhoto(queryClient: QueryClient, photo: PhotoView) {
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

/** Adds photos to an existing item: they show at once and upload in the background. */
export function addPhotosToItem(itemId: string, files: File[]) {
  if (!files.length) return;
  void outbox.add({
    itemId,
    photos: files.map((file) => ({ id: crypto.randomUUID(), file })),
    queuedAt: Date.now(),
  });
}
