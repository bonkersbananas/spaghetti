import type {
  Attempt,
  AttemptResponse,
  FinishAttemptResponse,
  Item,
  ItemResponse,
  ItemStage,
  Photo,
  PhotoResponse,
} from "@shared/api";
import type { AttemptSettings, Outcome } from "@shared/attempts";
import type { AttemptPart } from "@shared/parts";
import type { FileKind } from "@shared/slicing/types.ts";
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
  /** What it printed of the build's parts. */
  parts?: AttemptPart[];
  createdBy: string;
  createdAt: number;
}

/**
 * A slicer file waiting to reach the server, behind its attempt: what the
 * browser read from it, its plate's picture, and its bytes (left out when
 * over MAX_SLICER_FILE_BYTES).
 */
export interface PendingFile {
  id: string;
  attemptId: string;
  name: string;
  size: number;
  file?: Blob;
  thumb?: Blob;
  plate: number;
  plateCount: number;
  slicer?: string;
  prefill: AttemptSettings;
  /** The object names on the plate (for parts). */
  objects?: string[];
  /** "model": an .stl or plain .3mf, sliced by lib/slicing/jobs.ts, which sends its slice once this is saved. */
  kind?: FileKind;
  queuedAt: number;
}

export type PendingAttemptChanges = Partial<
  Pick<PendingAttempt, "outcome" | "printedAt" | "note" | "failureTags" | "successNotes" | "settings" | "parts">
>;

/**
 * A print finished on this device while the server was out of reach: the
 * outcome, when it came off the bed, and the note and tags that go with it.
 * The server fills what is still empty and keeps someone else's outcome.
 */
export interface PendingFinish {
  attemptId: string;
  outcome: Outcome;
  finishedAt: number;
  note: string;
  failureTags: string[];
  successNotes: string[];
}

/** Everything still to send for one item. Kept in IndexedDB until the server has it. */
export interface OutboxEntry {
  itemId: string;
  /** Present until the item exists on the server. */
  create?: {
    title: string | null;
    note: string;
    createdAt: number;
    createdBy: string;
    stage?: ItemStage;
    /** The twist a build prints (a build made from a twist). */
    twistId?: string;
    /** The title came with a share (the page's own), not from the person: a draft may replace it. Typing one clears this. */
    titleShared?: boolean;
  };
  /** Attempts to log, sent after the item and before the photos. */
  attempts?: PendingAttempt[];
  /** Slicer files for attempts, sent after the attempts. */
  files?: PendingFile[];
  /** Prints to finish, sent after the attempts and before the photos. */
  finishes?: PendingFinish[];
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
  /** `sharedTitle`: the title the idea still has from a share, which a draft may replace. */
  itemSaved: (item: Item, info: { sharedTitle: string | null }) => void;
  attemptSaved: (attempt: Attempt) => void;
  /** A queued finish landed. `finished` is false when someone else had finished that print first. */
  attemptFinished: (attempt: Attempt, result: { finished: boolean; pending: PendingFinish; photos: number }) => void;
  photoSaved: (photo: Photo) => void;
  /** A slicer file is on the server: the attempt as it now is. */
  fileSaved: (attempt: Attempt) => void;
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
  private cancelledFiles = new Set<string>();
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
    await this.pickUp();
  }

  /**
   * Loads entries the store has that this page doesn't know of and sends them: what an earlier visit left
   * behind, or what the service worker queued (a notification's answer given with no signal).
   */
  async pickUp() {
    const stored = await this.store.all().catch(() => [] as OutboxEntry[]);
    const known = new Set(this.state.entries.map((entry) => entry.itemId));
    // An entry this page already holds may have gained a finish from the service worker.
    for (const entry of stored) {
      const current = this.entry(entry.itemId);
      const missing = (entry.finishes ?? []).filter(
        (f) => !current?.finishes?.some((g) => g.attemptId === f.attemptId),
      );
      if (current && missing.length)
        await this.save({ ...current, finishes: [...(current.finishes ?? []), ...missing] });
    }
    const fresh = stored.filter((entry) => !known.has(entry.itemId));
    for (const entry of fresh) for (const photo of entry.photos) registerPreview(photo);
    for (const entry of fresh) for (const file of entry.files ?? []) registerFilePreview(file);
    if (fresh.length) {
      this.setEntries([...fresh, ...this.state.entries].sort((a, b) => a.queuedAt - b.queuedAt));
    }
    void this.run();
  }

  /** Queues a new item or more photos for one; resolves once it is on the device. */
  async add(entry: OutboxEntry) {
    for (const photo of entry.photos) registerPreview(photo);
    for (const file of entry.files ?? []) registerFilePreview(file);
    const existing = this.entry(entry.itemId);
    const attempts = [...(existing?.attempts ?? []), ...(entry.attempts ?? [])];
    // A newer file for the same attempt replaces one still waiting.
    const incoming = new Set((entry.files ?? []).map((file) => file.attemptId));
    const files = [...(existing?.files ?? []).filter((file) => !incoming.has(file.attemptId)), ...(entry.files ?? [])];
    // A print finished twice before it was sent keeps the later answer.
    const finishes = [
      ...(existing?.finishes ?? []).filter((f) => !entry.finishes?.some((g) => g.attemptId === f.attemptId)),
      ...(entry.finishes ?? []),
    ];
    const merged: OutboxEntry = existing
      ? {
          ...existing,
          create: existing.create ?? entry.create,
          ...(attempts.length ? { attempts } : {}),
          ...(files.length ? { files } : {}),
          ...(finishes.length ? { finishes } : {}),
          photos: [...existing.photos, ...entry.photos],
        }
      : entry;
    if (existing) this.setEntries(this.state.entries.map((e) => (e.itemId === entry.itemId ? merged : e)));
    else this.setEntries([...this.state.entries, merged]);
    await this.store.put(merged).catch(() => undefined);
    void this.run();
  }

  /** Queues finishing a print that is saved on the server; sent when it can be. */
  async addFinish(itemId: string, finish: PendingFinish) {
    await this.add({ itemId, finishes: [finish], photos: [], queuedAt: Date.now() });
  }

  /** The finish still waiting for one attempt, if any. */
  pendingFinish(attemptId: string): PendingFinish | undefined {
    for (const entry of this.state.entries) {
      const found = entry.finishes?.find((finish) => finish.attemptId === attemptId);
      if (found) return found;
    }
    return undefined;
  }

  /** Takes an item out of the queue (it was deleted). Returns it, for undo. */
  remove(itemId: string): OutboxEntry | undefined {
    const entry = this.entry(itemId);
    if (!entry) return undefined;
    this.cancelledItems.add(itemId);
    for (const photo of entry.photos) this.cancelledPhotos.add(photo.id);
    for (const attempt of entry.attempts ?? []) this.cancelledAttempts.add(attempt.id);
    for (const file of entry.files ?? []) this.cancelledFiles.add(file.id);
    this.setEntries(this.state.entries.filter((e) => e.itemId !== itemId));
    void this.store.delete(itemId).catch(() => undefined);
    return entry;
  }

  /** Undo for remove(). */
  restore(entry: OutboxEntry) {
    this.cancelledItems.delete(entry.itemId);
    for (const photo of entry.photos) this.cancelledPhotos.delete(photo.id);
    for (const attempt of entry.attempts ?? []) this.cancelledAttempts.delete(attempt.id);
    for (const file of entry.files ?? []) this.cancelledFiles.delete(file.id);
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
    const typedTitle = changes.title !== undefined;
    void this.save({
      ...entry,
      create: { ...entry.create, ...changes, ...(typedTitle ? { titleShared: false } : {}) },
    });
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

  /** Takes a pending attempt, its file and its photos out (deleted). Returns them, for undo. */
  removeAttempt(
    attemptId: string,
  ): { itemId: string; attempt: PendingAttempt; photos: PendingPhoto[]; files: PendingFile[] } | undefined {
    const entry = this.entryWithAttempt(attemptId);
    const attempt = entry?.attempts?.find((a) => a.id === attemptId);
    if (!entry || !attempt) return undefined;
    this.cancelledAttempts.add(attemptId);
    const photos = entry.photos.filter((photo) => photo.attemptId === attemptId);
    for (const photo of photos) this.cancelledPhotos.add(photo.id);
    const files = (entry.files ?? []).filter((file) => file.attemptId === attemptId);
    for (const file of files) this.cancelledFiles.add(file.id);
    void this.save({
      ...entry,
      attempts: entry.attempts?.filter((a) => a.id !== attemptId),
      files: entry.files?.filter((file) => file.attemptId !== attemptId),
      photos: entry.photos.filter((photo) => photo.attemptId !== attemptId),
    });
    return { itemId: entry.itemId, attempt, photos, files };
  }

  restoreAttempt(removed: { itemId: string; attempt: PendingAttempt; photos: PendingPhoto[]; files: PendingFile[] }) {
    this.cancelledAttempts.delete(removed.attempt.id);
    for (const photo of removed.photos) this.cancelledPhotos.delete(photo.id);
    for (const file of removed.files) this.cancelledFiles.delete(file.id);
    void this.add({
      itemId: removed.itemId,
      attempts: [removed.attempt],
      files: removed.files,
      photos: removed.photos,
      queuedAt: Date.now(),
    });
  }

  /** A slicer file still on this device, for an attempt (shown until the server has it). */
  pendingFile(attemptId: string): PendingFile | undefined {
    for (const entry of this.state.entries) {
      const file = entry.files?.find((f) => f.attemptId === attemptId);
      if (file) return file;
    }
    return undefined;
  }

  /** Takes a waiting slicer file out (removed before it was sent). Returns it, for undo. */
  removeFile(attemptId: string): { itemId: string; file: PendingFile } | undefined {
    for (const entry of this.state.entries) {
      const file = entry.files?.find((f) => f.attemptId === attemptId);
      if (!file) continue;
      this.cancelledFiles.add(file.id);
      void this.save({ ...entry, files: entry.files?.filter((f) => f.id !== file.id) });
      return { itemId: entry.itemId, file };
    }
    return undefined;
  }

  restoreFile(itemId: string, file: PendingFile) {
    this.cancelledFiles.delete(file.id);
    void this.add({ itemId, files: [file], photos: [], queuedAt: Date.now() });
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
        else if (entry.finishes?.[0]) await this.sendFinish(entry, entry.finishes[0]);
        else if (entry.files?.[0]) await this.uploadFile(entry, entry.files[0]);
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
          ...(create.twistId ? { twistId: create.twistId } : {}),
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
    const sharedTitle = this.entry(entry.itemId)?.create?.titleShared ? item.title : null;
    this.handlers.itemSaved?.(item, { sharedTitle });
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
          ...(pending.parts?.length ? { parts: pending.parts } : {}),
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
          ...(current.parts ? { parts: current.parts } : {}),
        },
      }).catch(() => ({ attempt })));
    }
    this.handlers.attemptSaved?.(attempt);
    const latest = this.entry(entry.itemId);
    if (latest) await this.save({ ...latest, attempts: latest.attempts?.filter((a) => a.id !== pending.id) });
  }

  private async sendFinish(entry: OutboxEntry, pending: PendingFinish) {
    let result: FinishAttemptResponse;
    try {
      result = await api<FinishAttemptResponse>(`/attempts/${pending.attemptId}/finish`, {
        method: "POST",
        json: {
          outcome: pending.outcome,
          finishedAt: pending.finishedAt,
          note: pending.note,
          failureTags: pending.failureTags,
          successNotes: pending.successNotes,
        },
      });
    } catch (error) {
      if (error instanceof ApiError && [400, 404].includes(error.status)) {
        // Deleted meanwhile (its photos will find that out too), or unreadable: nothing to send.
        this.dropFinish(entry.itemId, pending.attemptId);
        return;
      }
      throw new RetryLater();
    }
    const photos =
      this.entry(entry.itemId)?.photos.filter((photo) => photo.attemptId === pending.attemptId).length ?? 0;
    this.handlers.attemptFinished?.(result.attempt, { finished: result.finished, pending, photos });
    this.dropFinish(entry.itemId, pending.attemptId);
  }

  private dropFinish(itemId: string, attemptId: string) {
    const latest = this.entry(itemId);
    if (latest) void this.save({ ...latest, finishes: latest.finishes?.filter((f) => f.attemptId !== attemptId) });
  }

  /** Forgets an attempt and the photos queued behind it. */
  private dropAttempt(itemId: string, attemptId: string) {
    const latest = this.entry(itemId);
    if (!latest) return;
    for (const photo of latest.photos) if (photo.attemptId === attemptId) this.setProgress(photo.id, null);
    void this.save({
      ...latest,
      attempts: latest.attempts?.filter((a) => a.id !== attemptId),
      files: latest.files?.filter((file) => file.attemptId !== attemptId),
      photos: latest.photos.filter((photo) => photo.attemptId !== attemptId),
    });
  }

  private async uploadFile(entry: OutboxEntry, pending: PendingFile) {
    const form = new FormData();
    form.set("id", pending.id);
    form.set("name", pending.name);
    form.set("size", String(pending.size));
    form.set("plate", String(pending.plate));
    form.set("plateCount", String(pending.plateCount));
    if (pending.slicer) form.set("slicer", pending.slicer);
    form.set("prefill", JSON.stringify(pending.prefill));
    if (pending.objects?.length) form.set("objects", JSON.stringify(pending.objects));
    if (pending.kind) form.set("kind", pending.kind);
    if (pending.thumb) form.set("thumb", pending.thumb, "thumb.png");
    if (pending.file) form.set("file", pending.file, pending.name);
    const response = await send(`/api/attempts/${pending.attemptId}/file`, form, () => undefined);
    const dropFile = () => {
      const latest = this.entry(entry.itemId);
      if (latest) void this.save({ ...latest, files: latest.files?.filter((file) => file.id !== pending.id) });
    };
    if (response.status === 404 || response.status === 409) return dropFile();
    if ([400, 413, 415].includes(response.status)) {
      dropFile();
      this.handlers.photoDropped?.("The slicer file was refused by the server and couldn't be kept.");
      return;
    }
    if (response.status < 200 || response.status >= 300) throw new RetryLater();
    const { attempt } = JSON.parse(response.body) as AttemptResponse;
    if (this.cancelledFiles.has(pending.id)) {
      await api(`/attempts/${pending.attemptId}/file`, { method: "DELETE" }).catch(() => undefined);
    } else {
      this.handlers.fileSaved?.(attempt);
    }
    dropFile();
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

/** Shows a waiting slicer file's plate picture from the device. */
function registerFilePreview(file: PendingFile) {
  if (file.thumb) setPreview(file.id, file.thumb, file.thumb);
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
