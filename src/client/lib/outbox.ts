import type { Attempt, AttemptResponse, Item, ItemResponse, ItemStage, Photo, PhotoResponse } from "@shared/api";
import type { AttemptSettings, Outcome } from "@shared/attempts";
import { useSyncExternalStore } from "react";
import { ApiError, api } from "./api";
import { isOnline, reportReachable, reportUnreachable, subscribeConnection } from "./connection";
import { openStore } from "./idb";
import { type ProcessedPhoto, processPhoto, UnreadablePhotoError } from "./images";
import { setPreview } from "./previews";

/** A photo waiting to reach the server: the original until it is resized, then its variants. */
export interface PendingPhoto {
  id: string;
  /** Its place in the item; left out, it goes after the photos already there. */
  position?: number;
  file?: Blob;
  processed?: ProcessedPhoto;
  /** The print attempt it belongs to, if any. */
  attemptId?: string;
}

/** A print attempt waiting to reach the server. Its photos wait behind it. */
export interface PendingAttempt {
  id: string;
  outcome: Outcome | null;
  printedAt: number;
  note: string;
  failureTags: string[];
  successNotes: string[];
  settings: AttemptSettings;
  createdBy: string;
  createdAt: number;
}

export type PendingAttemptChanges = Partial<
  Pick<PendingAttempt, "outcome" | "printedAt" | "note" | "failureTags" | "successNotes" | "settings">
>;

/** Everything still to send for one item. Kept in IndexedDB until the server has it. */
export interface OutboxEntry {
  itemId: string;
  /** Present until the item exists on the server. */
  create?: { title: string | null; note: string; createdAt: number; createdBy: string; stage?: ItemStage };
  /** Attempts to log, sent after the item and before the photos. */
  attempts?: PendingAttempt[];
  photos: PendingPhoto[];
  queuedAt: number;
}

export type UploadStatus = "processing" | "uploading" | "waiting";
export interface UploadProgress {
  status: UploadStatus;
  /** 0 to 1 while uploading. */
  progress: number;
}

export interface OutboxState {
  entries: OutboxEntry[];
  /** By photo id; photos not in here are queued behind others. */
  progress: Record<string, UploadProgress>;
  /** The last attempt failed and a retry is scheduled. */
  retrying: boolean;
}

export interface OutboxHandlers {
  itemSaved: (item: Item) => void;
  attemptSaved: (attempt: Attempt) => void;
  photoSaved: (photo: Photo) => void;
  /** A photo that can never be uploaded (unreadable, refused). */
  photoDropped: (message: string) => void;
}

const RETRY_SECONDS = [2, 4, 8, 15, 30, 60];

class RetryLater extends Error {}

/**
 * The capture outbox. Saving an idea puts it here (and in IndexedDB) at
 * once; this sends it in the background, one request at a time, retrying
 * with backoff until the server has it, and resumes on the next visit if the
 * tab closes. Every request is idempotent, so a repeat is harmless.
 */
class Outbox {
  private state: OutboxState = { entries: [], progress: {}, retrying: false };
  private listeners = new Set<() => void>();
  private store = openStore<OutboxEntry>("spaghetti", "outbox", "itemId");
  private running = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private resumed = false;
  /** Removed while their request was in flight: undone on the server when it lands. */
  private cancelledItems = new Set<string>();
  private cancelledPhotos = new Set<string>();
  private cancelledAttempts = new Set<string>();
  handlers: Partial<OutboxHandlers> = {};

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private set(next: Partial<OutboxState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  private setEntries(entries: OutboxEntry[]) {
    this.set({ entries });
  }

  private setProgress(photoId: string, progress: UploadProgress | null) {
    const next = { ...this.state.progress };
    if (progress) next[photoId] = progress;
    else delete next[photoId];
    this.set({ progress: next });
  }

  private entry(itemId: string) {
    return this.state.entries.find((entry) => entry.itemId === itemId);
  }

  private async save(entry: OutboxEntry) {
    this.setEntries(this.state.entries.map((e) => (e.itemId === entry.itemId ? entry : e)));
    await this.store.put(entry).catch(() => undefined);
  }

  /** Loads what an earlier visit left behind and sends it. */
  async resume() {
    if (this.resumed) return;
    this.resumed = true;
    subscribeConnection(() => {
      if (isOnline()) this.retryNow();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.retryNow();
    });
    const stored = await this.store.all().catch(() => [] as OutboxEntry[]);
    const known = new Set(this.state.entries.map((entry) => entry.itemId));
    const fresh = stored.filter((entry) => !known.has(entry.itemId));
    for (const entry of fresh) for (const photo of entry.photos) registerPreview(photo);
    if (fresh.length) {
      this.setEntries([...fresh, ...this.state.entries].sort((a, b) => a.queuedAt - b.queuedAt));
    }
    void this.run();
  }

  /** Queues a new item or more photos for one; resolves once it is on the device. */
  async add(entry: OutboxEntry) {
    for (const photo of entry.photos) registerPreview(photo);
    const existing = this.entry(entry.itemId);
    const attempts = [...(existing?.attempts ?? []), ...(entry.attempts ?? [])];
    const merged: OutboxEntry = existing
      ? {
          ...existing,
          create: existing.create ?? entry.create,
          ...(attempts.length ? { attempts } : {}),
          photos: [...existing.photos, ...entry.photos],
        }
      : entry;
    if (existing) this.setEntries(this.state.entries.map((e) => (e.itemId === entry.itemId ? merged : e)));
    else this.setEntries([...this.state.entries, merged]);
    await this.store.put(merged).catch(() => undefined);
    void this.run();
  }

  /** Takes an item out of the queue (it was deleted). Returns it, for undo. */
  remove(itemId: string): OutboxEntry | undefined {
    const entry = this.entry(itemId);
    if (!entry) return undefined;
    this.cancelledItems.add(itemId);
    for (const photo of entry.photos) this.cancelledPhotos.add(photo.id);
    for (const attempt of entry.attempts ?? []) this.cancelledAttempts.add(attempt.id);
    this.setEntries(this.state.entries.filter((e) => e.itemId !== itemId));
    void this.store.delete(itemId).catch(() => undefined);
    return entry;
  }

  /** Undo for remove(). */
  restore(entry: OutboxEntry) {
    this.cancelledItems.delete(entry.itemId);
    for (const photo of entry.photos) this.cancelledPhotos.delete(photo.id);
    for (const attempt of entry.attempts ?? []) this.cancelledAttempts.delete(attempt.id);
    void this.add(entry);
  }

  /** Takes one pending photo out. Returns what undo needs to put it back. */
  removePhoto(photoId: string): { itemId: string; photo: PendingPhoto } | undefined {
    for (const entry of this.state.entries) {
      const photo = entry.photos.find((p) => p.id === photoId);
      if (!photo) continue;
      this.cancelledPhotos.add(photoId);
      void this.save({ ...entry, photos: entry.photos.filter((p) => p.id !== photoId) });
      return { itemId: entry.itemId, photo };
    }
    return undefined;
  }

  restorePhoto(itemId: string, photo: PendingPhoto) {
    this.cancelledPhotos.delete(photo.id);
    void this.add({ itemId, photos: [photo], queuedAt: Date.now() });
  }

  /**
   * Edits an item the server doesn't have yet. Returns false once it does,
   * and the caller saves the change through the API instead.
   */
  updatePending(itemId: string, changes: { title?: string | null; note?: string; stage?: ItemStage }): boolean {
    const entry = this.entry(itemId);
    if (!entry?.create) return false;
    void this.save({ ...entry, create: { ...entry.create, ...changes } });
    return true;
  }

  private entryWithAttempt(attemptId: string) {
    return this.state.entries.find((entry) => entry.attempts?.some((attempt) => attempt.id === attemptId));
  }

  /** Edits an attempt the server doesn't have yet; false once it does. */
  updatePendingAttempt(attemptId: string, changes: PendingAttemptChanges): boolean {
    const entry = this.entryWithAttempt(attemptId);
    if (!entry) return false;
    void this.save({
      ...entry,
      attempts: entry.attempts?.map((attempt) => (attempt.id === attemptId ? { ...attempt, ...changes } : attempt)),
    });
    return true;
  }

  /** Takes a pending attempt and its photos out (deleted). Returns them, for undo. */
  removeAttempt(attemptId: string): { itemId: string; attempt: PendingAttempt; photos: PendingPhoto[] } | undefined {
    const entry = this.entryWithAttempt(attemptId);
    const attempt = entry?.attempts?.find((a) => a.id === attemptId);
    if (!entry || !attempt) return undefined;
    this.cancelledAttempts.add(attemptId);
    const photos = entry.photos.filter((photo) => photo.attemptId === attemptId);
    for (const photo of photos) this.cancelledPhotos.add(photo.id);
    void this.save({
      ...entry,
      attempts: entry.attempts?.filter((a) => a.id !== attemptId),
      photos: entry.photos.filter((photo) => photo.attemptId !== attemptId),
    });
    return { itemId: entry.itemId, attempt, photos };
  }

  restoreAttempt(removed: { itemId: string; attempt: PendingAttempt; photos: PendingPhoto[] }) {
    this.cancelledAttempts.delete(removed.attempt.id);
    for (const photo of removed.photos) this.cancelledPhotos.delete(photo.id);
    void this.add({
      itemId: removed.itemId,
      attempts: [removed.attempt],
      photos: removed.photos,
      queuedAt: Date.now(),
    });
  }

  /** Photos of an attempt still on this device, which a delete on the server can't reach. */
  dropAttemptPhotos(attemptId: string): PendingPhoto[] {
    const dropped: PendingPhoto[] = [];
    for (const entry of this.state.entries) {
      const photos = entry.photos.filter((photo) => photo.attemptId === attemptId);
      if (!photos.length) continue;
      dropped.push(...photos);
      for (const photo of photos) this.cancelledPhotos.add(photo.id);
      void this.save({ ...entry, photos: entry.photos.filter((photo) => photo.attemptId !== attemptId) });
    }
    return dropped;
  }

  restorePhotos(itemId: string, photos: PendingPhoto[]) {
    if (!photos.length) return;
    for (const photo of photos) this.cancelledPhotos.delete(photo.id);
    void this.add({ itemId, photos, queuedAt: Date.now() });
  }

  isPending(itemId: string) {
    return !!this.entry(itemId)?.create;
  }

  retryNow() {
    if (!this.state.retrying) return;
    this.attempt = 0;
    clearTimeout(this.retryTimer);
    void this.run();
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    clearTimeout(this.retryTimer);
    try {
      for (;;) {
        const entry = this.state.entries[0];
        if (!entry) break;
        if (entry.create) await this.createItem(entry);
        else if (entry.attempts?.[0]) await this.createAttempt(entry, entry.attempts[0]);
        else if (entry.photos[0]) await this.uploadPhoto(entry, entry.photos[0]);
        else this.finish(entry.itemId);
        this.attempt = 0;
        if (this.state.retrying) this.set({ retrying: false });
      }
    } catch (error) {
      if (!(error instanceof RetryLater)) console.error(error);
      for (const entry of this.state.entries) {
        for (const photo of entry.photos) this.setProgress(photo.id, { status: "waiting", progress: 0 });
      }
      const seconds = RETRY_SECONDS[Math.min(this.attempt, RETRY_SECONDS.length - 1)] ?? 60;
      this.attempt += 1;
      this.set({ retrying: true });
      this.retryTimer = setTimeout(() => void this.run(), seconds * 1000);
    } finally {
      this.running = false;
    }
  }

  private finish(itemId: string) {
    this.setEntries(this.state.entries.filter((e) => e.itemId !== itemId));
    void this.store.delete(itemId).catch(() => undefined);
  }

  private async createItem(entry: OutboxEntry) {
    const create = entry.create;
    if (!create) return;
    let item: Item;
    try {
      ({ item } = await api<ItemResponse>("/items", {
        method: "POST",
        json: {
          id: entry.itemId,
          title: create.title,
          note: create.note,
          createdAt: create.createdAt,
          // A capture is an idea unless it says otherwise; a build finished offline is created as a build.
          stage: (create.stage ?? "idea") === "idea" ? "idea" : "building",
        },
      }));
    } catch (error) {
      // Deleted elsewhere before it got here: nothing left to send.
      if (error instanceof ApiError && [400, 404, 409].includes(error.status)) return this.finish(entry.itemId);
      throw new RetryLater();
    }
    if (this.cancelledItems.has(entry.itemId)) {
      // Deleted while its request was in flight: delete it on the server too.
      await api(`/items/${entry.itemId}`, { method: "DELETE" }).catch(() => undefined);
      return;
    }
    // Edits made meanwhile went into the entry; send them now.
    const current = this.entry(entry.itemId);
    const stage = current?.create?.stage ?? "idea";
    if (
      current?.create &&
      (current.create.note !== item.note || current.create.title !== item.title || stage !== item.stage)
    ) {
      ({ item } = await api<ItemResponse>(`/items/${entry.itemId}`, {
        method: "PATCH",
        json: { title: current.create.title, note: current.create.note, stage },
      }).catch(() => ({ item })));
    }
    this.handlers.itemSaved?.(item);
    const latest = this.entry(entry.itemId);
    if (latest) await this.save({ ...latest, create: undefined });
  }

  private async createAttempt(entry: OutboxEntry, pending: PendingAttempt) {
    let attempt: Attempt;
    try {
      ({ attempt } = await api<AttemptResponse>(`/items/${entry.itemId}/attempts`, {
        method: "POST",
        json: {
          id: pending.id,
          outcome: pending.outcome,
          printedAt: pending.printedAt,
          note: pending.note,
          failureTags: pending.failureTags,
          successNotes: pending.successNotes,
          settings: pending.settings,
        },
      }));
    } catch (error) {
      if (error instanceof ApiError && [400, 404, 409].includes(error.status)) {
        // Its build was deleted meanwhile, or the attempt can't be read: its photos can't go anywhere.
        this.dropAttempt(entry.itemId, pending.id);
        if (error.status === 400) this.handlers.photoDropped?.("An attempt couldn't be saved.");
        return;
      }
      throw new RetryLater();
    }
    if (this.cancelledAttempts.has(pending.id)) {
      await api(`/attempts/${pending.id}`, { method: "DELETE" }).catch(() => undefined);
      this.dropAttempt(entry.itemId, pending.id);
      return;
    }
    // Edits made while it was on its way.
    const current = this.entry(entry.itemId)?.attempts?.find((a) => a.id === pending.id);
    if (current && current !== pending) {
      ({ attempt } = await api<AttemptResponse>(`/attempts/${pending.id}`, {
        method: "PATCH",
        json: {
          outcome: current.outcome,
          printedAt: current.printedAt,
          note: current.note,
          failureTags: current.failureTags,
          successNotes: current.successNotes,
          settings: current.settings,
        },
      }).catch(() => ({ attempt })));
    }
    this.handlers.attemptSaved?.(attempt);
    const latest = this.entry(entry.itemId);
    if (latest) await this.save({ ...latest, attempts: latest.attempts?.filter((a) => a.id !== pending.id) });
  }

  /** Forgets an attempt and the photos queued behind it. */
  private dropAttempt(itemId: string, attemptId: string) {
    const latest = this.entry(itemId);
    if (!latest) return;
    for (const photo of latest.photos) if (photo.attemptId === attemptId) this.setProgress(photo.id, null);
    void this.save({
      ...latest,
      attempts: latest.attempts?.filter((a) => a.id !== attemptId),
      photos: latest.photos.filter((photo) => photo.attemptId !== attemptId),
    });
  }

  private async uploadPhoto(entry: OutboxEntry, pending: PendingPhoto) {
    let processed = pending.processed;
    if (!processed) {
      this.setProgress(pending.id, { status: "processing", progress: 0 });
      try {
        processed = await processPhoto(pending.file ?? new Blob());
      } catch (error) {
        this.dropPhoto(entry.itemId, pending.id);
        this.handlers.photoDropped?.(
          error instanceof UnreadablePhotoError ? error.message : "A photo couldn't be prepared for upload.",
        );
        return;
      }
      registerPreview({ ...pending, processed });
      const latest = this.entry(entry.itemId);
      if (latest) {
        await this.save({
          ...latest,
          photos: latest.photos.map((p) =>
            p.id === pending.id ? { id: p.id, position: p.position, attemptId: p.attemptId, processed } : p,
          ),
        });
      }
    }

    const form = new FormData();
    form.set("width", String(processed.width));
    form.set("height", String(processed.height));
    form.set("color", processed.color);
    if (processed.takenAt) form.set("takenAt", String(processed.takenAt));
    if (pending.position !== undefined) form.set("position", String(pending.position));
    if (pending.attemptId) form.set("attemptId", pending.attemptId);
    form.set("large", processed.large, "large");
    form.set("thumb", processed.thumb, "thumb");

    this.setProgress(pending.id, { status: "uploading", progress: 0 });
    const response = await send(`/api/items/${entry.itemId}/photos/${pending.id}`, form, (progress) =>
      this.setProgress(pending.id, { status: "uploading", progress }),
    );
    if (response.status === 404 || response.status === 409) {
      // Its item or attempt was deleted meanwhile.
      this.dropPhoto(entry.itemId, pending.id);
      return;
    }
    if ([400, 413, 415].includes(response.status)) {
      this.dropPhoto(entry.itemId, pending.id);
      this.handlers.photoDropped?.("A photo was refused by the server and couldn't be saved.");
      return;
    }
    if (response.status < 200 || response.status >= 300) throw new RetryLater();

    const { photo } = JSON.parse(response.body) as PhotoResponse;
    if (this.cancelledPhotos.has(photo.id)) {
      await api(`/photos/${photo.id}`, { method: "DELETE" }).catch(() => undefined);
    } else {
      this.handlers.photoSaved?.(photo);
    }
    this.dropPhoto(entry.itemId, pending.id);
  }

  private dropPhoto(itemId: string, photoId: string) {
    this.setProgress(photoId, null);
    const latest = this.entry(itemId);
    if (latest) void this.save({ ...latest, photos: latest.photos.filter((p) => p.id !== photoId) });
  }
}

/** Shows a pending photo from the device until (and after) the server has it. */
function registerPreview(photo: PendingPhoto) {
  if (photo.processed) setPreview(photo.id, photo.processed.thumb, photo.processed.large);
  else if (photo.file) setPreview(photo.id, photo.file, photo.file);
}

/** fetch() can't report upload progress; XMLHttpRequest can. */
function send(url: string, body: FormData, onProgress: (fraction: number) => void) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      reportReachable();
      resolve({ status: xhr.status, body: xhr.responseText });
    };
    xhr.onerror = () => {
      reportUnreachable();
      reject(new RetryLater());
    };
    xhr.ontimeout = () => reject(new RetryLater());
    xhr.timeout = 120_000;
    xhr.send(body);
  });
}

export const outbox = new Outbox();

export function useOutbox(): OutboxState {
  return useSyncExternalStore(outbox.subscribe, outbox.getSnapshot);
}
