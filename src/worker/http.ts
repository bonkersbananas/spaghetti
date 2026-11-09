import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Attempt as ApiAttempt, Item as ApiItem, Photo as ApiPhoto, Person } from "../shared/api.ts";
import { byPrintTime, describeChanges } from "../shared/attempts.ts";
import type { Attempt, Item, Photo, User } from "./db/schema.ts";

export function apiError(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

export function toPerson(user: User): Person {
  return { id: user.id, username: user.username, name: user.name, color: user.color };
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
    createdBy: photo.createdBy,
    createdAt: photo.createdAt.getTime(),
  };
}

/** An attempt, with what changed since `previous` (the non-deleted attempt printed before it, if any). */
export function toApiAttempt(attempt: Attempt, previous: Attempt | null | undefined): ApiAttempt {
  return {
    id: attempt.id,
    itemId: attempt.itemId,
    outcome: attempt.outcome,
    printedAt: attempt.printedAt.getTime(),
    finishedAt: attempt.finishedAt?.getTime() ?? null,
    note: attempt.note,
    failureTags: attempt.failureTags,
    successNotes: attempt.successNotes,
    settings: attempt.settings,
    changes: previous ? describeChanges(previous.settings, attempt.settings) : [],
    createdBy: attempt.createdBy,
    finishedBy: attempt.finishedBy,
    createdAt: attempt.createdAt.getTime(),
    updatedAt: attempt.updatedAt.getTime(),
  };
}

/** One item's non-deleted attempts, oldest first, each compared with the one before. */
export function toApiAttempts(itemAttempts: Attempt[]): ApiAttempt[] {
  const ordered = byPrintTime(
    itemAttempts.map((row) => ({
      row,
      id: row.id,
      printedAt: row.printedAt.getTime(),
      createdAt: row.createdAt.getTime(),
    })),
  ).map(({ row }) => row);
  return ordered.map((attempt, index) => toApiAttempt(attempt, ordered[index - 1]));
}

/** `itemAttempts` are the item's non-deleted attempts, in any order. */
export function toApiItem(item: Item, itemPhotos: Photo[], itemAttempts: Attempt[] = []): ApiItem {
  return {
    id: item.id,
    stage: item.stage,
    title: item.title,
    note: item.note,
    createdBy: item.createdBy,
    createdAt: item.createdAt.getTime(),
    updatedAt: item.updatedAt.getTime(),
    startedAt: item.startedAt?.getTime() ?? null,
    finishedAt: item.finishedAt?.getTime() ?? null,
    coverPhotoId: item.coverPhotoId,
    photos: itemPhotos.map(toApiPhoto),
    attempts: toApiAttempts(itemAttempts),
  };
}
