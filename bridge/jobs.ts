/**
 * What the bridge does for each moment, against the app. Every job is safe to run twice: ids are made from the
 * printer and the print, and the app answers a repeat with what it already has.
 */
import type { Attempt, Item } from "../src/shared/api.ts";
import { MAX_SLICER_FILE_BYTES } from "../src/shared/api.ts";
import { printablePlates, settingsFromFile, slicerName } from "../src/shared/threemf/prefill.ts";
import { readThreeMf } from "../src/shared/threemf/read.ts";
import { type AmsAction, planAmsSync, type Tray } from "./ams.ts";
import type { Api } from "./api.ts";
import type { Job } from "./job-machine.ts";
import { fileKey, jpegSize, stableId, titleFromJob } from "./names.ts";
import type { Store } from "./store.ts";

/** A hand-started attempt is attached to only if it began no earlier than this before the printer's start. */
export const ATTACH_WINDOW_MS = 12 * 60 * 60_000;

export type JobPayload =
  | { type: "start"; job: Job; fileName: string | null }
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

/** The open build whose latest attempt was printed from a slicer file with this print's name. */
export function findSameFile(builds: readonly Item[], job: Job, fileName: string | null) {
  const wanted = fileKey(fileName ?? job.name);
  if (!wanted) return undefined;
  return builds.find((item) => {
    const latest = [...item.attempts].sort((a, b) => b.printedAt - a.printedAt)[0];
    return latest?.file && fileKey(latest.file.name) === wanted;
  });
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
      const same = findSameFile(builds, job, payload.fileName);
      const itemId = same?.id ?? stableId(ctx.printerId, job.key, "build");
      ctx.log(
        same ? `Starting the next attempt on "${same.title ?? same.id}".` : `Starting a new build for "${job.name}".`,
      );
      ref = {
        itemId,
        attemptId,
        todo: {
          createItem: same ? null : { title: titleFromJob(payload.fileName ?? job.name) },
          // On a new build the file's settings; on a next attempt the app carries the last attempt's over.
          ...(read && !same ? { settings: read.settings } : {}),
          printedAt: job.startedAt,
        },
      };
    }
    store.rememberAttempt(job.key, ref);
  }
  if (ref.todo) {
    const { createItem, settings, printedAt } = ref.todo;
    if (createItem) await api.createItem({ id: ref.itemId, title: createItem.title, stage: "building" });
    await api.createAttempt(ref.itemId, { id: ref.attemptId, printedAt, ...(settings ? { settings } : {}) });
    ref = { itemId: ref.itemId, attemptId: ref.attemptId };
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

export async function endJob(ctx: JobContext, payload: Extract<JobPayload, { type: "end" }>) {
  const ref = ctx.store.attemptFor(payload.job.key);
  if (!ref) {
    ctx.log(`Nothing to end for "${payload.job.name}": its start never reached the app.`);
    return;
  }
  const item = await ctx.api.item(ref.itemId);
  const attempt = item.attempts.find((candidate) => candidate.id === ref.attemptId);
  if (!attempt) return;
  const minutes = Math.max(1, Math.round((payload.endedAt - payload.job.startedAt) / 60_000));
  await ctx.api.updateAttempt(attempt.id, {
    endedAt: payload.endedAt,
    suggestedFailureTag: payload.suggestedTag,
    settings: { ...attempt.settings, actualMinutes: minutes },
  });
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
