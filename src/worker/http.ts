import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type {
  Attempt as ApiAttempt,
  AttemptFile as ApiAttemptFile,
  Item as ApiItem,
  Part as ApiPart,
  Photo as ApiPhoto,
  Person,
} from "../shared/api.ts";
import { byPrintTime, describeChanges } from "../shared/attempts.ts";
import type { Coach } from "../shared/coach.ts";
import type { PhotoRead } from "../shared/photo-read.ts";
import type { Reaction } from "../shared/reactions.ts";
import type {
  Attempt,
  AttemptFileRow,
  CoachRunRow,
  Item,
  ItemDraftRow,
  ItemFileRow,
  Part,
  Photo,
  User,
} from "./db/schema.ts";
import { toApiDraft } from "./draft/run.ts";

export function apiError(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

export function toPerson(user: User): Person {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    color: user.color,
    photoUrl: user.photoKey ? `/api/people/${user.id}/photo?v=${user.photoKey.split("/").pop()}` : null,
  };
}

export function toApiPhoto(photo: Photo): ApiPhoto {
  return {
    id: photo.id,
    itemId: photo.itemId,
    position: photo.position,
    width: photo.width,
    height: photo.height,
    color: photo.color,
    takenAt: photo.takenAt?.getTime() ?? null,
    attemptId: photo.attemptId,
    needsResize: photo.needsResize,
    createdBy: photo.createdBy,
    createdAt: photo.createdAt.getTime(),
  };
}

export function toApiPart(part: Part): ApiPart {
  return {
    id: part.id,
    itemId: part.itemId,
    name: part.name,
    quantity: part.quantity,
    position: part.position,
    photoId: part.photoId,
    createdAt: part.createdAt.getTime(),
    updatedAt: part.updatedAt.getTime(),
  };
}

export function toApiFile(file: Omit<AttemptFileRow, "attemptId">): ApiAttemptFile {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    stored: file.stored,
    hasThumb: file.hasThumb,
    plate: file.plate,
    plateCount: file.plateCount,
    slicer: file.slicer,
    prefill: file.prefill,
    objects: file.objects,
    kind: file.kind,
    slice: file.slice ?? null,
    slicing: file.slicing ?? null,
    previous: file.previousSlice ?? null,
    createdAt: file.createdAt.getTime(),
  };
}

/** Live (not deleted) files by attempt id. */
export type FilesByAttempt = ReadonlyMap<string, AttemptFileRow>;
/** What Claude made of each attempt's photos (worker/photo-read/run.ts toApiPhotoRead), by attempt id. */
export type ReadsByAttempt = ReadonlyMap<string, PhotoRead>;

/** The failure coach's rows, by attempt id (worker/coach/run.ts coachesByAttempt). */
export type CoachesByAttempt = ReadonlyMap<string, CoachRunRow>;

/** The attempt's coach as the API shows it: nothing unless it is still Partly or Spaghetti. */
export function toApiCoach(row: CoachRunRow | undefined, outcome: string | null): Coach | null {
  if (!row || (outcome !== "partial" && outcome !== "failed")) return null;
  if (row.status === "thinking") return { status: "thinking", items: [] };
  if (row.status !== "done" || !row.suggestions.length) return null;
  return {
    status: "ready",
    items: row.suggestions.map((item) => ({ ...item, dismissed: row.dismissed.includes(item.id) })),
  };
}

/** An attempt, with what changed since `previous` (the non-deleted attempt printed before it, if any). */
export function toApiAttempt(
  attempt: Attempt,
  previous: Attempt | null | undefined,
  files: FilesByAttempt = new Map(),
  reads: ReadsByAttempt = new Map(),
  coaches: CoachesByAttempt = new Map(),
): ApiAttempt {
  const file = files.get(attempt.id);
  return {
    id: attempt.id,
    itemId: attempt.itemId,
    outcome: attempt.outcome,
    printedAt: attempt.printedAt.getTime(),
    finishedAt: attempt.finishedAt?.getTime() ?? null,
    endedAt: attempt.endedAt?.getTime() ?? null,
    suggestedFailureTag: attempt.suggestedFailureTag,
    // Once someone said how it went, "looking at the photo" is moot; the suggestion stays so the tags it gave stay marked.
    photoRead: attempt.outcome && reads.get(attempt.id)?.status === "reading" ? null : (reads.get(attempt.id) ?? null),
    coach: toApiCoach(coaches.get(attempt.id), attempt.outcome),
    note: attempt.note,
    failureTags: attempt.failureTags,
    successNotes: attempt.successNotes,
    settings: attempt.settings,
    parts: attempt.parts,
    changes: previous ? describeChanges(previous.settings, attempt.settings) : [],
    file: file ? toApiFile(file) : null,
    createdBy: attempt.createdBy,
    createdVia: attempt.createdVia,
    finishedBy: attempt.finishedBy,
    finishedVia: attempt.finishedVia,
    createdAt: attempt.createdAt.getTime(),
    updatedAt: attempt.updatedAt.getTime(),
  };
}

/** One item's non-deleted attempts, oldest first, each compared with the one before. */
export function toApiAttempts(
  itemAttempts: Attempt[],
  files: FilesByAttempt = new Map(),
  reads: ReadsByAttempt = new Map(),
  coaches: CoachesByAttempt = new Map(),
): ApiAttempt[] {
  const ordered = byPrintTime(
    itemAttempts.map((row) => ({
      row,
      id: row.id,
      printedAt: row.printedAt.getTime(),
      createdAt: row.createdAt.getTime(),
    })),
  ).map(({ row }) => row);
  return ordered.map((attempt, index) => toApiAttempt(attempt, ordered[index - 1], files, reads, coaches));
}

/** `itemAttempts` are the item's non-deleted attempts, in any order. */
export function toApiItem(
  item: Item,
  itemPhotos: Photo[],
  itemAttempts: Attempt[] = [],
  files: FilesByAttempt = new Map(),
  draft: ItemDraftRow | null = null,
  itemParts: Part[] = [],
  reads: ReadsByAttempt = new Map(),
  coaches: CoachesByAttempt = new Map(),
  itemReactions: Reaction[] = [],
  itemFiles: ItemFileRow[] = [],
): ApiItem {
  return {
    id: item.id,
    stage: item.stage,
    title: item.title,
    note: item.note,
    createdBy: item.createdBy,
    createdVia: item.createdVia,
    createdAt: item.createdAt.getTime(),
    updatedAt: item.updatedAt.getTime(),
    startedAt: item.startedAt?.getTime() ?? null,
    finishedAt: item.finishedAt?.getTime() ?? null,
    coverPhotoId: item.coverPhotoId,
    upNext: item.upNext,
    forWhom: item.forWhom,
    twistId: item.twistId,
    parts: itemParts.map(toApiPart),
    photos: itemPhotos.map(toApiPhoto),
    attempts: toApiAttempts(itemAttempts, files, reads, coaches),
    draft: toApiDraft(draft),
    reactions: itemReactions,
    files: itemFiles.map(toApiFile),
  };
}
