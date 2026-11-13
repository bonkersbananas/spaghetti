import { type AttemptFile, fileUrl, type ItemFileResponse } from "@shared/api";
import type { AttemptSettings } from "@shared/attempts";
import { slicedName } from "@shared/slicing/files.ts";
import { slicingOfSlice } from "@shared/slicing/model.ts";
import { workshopDefaults } from "@shared/slicing/pantry.ts";
import type { SlicingSettings } from "@shared/slicing/settings.ts";
import type { SliceOptions } from "@shared/slicing/types.ts";
import { DEFAULT_PRINTER } from "@shared/spools";
import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { toast } from "@/components/ui/Toast";
import { ApiError, api } from "../api";
import { patchCachedItem } from "../items";
import { printerQuery, spoolsQuery } from "../pantry-queries";
import { dropPreview, setPreview } from "../previews";
import type { SliceOutcome } from "./slice-model";

/**
 * Slicing as background jobs on this device: one model at a time (a phone has the memory for one), on through page
 * changes, gone with the tab. A job slices (slice-model.ts, loaded on first use), shows its plate picture as soon as
 * it is drawn, and sends what it made to the model's row (PUT /api/files/:id/sliced) once the model is on the server
 * and its place is known: at once for an idea's file, when the sheet saves for an attempt's. The card reads its
 * progress with `useSliceJob`; when the server has the slice, the job is done and the card reads the file.
 *
 * Slicing again with other settings (decision 0047) keeps the slice there, picture and all, until the new one is
 * ready; the server keeps the one it replaced for one undo, and the card says what changed ("1 h 12 min → 48 min").
 */

/** Where a model is kept: an idea's or build's files, or an attempt's file. */
export interface SliceTarget {
  itemId: string;
  attemptId: string | null;
}

export interface SliceJob {
  fileId: string;
  status: "waiting" | "slicing" | "sliced" | "failed";
  /** 0-1 while slicing. */
  fraction: number;
  /** Its plate picture is drawn: `fileThumbSrc(fileId)` shows it. */
  picture: boolean;
  /** The settings chosen for it. */
  chosen: SliceOptions;
  /** Slicing again over a slice that stays shown until this one is saved. */
  again: boolean;
  /** What it made, until the server has it. */
  outcome?: SliceOutcome;
}

/** The time and filament of a slice, to say what a change did. */
export interface SliceFigures {
  minutes?: number;
  grams?: number;
}

/**
 * A re-slice that was saved: what it was and is now, for "1 h 12 min → 48 min · 14 g → 11 g" and its undo, or that
 * it couldn't be sliced that way (the card says why, and offers the slice before).
 */
export interface SliceChange {
  before: SliceFigures;
  after: SliceFigures;
  failed?: boolean;
}

interface Entry extends SliceJob {
  name: string;
  target: SliceTarget | null;
  /** Given, or the workshop's when its turn comes. */
  defaults?: SlicingSettings;
  before?: SliceFigures;
  queryClient: QueryClient;
  controller: AbortController;
  png?: Blob;
  done: Promise<SliceOutcome | null>;
}

const entries = new Map<string, Entry>();
const changes = new Map<string, SliceChange>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, SliceJob> = new Map();
let changeSnapshot: ReadonlyMap<string, SliceChange> = new Map();
let queue: Promise<unknown> = Promise.resolve();

function emit() {
  snapshot = new Map(
    [...entries].map(([id, entry]) => [
      id,
      {
        fileId: entry.fileId,
        status: entry.status,
        fraction: entry.fraction,
        picture: entry.picture,
        chosen: entry.chosen,
        again: entry.again,
        ...(entry.outcome ? { outcome: entry.outcome } : {}),
      },
    ]),
  );
  changeSnapshot = new Map(changes);
  for (const listener of listeners) listener();
}

function update(entry: Entry, change: Partial<Pick<Entry, "status" | "fraction" | "picture">>) {
  if (entries.get(entry.fileId) !== entry) return;
  // Progress moves the ring by whole percents only: no renders for nothing.
  if (change.fraction !== undefined && Math.floor(change.fraction * 100) === Math.floor(entry.fraction * 100)) {
    if (Object.keys(change).length === 1) return;
  }
  Object.assign(entry, change);
  emit();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A phone: less memory, and the device that a laptop finishes for (decision 0046). */
export const onPhone = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/**
 * What a model nobody set up is sliced with on this device: Spaghetti's defaults with a spool from the Pantry, a
 * plate the Printer page owns and its main nozzle (shared/slicing/pantry.ts), from what the app already has.
 */
export async function slicingDefaults(queryClient: QueryClient): Promise<SlicingSettings> {
  // Offline or failing, what was seen last (or nothing: the stand-in, the stock plate).
  const [spools, printer] = await Promise.all([
    queryClient.ensureQueryData(spoolsQuery).catch(() => queryClient.getQueryData(spoolsQuery.queryKey) ?? []),
    queryClient.ensureQueryData(printerQuery).catch(() => queryClient.getQueryData(printerQuery.queryKey)),
  ]);
  return workshopDefaults({ spools, setup: printer?.setup ?? DEFAULT_PRINTER });
}

/** A saved model's original, for slicing it again. */
export async function fetchOriginal(fileId: string): Promise<Blob> {
  const response = await fetch(fileUrl(fileId), { credentials: "same-origin" });
  if (!response.ok) throw new Error(String(response.status));
  return response.blob();
}

/** "About 36 min · 10.6 g" as figures, from what a slice's file said. */
export const figuresOf = (prefill: Pick<AttemptSettings, "estimatedMinutes" | "weightGrams"> | undefined) => ({
  ...(prefill?.estimatedMinutes !== undefined ? { minutes: prefill.estimatedMinutes } : {}),
  ...(prefill?.weightGrams !== undefined ? { grams: prefill.weightGrams } : {}),
});

/**
 * Slices a model in the background. `source` is the original, or how to get it (a saved model's bytes, fetched
 * when its turn comes). A null `target` keeps the result until `attachSlice` says where the model went. `again`
 * slices over a slice that stays shown until this one is saved, kept by the server for an undo; `before` is what
 * it says, for the change. `delay` waits that long before its turn, for another change to take its place.
 */
export function startSlice(
  queryClient: QueryClient,
  job: {
    fileId: string;
    name: string;
    source: Blob | (() => Promise<Blob>);
    chosen?: SliceOptions;
    defaults?: SlicingSettings;
    target: SliceTarget | null;
    again?: boolean;
    before?: SliceFigures;
    delay?: number;
  },
): Promise<SliceOutcome | null> {
  entries.get(job.fileId)?.controller.abort();
  changes.delete(job.fileId);
  const controller = new AbortController();
  const entry: Entry = {
    fileId: job.fileId,
    name: job.name,
    status: "waiting",
    fraction: 0,
    picture: entries.get(job.fileId)?.picture ?? false,
    chosen: job.chosen ?? {},
    again: !!job.again,
    ...(job.defaults ? { defaults: job.defaults } : {}),
    ...(job.before ? { before: job.before } : {}),
    target: job.target,
    queryClient,
    controller,
    done: Promise.resolve(null),
  };
  entries.set(job.fileId, entry);
  emit();
  const run = async (): Promise<SliceOutcome | null> => {
    if (job.delay) await sleep(job.delay);
    if (controller.signal.aborted) return null;
    update(entry, { status: "slicing" });
    let outcome: SliceOutcome;
    const ask = { chosen: entry.chosen, defaults: entry.defaults ?? (await slicingDefaults(queryClient)) };
    if (controller.signal.aborted) return null;
    try {
      const blob = typeof job.source === "function" ? await job.source() : job.source;
      const { sliceModel } = await import("./slice-model");
      outcome = await sliceModel(
        blob,
        job.name,
        ask,
        {
          onProgress: (fraction) => update(entry, { fraction }),
          onPicture: (png) => {
            entry.png = png;
            // Slicing again, the picture there stays until the new slice is saved.
            if (entry.again) return;
            setPreview(job.fileId, png, png);
            update(entry, { picture: true });
            // Wherever the file shows, its picture does now (an idea's cover, the journal), from this device.
            if (entry.target) showPicture(queryClient, entry.target, job.fileId);
          },
        },
        controller.signal,
      );
    } catch {
      if (controller.signal.aborted) return null;
      // The original or the slicer's code couldn't be fetched: this device's trouble, not the model's.
      const { notSliced } = await import("./slice-model");
      outcome = notSliced("engine", ask);
    }
    if (controller.signal.aborted) return null;
    if (outcome.png && outcome.png !== entry.png) entry.png = outcome.png;
    if (entry.png && !entry.again) setPreview(job.fileId, entry.png, entry.png);
    if (!outcome.ok && outcome.slice.problem === "memory") outcome.slice.device = onPhone() ? "phone" : "computer";
    entry.outcome = outcome;
    update(entry, { status: outcome.ok ? "sliced" : "failed", fraction: 1, picture: !!entry.png });
    if (entry.target) void save(entry);
    return outcome;
  };
  const turn = queue.then(run, run);
  queue = turn.catch(() => null);
  entry.done = turn.catch(() => null);
  return entry.done;
}

/** The model of a sheet's draft has its place now (the attempt was saved): what slicing made goes there. */
export function attachSlice(fileId: string, target: SliceTarget) {
  const entry = entries.get(fileId);
  if (!entry || entry.target) return;
  entry.target = target;
  if (entry.outcome) void save(entry);
}

/** Stops a job (its model was taken off, or the change was taken back) and forgets what it made. */
export function cancelSlice(fileId: string) {
  const entry = entries.get(fileId);
  if (!entry) return;
  entry.controller.abort();
  entries.delete(fileId);
  emit();
}

/** What a job made, when it is done (null if it was cancelled). */
export const sliceResult = (fileId: string): Promise<SliceOutcome | null> | undefined => entries.get(fileId)?.done;

/** The plate picture a job drew, for a model saved before the server has its slice. */
export const slicePicture = (fileId: string): Blob | undefined => entries.get(fileId)?.png;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The job of a file on this device, if it has one. */
export function useSliceJob(fileId: string): SliceJob | undefined {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.get(fileId),
    () => undefined,
  );
}

/** What the last re-slice of a file on this device changed, until it is undone or the page forgets it. */
export function useSliceChange(fileId: string): SliceChange | undefined {
  return useSyncExternalStore(
    subscribe,
    () => changeSnapshot.get(fileId),
    () => undefined,
  );
}

/** The change is no longer news (the settings changed again, or it was undone). */
export function forgetChange(fileId: string) {
  if (changes.delete(fileId)) emit();
}

/**
 * Sends what a job made to its model's row: the sliced file, its picture, what it said and how it was sliced, or
 * why it couldn't be. The engine not starting is this device's trouble and stays here. A model that isn't on the
 * server yet (still in the outbox) answers 404 for a while: it tries again, for as long as the tab is open.
 */
async function save(entry: Entry) {
  const { outcome, target } = entry;
  if (!outcome || !target) return;
  if (!outcome.ok && outcome.slice.problem === "engine") return;
  const form = new FormData();
  form.set("slice", JSON.stringify(outcome.slice));
  if (outcome.png) form.set("thumb", outcome.png, "plate_1.png");
  if (outcome.ok) {
    form.set("sliced", outcome.sliced, slicedName(entry.name));
    form.set("prefill", JSON.stringify(outcome.prefill));
    if (outcome.objects.length) form.set("objects", JSON.stringify(outcome.objects));
    if (outcome.slicer) form.set("slicer", outcome.slicer);
  }
  // Slicing again, the server keeps the slice this replaces for one undo.
  if (entry.again) form.set("keep", "previous");
  for (let tries = 0; tries < 60; tries++) {
    if (entry.controller.signal.aborted || entries.get(entry.fileId) !== entry) return;
    try {
      const { file } = await api<ItemFileResponse>(`/files/${entry.fileId}/sliced`, {
        method: "PUT",
        body: form,
        keepalive: false,
      });
      if (entry.again && entry.png) setPreview(entry.fileId, entry.png, entry.png);
      showSavedFile(entry.queryClient, target, file);
      if (entries.get(entry.fileId) === entry) {
        entries.delete(entry.fileId);
        if (entry.again && entry.before) {
          changes.set(
            entry.fileId,
            outcome.ok
              ? { before: entry.before, after: figuresOf(outcome.prefill) }
              : { before: entry.before, after: {}, failed: true },
          );
        }
        emit();
      }
      return;
    } catch (error) {
      // Refused (too large, not a model): it stays as this device made it.
      if (error instanceof ApiError && error.status !== 404 && error.status < 500) return;
      await sleep(Math.min(30_000, 2_000 * 1.4 ** tries));
    }
  }
}

/**
 * Undoes the last re-slice: the slice it replaced is shown at once (its picture is the server's again) and the server
 * brings it back (POST /api/files/:id/sliced/restore). Puts things as they were if it can't.
 */
export async function undoSlice(queryClient: QueryClient, target: SliceTarget, file: AttemptFile) {
  const previous = file.previous;
  if (!previous) return;
  forgetChange(file.id);
  dropPreview(file.id);
  showSavedFile(queryClient, target, {
    ...file,
    slice: previous.slice,
    prefill: previous.prefill,
    objects: previous.objects,
    slicer: previous.slicer,
    hasThumb: file.hasThumb || previous.hasThumb,
    slicing: previous.slice.settings.slicing ?? file.slicing ?? null,
    previous: null,
  });
  try {
    const { file: saved } = await api<ItemFileResponse>(`/files/${file.id}/sliced/restore`, { method: "POST" });
    showSavedFile(queryClient, target, saved);
  } catch {
    showSavedFile(queryClient, target, file);
    toast.error("Couldn't go back to the last slice", "Check the connection and try again.");
  }
}

/** Settings waiting to be kept, by file: a few quick taps make one write (and one slice). */
const pending = new Map<string, ReturnType<typeof setTimeout>>();
/** How long a change waits for the next tap before it is kept and sliced. */
export const CHANGE_PAUSE_MS = 450;

/**
 * People changed a model's slicing settings (decision 0047): the card shows them at once, the server keeps them
 * (PATCH /api/files/:id), and a moment later the model is sliced again in the background, the slice there staying
 * until the new one is ready. Another change within the pause takes this one's place.
 */
export function changeSlicing(
  queryClient: QueryClient,
  { target, file, next }: { target: SliceTarget; file: AttemptFile; next: SlicingSettings },
) {
  const before = file.slicing ?? null;
  patchFile(queryClient, target, file.id, { slicing: next });
  forgetChange(file.id);
  clearTimeout(pending.get(file.id));
  pending.set(
    file.id,
    setTimeout(() => {
      pending.delete(file.id);
      api<ItemFileResponse>(`/files/${file.id}`, { method: "PATCH", json: { slicing: next } }).catch(() => {
        patchFile(queryClient, target, file.id, { slicing: before });
        toast.error("Couldn't keep those settings", "Check the connection and try again.");
      });
    }, CHANGE_PAUSE_MS),
  );
  // The job is there at once (the card says "Slicing with Fine"), and waits the pause before its turn.
  const sliced = file.slice?.status === "sliced";
  void startSlice(queryClient, {
    fileId: file.id,
    name: file.name,
    source: () => fetchOriginal(file.id),
    chosen: next,
    target,
    again: sliced,
    ...(sliced ? { before: figuresOf(file.prefill) } : {}),
    delay: CHANGE_PAUSE_MS,
  });
}

/**
 * Takes back a change still being sliced: the job stops, and the settings are what the slice there was made with.
 */
export function keepSlice(queryClient: QueryClient, target: SliceTarget, file: AttemptFile) {
  clearTimeout(pending.get(file.id));
  pending.delete(file.id);
  cancelSlice(file.id);
  const made = file.slice ? slicingOfSlice(file.slice) : null;
  patchFile(queryClient, target, file.id, { slicing: made });
  void api(`/files/${file.id}`, { method: "PATCH", json: { slicing: made } }).catch(() => undefined);
}

/** A model's plate picture is drawn: its row says so, so the page shows it (lib/previews has it on this device). */
function showPicture(queryClient: QueryClient, target: SliceTarget, fileId: string) {
  patchFile(queryClient, target, fileId, { hasThumb: true });
}

/** Changes a file wherever the page shows it. */
function patchFile(queryClient: QueryClient, target: SliceTarget, fileId: string, change: Partial<AttemptFile>) {
  patchCachedItem(queryClient, target.itemId, (item) =>
    target.attemptId
      ? {
          ...item,
          attempts: item.attempts.map((attempt) =>
            attempt.id === target.attemptId && attempt.file?.id === fileId
              ? { ...attempt, file: { ...attempt.file, ...change } }
              : attempt,
          ),
        }
      : { ...item, files: (item.files ?? []).map((kept) => (kept.id === fileId ? { ...kept, ...change } : kept)) },
  );
}

/** The server's copy of a model, wherever the page shows it. */
export function showSavedFile(queryClient: QueryClient, target: SliceTarget, file: AttemptFile) {
  patchCachedItem(queryClient, target.itemId, (item) =>
    target.attemptId
      ? {
          ...item,
          attempts: item.attempts.map((attempt) =>
            attempt.id === target.attemptId && attempt.file?.id === file.id ? { ...attempt, file } : attempt,
          ),
        }
      : { ...item, files: (item.files ?? []).map((kept) => (kept.id === file.id ? file : kept)) },
  );
}
