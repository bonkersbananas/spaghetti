/**
 * What the bridge does for each moment, against the app. Every job is safe to run twice: ids are made from the
 * printer and the print, and the app answers a repeat with what it already has.
 */
import type { Attempt, Item, PrintFactsRequest } from "../src/shared/api.ts";
import { MAX_SLICER_FILE_BYTES } from "../src/shared/api.ts";
import { printablePlates, settingsFromFile, slicerName } from "../src/shared/threemf/prefill.ts";
import { readThreeMf } from "../src/shared/threemf/read.ts";
import { type AmsAction, planAmsSync, type Tray } from "./ams.ts";
import { type Api, HttpError } from "./api.ts";
import type { Job } from "./job-machine.ts";
import { jpegSize, stableId, titleFromJob } from "./names.ts";
import type { Store } from "./store.ts";

/** A hand-started attempt is attached to only if it began no earlier than this before the printer's start. */
export const ATTACH_WINDOW_MS = 12 * 60 * 60_000;

export type JobPayload =
  | { type: "start"; job: Job; fileName: string | null }
  | { type: "trays"; job: Job }
  | { type: "end"; job: Job; endedAt: number; suggestedTag: string | null }
  | { type: "photo"; job: Job; takenAt: number }
  | { type: "ams"; trays: Tray[] };

export interface JobContext {
  api: Api;
  store: Store;
  /** Identifies this printer in the ids the bridge makes. */
  printerId: string;
  log: (message: string) => void;
}

const FILE_TYPE = "application/vnd.ms-package.3dmanufacturing-3dmodel+xml";

/** The attempt a hand-started, still-printing, fileless attempt would be: the latest of those, if any. */
export function findHandStarted(builds: readonly Item[], job: Job, known: ReadonlySet<string>) {
  return builds
    .flatMap((item) => item.attempts.map((attempt) => ({ item, attempt })))
    .filter(
      ({ attempt }) =>
        attempt.outcome === null &&
        attempt.endedAt === null &&
        !attempt.file &&
        // Made by a person, not by this bridge (or another agent) for some other print.
        attempt.createdVia === null &&
        !known.has(attempt.id) &&
        attempt.printedAt >= job.startedAt - ATTACH_WINDOW_MS,
    )
    .sort((a, b) => b.attempt.printedAt - a.attempt.printedAt)[0];
}

/**
 * What the printer said about the print, for the app to find the build it belongs to (decision 0076): the bridge
 * files it in a build of its own and the app moves it to the one it matches, if any.
 */
export function printFacts(job: Job, fileName: string | null, estimate: number | undefined): PrintFactsRequest {
  return {
    name: job.name || fileName,
    gcodeFile: job.gcodeFile,
    plate: job.plate,
    estimateMinutes: job.estimateMinutes ?? estimate ?? null,
    // Left out when the printer named no tray, as an older bridge does.
    ...(job.trays?.length ? { trays: job.trays } : {}),
  };
}

export async function startJob(ctx: JobContext, payload: Extract<JobPayload, { type: "start" }>, bytes?: Uint8Array) {
  const { api, store } = ctx;
  const { job } = payload;
  let ref = store.attemptFor(job.key);
  const read = bytes ? readFile(bytes, job.plate) : null;
  if (!ref) {
    const builds = await api.builds();
    const known = new Set(Object.values(store.data.attempts).map((entry) => entry.attemptId));
    const attemptId = stableId(ctx.printerId, job.key, "attempt");
    const hand = findHandStarted(builds, job, known);
    if (hand) {
      ctx.log(`Attaching the print "${job.name}" to the attempt already started by hand.`);
      ref = { itemId: hand.item.id, attemptId: hand.attempt.id };
    } else {
      // A build of its own, which the app swaps for the build the print belongs to when it finds one.
      ctx.log(`Filing the print "${job.name}"; the app puts it in the build it belongs to.`);
      ref = {
        itemId: stableId(ctx.printerId, job.key, "build"),
        attemptId,
        todo: {
          createItem: { title: titleFromJob(payload.fileName ?? job.name) },
          // The file's settings when there is a file; without one the app carries the build's last attempt's over.
          ...(read ? { settings: read.settings } : {}),
          printedAt: job.startedAt,
        },
      };
    }
    store.rememberAttempt(job.key, ref);
  }
  if (ref.todo) {
    const { createItem, settings, printedAt } = ref.todo;
    if (createItem) await api.createItem({ id: ref.itemId, title: createItem.title, stage: "building" });
    const attempt = await api.createAttempt(ref.itemId, {
      id: ref.attemptId,
      printedAt,
      ...(settings ? { settings } : {}),
      print: printFacts(job, payload.fileName, read?.settings.estimatedMinutes),
    });
    // Where the app put it: the build it matched, or the one made for it.
    ref = { itemId: attempt.itemId ?? ref.itemId, attemptId: ref.attemptId };
    store.rememberAttempt(job.key, ref);
  }
  if (bytes && read)
    await uploadFile(api, ref.attemptId, job, payload.fileName ?? `${job.name}.gcode.3mf`, bytes, read);
}

function readFile(bytes: Uint8Array, plateNumber: number) {
  const result = readThreeMf(bytes);
  const plates = printablePlates(result);
  const plate = plates.find((candidate) => candidate.index === plateNumber) ?? plates[0];
  return {
    result,
    plate,
    settings: settingsFromFile(result, plate?.index),
    plateCount: Math.max(1, result.plates.length),
  };
}

async function uploadFile(
  api: Api,
  attemptId: string,
  job: Job,
  name: string,
  bytes: Uint8Array,
  read: ReturnType<typeof readFile>,
) {
  const form = new FormData();
  form.set("id", stableId(attemptId, "file"));
  form.set("name", name);
  form.set("size", String(bytes.length));
  form.set("plate", String(read.plate?.index ?? job.plate));
  form.set("plateCount", String(read.plateCount));
  const slicer = slicerName(read.result);
  if (slicer) form.set("slicer", slicer);
  form.set("prefill", JSON.stringify(read.settings));
  const thumb = read.plate?.thumbnail;
  if (thumb) form.set("thumb", new File([thumb.bytes as BlobPart], "thumb.png", { type: thumb.mediaType }));
  if (bytes.length <= MAX_SLICER_FILE_BYTES) form.set("file", new File([bytes as BlobPart], name, { type: FILE_TYPE }));
  await api.putFile(attemptId, form);
}

/** The trays that fed the print, once it is printing: by its attempt alone, wherever it is by now. */
export async function traysJob(ctx: JobContext, payload: Extract<JobPayload, { type: "trays" }>) {
  const ref = ctx.store.attemptFor(payload.job.key);
  if (!ref) return;
  try {
    await ctx.api.updateAttempt(ref.attemptId, { trays: payload.job.trays ?? [] });
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return;
    throw error;
  }
}

export async function endJob(ctx: JobContext, payload: Extract<JobPayload, { type: "end" }>) {
  const ref = ctx.store.attemptFor(payload.job.key);
  if (!ref) {
    ctx.log(`Nothing to end for "${payload.job.name}": its start never reached the app.`);
    return;
  }
  const minutes = Math.max(1, Math.round((payload.endedAt - payload.job.startedAt) / 60_000));
  // By the attempt alone: someone may have moved it to another build since (decision 0076).
  try {
    await ctx.api.updateAttempt(ref.attemptId, {
      endedAt: payload.endedAt,
      suggestedFailureTag: payload.suggestedTag,
      settingsMerge: { set: { actualMinutes: minutes } },
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      ctx.log(`Nothing to end for "${payload.job.name}": its attempt was deleted.`);
      return;
    }
    throw error;
  }
}

export async function photoJob(ctx: JobContext, payload: Extract<JobPayload, { type: "photo" }>, bytes?: Uint8Array) {
  const ref = ctx.store.attemptFor(payload.job.key);
  if (!ref || !bytes) return;
  const size = jpegSize(bytes) ?? { width: 1920, height: 1080 };
  const form = new FormData();
  form.set("width", String(size.width));
  form.set("height", String(size.height));
  // The next browser works out the real colour and makes the thumbnail.
  form.set("color", "#a9a095");
  form.set("needsResize", "1");
  form.set("attemptId", ref.attemptId);
  form.set("takenAt", String(payload.takenAt));
  form.set("large", new File([bytes as BlobPart], "frame.jpg", { type: "image/jpeg" }));
  form.set("thumb", new File([bytes as BlobPart], "frame.jpg", { type: "image/jpeg" }));
  await ctx.api.putPhoto(ref.itemId, stableId(ref.attemptId, "photo"), form);
}

/** Runs the plan against the app. Returns the trays nobody could match, for the Printer page. */
export async function amsJob(ctx: JobContext, payload: Extract<JobPayload, { type: "ams" }>) {
  const spools = await ctx.api.spools();
  const plan = planAmsSync(payload.trays, spools, ctx.printerId);
  for (const action of plan.actions) await apply(ctx, action);
  await ctx.api.tell({ unknownTrays: plan.unknown });
  for (const tray of plan.unknown) ctx.log(`Unknown spool in ${tray.slot}.`);
}

async function apply({ api, log }: JobContext, action: AmsAction) {
  switch (action.type) {
    case "createSpool": {
      const { spool } = action;
      await api.createSpool(spool);
      log(`${`Added a spool for the Bambu ${spool.material} ${spool.colorName ?? ""}`.trim()}.`);
      return;
    }
    case "load":
      await api.setSlot(action.slot, action.spoolId);
      return;
    case "setLevel":
      await api.updateSpool(action.spoolId, { remaining: action.remaining });
      return;
    case "setTrayUuid":
      await api.updateSpool(action.spoolId, { trayUuid: action.trayUuid });
      return;
  }
}

export type { Attempt };
