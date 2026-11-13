import type { AttemptFile, ItemFileResponse } from "@shared/api";
import { defaultSettings } from "@shared/slicing/defaults.ts";
import { slicedName } from "@shared/slicing/files.ts";
import type { SliceOptions } from "@shared/slicing/types.ts";
import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { ApiError, api } from "../api";
import { patchCachedItem } from "../items";
import { setPreview } from "../previews";
import type { SliceOutcome } from "./slice-model";

/**
 * Slicing as background jobs on this device: one model at a time (a phone has the memory for one), on through page
 * changes, gone with the tab. A job slices (slice-model.ts, loaded on first use), shows its plate picture as soon as
 * it is drawn, and sends what it made to the model's row (PUT /api/files/:id/sliced) once the model is on the server
 * and its place is known: at once for an idea's file, when the sheet saves for an attempt's. The card reads its
 * progress with `useSliceJob`; when the server has the slice, the job is done and the card reads the file.
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
  options: SliceOptions;
  /** What it made, until the server has it. */
  outcome?: SliceOutcome;
}

interface Entry extends SliceJob {
  name: string;
  target: SliceTarget | null;
  queryClient: QueryClient;
  controller: AbortController;
  png?: Blob;
  done: Promise<SliceOutcome | null>;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, SliceJob> = new Map();
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
        options: entry.options,
        ...(entry.outcome ? { outcome: entry.outcome } : {}),
      },
    ]),
  );
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
 * Slices a model in the background. `source` is the original, or how to get it (a saved model's bytes, fetched
 * when its turn comes). A null `target` keeps the result until `attachSlice` says where the model went.
 */
export function startSlice(
  queryClient: QueryClient,
  job: {
    fileId: string;
    name: string;
    source: Blob | (() => Promise<Blob>);
    options?: SliceOptions;
    target: SliceTarget | null;
  },
): Promise<SliceOutcome | null> {
  entries.get(job.fileId)?.controller.abort();
  const controller = new AbortController();
  const entry: Entry = {
    fileId: job.fileId,
    name: job.name,
    status: "waiting",
    fraction: 0,
    picture: entries.get(job.fileId)?.picture ?? false,
    options: job.options ?? {},
    target: job.target,
    queryClient,
    controller,
    done: Promise.resolve(null),
  };
  entries.set(job.fileId, entry);
  emit();
  const run = async (): Promise<SliceOutcome | null> => {
    if (controller.signal.aborted) return null;
    update(entry, { status: "slicing" });
    let outcome: SliceOutcome;
    try {
      const blob = typeof job.source === "function" ? await job.source() : job.source;
      const { sliceModel } = await import("./slice-model");
      outcome = await sliceModel(
        blob,
        job.name,
        entry.options,
        {
          onProgress: (fraction) => update(entry, { fraction }),
          onPicture: (png) => {
            entry.png = png;
            setPreview(job.fileId, png, png);
            update(entry, { picture: true });
          },
        },
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) return null;
      // The original or the slicer's code couldn't be fetched: this device's trouble, not the model's.
      outcome = {
        ok: false,
        png: null,
        slice: {
          status: "failed",
          problem: "engine",
          settings: { ...defaultSettings(entry.options), scale: entry.options.scale ?? 100, engine: "", orca: "" },
          at: Date.now(),
        },
      };
      void error;
    }
    if (controller.signal.aborted) return null;
    if (outcome.png && outcome.png !== entry.png) {
      entry.png = outcome.png;
      setPreview(job.fileId, outcome.png, outcome.png);
    }
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

/** Stops a job (its model was taken off) and forgets what it made. */
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
  for (let tries = 0; tries < 60; tries++) {
    if (entry.controller.signal.aborted || entries.get(entry.fileId) !== entry) return;
    try {
      const { file } = await api<ItemFileResponse>(`/files/${entry.fileId}/sliced`, {
        method: "PUT",
        body: form,
        keepalive: false,
      });
      showSavedFile(entry.queryClient, target, file);
      if (entries.get(entry.fileId) === entry) {
        entries.delete(entry.fileId);
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
