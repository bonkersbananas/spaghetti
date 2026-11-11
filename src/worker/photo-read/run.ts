import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { PHOTO_READS_PER_DAY, type PhotoRead } from "../../shared/photo-read.ts";
import { recordChange } from "../changes.ts";
import { type Db, getDb } from "../db/index.ts";
import { attempts, items, type PhotoReadRow, photoReads, photos } from "../db/schema.ts";
import { photoKey } from "../photos.ts";
import { askClaudeAboutPhoto, type ReadResult } from "./claude.ts";

/** A worker that has had a read this long is taken to be gone (the Worker was recycled after the response). */
export const STALE_MS = 4 * 60 * 1000;
/** A read that was taken and lost this many times is given up on. */
const MAX_TRIES = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The Messages API takes images up to 5 MB; a margin for the encoding. */
export const MAX_READ_BYTES = 4_800_000;
/** After the response, `waitUntil` has about 30 seconds: the call is given a little less than that. */
export const WAIT_UNTIL_TIMEOUT_MS = 26_000;
/** The cron has all the time it needs. */
const CRON_TIMEOUT_MS = 120_000;

/** The feature exists only where the key is set: without it nothing about it shows. */
export const photoReadsEnabled = (env: Pick<Env, "ANTHROPIC_API_KEY">) => !!env.ANTHROPIC_API_KEY?.trim();

/**
 * The reads of an attempt as the attempt shows them: the newest photo's read is the one that counts, and a newer
 * photo Claude couldn't tell from leaves the older suggestion standing. Newest first in, one summary (or none) out.
 */
export function toApiPhotoRead(rows: readonly PhotoReadRow[]): PhotoRead | null {
  const newestFirst = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const newest = newestFirst[0];
  if (!newest) return null;
  if (newest.status === "reading") {
    return {
      status: "reading",
      photoId: newest.photoId,
      outcome: null,
      failureTags: [],
      successNotes: [],
      reason: null,
    };
  }
  const read = newestFirst.find((row) => row.status === "read" && row.outcome);
  if (!read?.outcome) return null;
  return {
    status: "read",
    photoId: read.photoId,
    outcome: read.outcome,
    failureTags: read.failureTags,
    successNotes: read.successNotes,
    reason: read.reason,
  };
}

/** The reads of these attempts, grouped by attempt. */
export async function readsByAttempt(db: Db, attemptIds: string[]): Promise<Map<string, PhotoReadRow[]>> {
  const grouped = new Map<string, PhotoReadRow[]>();
  for (let i = 0; i < attemptIds.length; i += 50) {
    const rows = await db
      .select()
      .from(photoReads)
      .where(inArray(photoReads.attemptId, attemptIds.slice(i, i + 50)))
      .orderBy(desc(photoReads.createdAt));
    for (const row of rows) grouped.set(row.attemptId, [...(grouped.get(row.attemptId) ?? []), row]);
  }
  return grouped;
}

/**
 * A photo was added to an attempt that has no outcome: makes the read job, so the attempt shows "Looking at the
 * photo…" at once. Doesn't call Claude (`runRead` does). Returns false when there is nothing to do: the photo was
 * already read or is being read, or the attempt already has its outcome.
 */
export async function startRead(
  db: Db,
  photo: { id: string; attemptId: string; itemId: string },
  actor: { id: string },
): Promise<boolean> {
  const open = await db
    .select({ id: attempts.id })
    .from(attempts)
    .where(and(eq(attempts.id, photo.attemptId), isNull(attempts.outcome), isNull(attempts.deletedAt)))
    .get();
  if (!open) return false;
  const [inserted] = await db.batch([
    db
      .insert(photoReads)
      .values({
        photoId: photo.id,
        attemptId: photo.attemptId,
        itemId: photo.itemId,
        status: "reading",
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: photoReads.photoId }),
    recordChange(db, {
      entity: "attempt",
      id: photo.attemptId,
      itemId: photo.itemId,
      action: "updated",
      actor: { kind: "person", id: actor.id },
    }),
  ]);
  return inserted.length > 0;
}

/** Settles the job with what happened, and tells the feed so the attempt's suggestion shows (also for the other person). */
async function settle(db: Db, row: PhotoReadRow, set: Partial<typeof photoReads.$inferInsert>) {
  const owner = (await db.select({ id: attempts.createdBy }).from(attempts).where(eq(attempts.id, row.attemptId)).get())
    ?.id;
  await db.batch([
    db
      .update(photoReads)
      .set({ claimedAt: null, ...set })
      .where(eq(photoReads.photoId, row.photoId)),
    recordChange(db, {
      entity: "attempt",
      id: row.attemptId,
      itemId: row.itemId,
      action: "updated",
      actor: { kind: "person", id: owner ?? "" },
    }),
  ]);
}

const CONTENT_TYPES = ["image/jpeg", "image/webp", "image/png", "image/gif"] as const;

/**
 * Takes the photo's read job and does it: looks at the photo with Claude and keeps what it suggests. Safe to call
 * from several places at once (the upload's waitUntil, the cron): only the one that wins the claim goes on. It never
 * throws, and it never touches the attempt's outcome, tags or note: those are people's.
 */
export async function runRead(
  env: Env,
  photoId: string,
  db: Db = getDb(env.DB),
  timeoutMs = WAIT_UNTIL_TIMEOUT_MS,
): Promise<void> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return;
  const now = Date.now();
  const [row] = await db
    .update(photoReads)
    .set({ claimedAt: new Date(now), tries: sql`${photoReads.tries} + 1` })
    .where(
      and(
        eq(photoReads.photoId, photoId),
        eq(photoReads.status, "reading"),
        or(isNull(photoReads.claimedAt), lt(photoReads.claimedAt, new Date(now - STALE_MS))),
      ),
    )
    .returning();
  if (!row) return;

  const found = await db
    .select({ attempt: attempts, photo: photos, title: items.title })
    .from(photos)
    .innerJoin(attempts, eq(attempts.id, row.attemptId))
    .innerJoin(items, eq(items.id, attempts.itemId))
    .where(and(eq(photos.id, photoId), isNull(photos.deletedAt), isNull(attempts.deletedAt), isNull(items.deletedAt)))
    .get();
  // Nothing to suggest to: the photo or the attempt is gone, or someone already said how it went.
  if (!found || found.attempt.outcome) {
    return settle(db, row, { status: "skipped", runOutcome: found ? "outcome_set" : "gone" });
  }
  const fail = (runOutcome: string, detail?: object) =>
    settle(db, row, {
      status: "failed",
      runOutcome,
      detail: detail ? JSON.stringify(detail) : null,
    });

  // The day's cap is shared by both people (UTC days: it only has to be about right).
  const since = new Date(now - (now % DAY_MS));
  if ((await db.$count(photoReads, gte(photoReads.ranAt, since))) >= PHOTO_READS_PER_DAY) return fail("cap");

  // The large variant (resized in the browser); the bridge's frame has the original in both until a browser resizes it.
  const object = await env.PHOTOS.get(photoKey(photoId, "large"));
  if (!object) return fail("no_photo");
  const contentType = (object.httpMetadata?.contentType ?? found.photo.contentType) as (typeof CONTENT_TYPES)[number];
  if (
    !CONTENT_TYPES.includes(contentType) ||
    object.size > MAX_READ_BYTES ||
    found.photo.width > 8000 ||
    found.photo.height > 8000
  ) {
    return fail("too_large", { size: object.size });
  }
  const bytes = new Uint8Array(await object.arrayBuffer());

  await db
    .update(photoReads)
    .set({ ranAt: new Date(now) })
    .where(eq(photoReads.photoId, photoId));
  const base = env.ANTHROPIC_BASE_URL?.trim();
  const answer: ReadResult = await askClaudeAboutPhoto(
    apiKey,
    {
      bytes,
      contentType,
      title: found.title,
      attemptNote: found.attempt.note,
      printerSaid: found.attempt.suggestedFailureTag,
    },
    { baseURL: base, timeoutMs },
  );
  const { outcome: runOutcome, ...detail } = answer.diagnosis;
  const record = { runOutcome, detail: JSON.stringify(detail) };
  if (!answer.ok) return settle(db, row, { status: answer.unsure ? "unsure" : "failed", ...record });

  // The suggestion makes sense as a whole: a failure has no success notes, a success no failure tags.
  const { read } = answer;
  await settle(db, row, {
    status: "read",
    outcome: read.outcome,
    failureTags: read.outcome === "success" ? [] : read.failureTags,
    successNotes: read.outcome === "failed" ? [] : read.successNotes,
    reason: read.reason?.trim() || null,
    ...record,
  });
}

/** The cron's fallback: reads nobody is working on any more (a recycled Worker) are picked up. */
export async function resumeReads(env: Env, now = Date.now()): Promise<number> {
  if (!photoReadsEnabled(env)) return 0;
  const db = getDb(env.DB);
  const stale = new Date(now - STALE_MS);
  const waiting = await db
    .select()
    .from(photoReads)
    .where(and(eq(photoReads.status, "reading"), or(isNull(photoReads.claimedAt), lt(photoReads.claimedAt, stale))))
    .limit(3);
  for (const row of waiting) {
    if (row.tries >= MAX_TRIES) await settle(db, row, { status: "failed", runOutcome: "timeout" });
    else await runRead(env, row.photoId, db, CRON_TIMEOUT_MS);
  }
  return waiting.length;
}
