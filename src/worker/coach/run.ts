import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { COACH_MAX_ITEMS, COACH_PER_DAY, type CoachItem, sanitizeCoachSettings } from "../../shared/coach.ts";
import { canUse } from "../auth/scopes.ts";
import { recordChange } from "../changes.ts";
import { type Db, getDb } from "../db/index.ts";
import { attempts, type CoachRunRow, coachRuns, photos } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { MAX_READ_BYTES } from "../photo-read/run.ts";
import { photoKey } from "../photos.ts";
import { askClaudeToCoach, type CoachImage } from "./claude.ts";
import { type CoachPhoto, coachNotebook } from "./context.ts";

/** A claim older than this is taken to be gone (the Worker was recycled after the response). */
export const STALE_MS = 4 * 60 * 1000;
const MAX_TRIES = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
export const WAIT_UNTIL_TIMEOUT_MS = 26_000;
const CRON_TIMEOUT_MS = 120_000;
const CONTENT_TYPES = ["image/jpeg", "image/webp", "image/png", "image/gif"] as const;
/** Bigger than this is left out of the prompt: a few pictures go in one call. */
const MAX_IMAGE_BYTES = 1_500_000;

/**
 * When the coach thinks (decision 0081): only once the answer is complete. The job is made at the answer, but it runs
 * after the attempt has been quiet for `quietMs` (no new note, photo or answer), and once more, at most, when the
 * note, tags or photos change within `rerunWindowMs` of the answer. `waitMs` is how long the response's waitUntil sleeps before the first try. Tests set both to 0.
 */
export const coachTiming = { quietMs: 15_000, waitMs: 15_000, rerunWindowMs: 60 * 60 * 1000 };

/** The feature exists only where the key is set: without it nothing about it shows. */
export const coachEnabled = (env: Pick<Env, "ANTHROPIC_API_KEY">) => !!env.ANTHROPIC_API_KEY?.trim();

const coached = (outcome: string | null | undefined) => outcome === "partial" || outcome === "failed";

/** The coaches of these attempts, by attempt id. */
export async function coachesByAttempt(db: Db, attemptIds: string[]): Promise<Map<string, CoachRunRow>> {
  const map = new Map<string, CoachRunRow>();
  for (let i = 0; i < attemptIds.length; i += 50) {
    const rows = await db
      .select()
      .from(coachRuns)
      .where(inArray(coachRuns.attemptId, attemptIds.slice(i, i + 50)));
    for (const row of rows) map.set(row.attemptId, row);
  }
  return map;
}

/**
 * An attempt was answered Partly or Spaghetti: makes the coach's job, so the attempt shows "Thinking about the next
 * try…" at once. Doesn't call Claude (`runCoach` does). False when there is nothing to do (already coached).
 */
export async function startCoach(
  db: Db,
  attempt: { id: string; itemId: string },
  actor: { id: string },
): Promise<boolean> {
  const [inserted] = await db.batch([
    db
      .insert(coachRuns)
      .values({ attemptId: attempt.id, itemId: attempt.itemId, status: "thinking", createdAt: new Date() })
      .onConflictDoNothing()
      .returning({ id: coachRuns.attemptId }),
    recordChange(db, {
      entity: "attempt",
      id: attempt.id,
      itemId: attempt.itemId,
      action: "updated",
      actor: { kind: "person", id: actor.id },
    }),
  ]);
  return inserted.length > 0;
}

/**
 * After a write that answered an attempt Partly or Spaghetti: starts the coach and runs it after the response.
 * People only: a signed-in person, or the printer bridge's token (both the attempts and printer scopes); any other
 * agent's answer is not coached.
 */
export async function coachAfterAnswer(
  c: Context<AppEnv>,
  attempt: { id: string; itemId: string; outcome: string | null },
): Promise<void> {
  if (!coached(attempt.outcome) || !coachEnabled(c.env)) return;
  if (c.var.scopes && !(canUse(c, "attempts") && canUse(c, "printer"))) return;
  // The job is made before the answer goes out, so the attempt says "Thinking…" at once; the call runs after it.
  const started = await startCoach(c.var.db, attempt, c.var.user).catch(() => false);
  if (started) {
    // Waits out the quiet time first (the photos and the note usually follow the outcome within seconds). If the
    // attempt is still being worked on by then, the cron takes it up once it has been quiet.
    const wait = Math.min(coachTiming.waitMs, 25_000);
    const baseURL = !!c.env.ANTHROPIC_BASE_URL?.trim();
    c.executionCtx.waitUntil(
      (wait > 0 && !baseURL ? new Promise<void>((resolve) => setTimeout(resolve, wait)) : Promise.resolve())
        .then(() => runCoach(c.env, attempt.id, c.var.db, WAIT_UNTIL_TIMEOUT_MS - wait))
        .catch((error) => console.error("coach failed", error)),
    );
  }
}

async function settle(db: Db, row: CoachRunRow, set: Partial<typeof coachRuns.$inferInsert>) {
  const owner = (await db.select({ id: attempts.createdBy }).from(attempts).where(eq(attempts.id, row.attemptId)).get())
    ?.id;
  await db.batch([
    db
      .update(coachRuns)
      .set({ claimedAt: null, ...set })
      .where(eq(coachRuns.attemptId, row.attemptId)),
    recordChange(db, {
      entity: "attempt",
      id: row.attemptId,
      itemId: row.itemId,
      action: "updated",
      actor: { kind: "person", id: owner ?? "" },
    }),
  ]);
}

/** The last time anyone touched the attempt's answer: its job, the note and answer, or a photo. */
async function lastActivity(db: Db, row: CoachRunRow): Promise<number> {
  const [attempt] = await db.select({ at: attempts.updatedAt }).from(attempts).where(eq(attempts.id, row.attemptId));
  const [photo] = await db
    .select({ at: photos.createdAt })
    .from(photos)
    .where(and(eq(photos.attemptId, row.attemptId), isNull(photos.deletedAt)))
    .orderBy(desc(photos.createdAt))
    .limit(1);
  return Math.max(row.createdAt.getTime(), attempt?.at.getTime() ?? 0, photo?.at.getTime() ?? 0);
}

/** The pictures the coach looks at, from R2; any that is missing or too big is left out. */
async function loadImages(env: Env, found: CoachPhoto[]): Promise<CoachImage[]> {
  const images: CoachImage[] = [];
  for (const photo of found) {
    const object = await env.PHOTOS.get(photoKey(photo.id, "large"));
    const contentType = (object?.httpMetadata?.contentType ?? photo.contentType) as (typeof CONTENT_TYPES)[number];
    if (!object || !CONTENT_TYPES.includes(contentType)) continue;
    if (object.size > Math.min(MAX_IMAGE_BYTES, MAX_READ_BYTES) || photo.width > 8000 || photo.height > 8000) continue;
    images.push({ bytes: new Uint8Array(await object.arrayBuffer()), contentType });
  }
  return images;
}

/**
 * Takes the attempt's coach job and does it: asks Claude and keeps what it suggests. Safe to call from several
 * places at once (the response's waitUntil, the cron): only the one that wins the claim goes on. Never throws, and
 * never touches the attempt itself: what it suggests is only suggested.
 *
 * It waits for the answer to be complete: nothing happens until the attempt has been quiet for `coachTiming.quietMs`.
 * A first run answers the job; a second (the only extra one) takes up what was added after the first, within an hour
 * of the answer, and replaces its suggestions only if it works.
 */
export async function runCoach(
  env: Env,
  attemptId: string,
  db: Db = getDb(env.DB),
  timeoutMs = WAIT_UNTIL_TIMEOUT_MS,
): Promise<void> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return;
  const now = Date.now();
  const current = await db.select().from(coachRuns).where(eq(coachRuns.attemptId, attemptId)).get();
  if (!current) return;
  const again = current.status === "done" || current.status === "nothing";
  if (again && (current.runs !== 1 || now - current.createdAt.getTime() > coachTiming.rerunWindowMs)) return;
  if (!again && current.status !== "thinking") return;
  // Still being answered: not yet (the cron comes back).
  // (A stand-in server, the e2e tests and screenshots, answers at once.)
  const quietMs = env.ANTHROPIC_BASE_URL?.trim() ? 0 : coachTiming.quietMs;
  if (now - (await lastActivity(db, current)) < quietMs) return;
  let notebook = again ? await coachNotebook(db, attemptId, now) : null;
  if (again && (!notebook || !coached(notebook.attempt.outcome) || notebook.basis === current.basis)) return;

  const [row] = await db
    .update(coachRuns)
    .set(
      again
        ? { claimedAt: new Date(now), tries: 1, runs: 2 }
        : { claimedAt: new Date(now), tries: sql`${coachRuns.tries} + 1` },
    )
    .where(
      and(
        eq(coachRuns.attemptId, attemptId),
        again ? inArray(coachRuns.status, ["done", "nothing"]) : eq(coachRuns.status, "thinking"),
        again ? eq(coachRuns.runs, 1) : lt(coachRuns.runs, 2),
        or(isNull(coachRuns.claimedAt), lt(coachRuns.claimedAt, new Date(now - STALE_MS))),
      ),
    )
    .returning();
  if (!row) return;

  notebook ??= await coachNotebook(db, attemptId, now);
  if (!notebook || !coached(notebook.attempt.outcome)) {
    // The second run never loses what the first said: if it can't go on, the job keeps its first answer.
    if (again) return settle(db, row, {});
    return settle(db, row, { status: "skipped", runOutcome: notebook ? "outcome_changed" : "gone" });
  }
  // The day's cap is shared by both people (UTC days: it only has to be about right).
  const since = new Date(now - (now % DAY_MS));
  // A stand-in server (the e2e tests, screenshots and the seed answer for nothing) isn't counted: the cap is for the bill.
  const standIn = !!env.ANTHROPIC_BASE_URL?.trim();
  if (!standIn && (await db.$count(coachRuns, gte(coachRuns.ranAt, since))) >= COACH_PER_DAY) {
    return again ? settle(db, row, {}) : settle(db, row, { status: "failed", runOutcome: "cap" });
  }
  await db
    .update(coachRuns)
    .set({ ranAt: new Date(now), runs: again ? 2 : 1, basis: notebook.basis })
    .where(eq(coachRuns.attemptId, attemptId));
  const answer = await askClaudeToCoach(apiKey, notebook.text, {
    baseURL: env.ANTHROPIC_BASE_URL?.trim(),
    timeoutMs,
    images: await loadImages(env, notebook.photos),
  });
  const { outcome: runOutcome, ...detail } = answer.diagnosis;
  const record = { runOutcome, detail: JSON.stringify(detail) };
  // Too slow for the little time left after the response: the job stays, and the cron takes it up with all the time it needs.
  if (!answer.ok && !again && runOutcome === "timeout" && timeoutMs < CRON_TIMEOUT_MS && row.tries < MAX_TRIES) {
    return settle(db, row, {});
  }
  if (!answer.ok) return again ? settle(db, row, {}) : settle(db, row, { status: "failed", ...record });

  // Only what the printer has, and nothing the attempt already did; a suggestion with nothing to do is dropped.
  const suggestions: Array<Omit<CoachItem, "dismissed">> = [];
  for (const item of answer.suggestions) {
    const settings = sanitizeCoachSettings(item.change, notebook.attempt.settings);
    const note = item.note?.trim() || null;
    if (!settings && !note) continue;
    suggestions.push({
      id: `s${suggestions.length + 1}`,
      title: item.title.trim(),
      why: item.why.trim(),
      settings,
      note,
    });
    if (suggestions.length === COACH_MAX_ITEMS) break;
  }
  // New suggestions have new ids: what was dismissed from the first round no longer applies.
  const fresh = again ? { dismissed: [] } : {};
  if (!suggestions.length) {
    return settle(db, row, { status: "nothing", suggestions: [], ...fresh, ...record, runOutcome: "nothing" });
  }
  await settle(db, row, { status: "done", suggestions, ...fresh, ...record });
}

/** The cron's fallback: coaches nobody is working on any more are picked up, and answers that grew get their one more look. */
export async function resumeCoaches(env: Env, now = Date.now()): Promise<number> {
  if (!coachEnabled(env)) return 0;
  const db = getDb(env.DB);
  const stale = new Date(now - STALE_MS);
  const free = or(isNull(coachRuns.claimedAt), lt(coachRuns.claimedAt, stale));
  const waiting = await db
    .select()
    .from(coachRuns)
    .where(and(eq(coachRuns.status, "thinking"), free))
    .limit(3);
  for (const row of waiting) {
    if (row.tries >= MAX_TRIES) await settle(db, row, { status: "failed", runOutcome: "timeout" });
    else await runCoach(env, row.attemptId, db, CRON_TIMEOUT_MS);
  }
  // Answered and coached once, lately: runCoach checks whether the answer grew (and is quiet) before asking again.
  const answered = await db
    .select()
    .from(coachRuns)
    .where(
      and(
        inArray(coachRuns.status, ["done", "nothing"]),
        eq(coachRuns.runs, 1),
        gte(coachRuns.createdAt, new Date(now - coachTiming.rerunWindowMs)),
        free,
      ),
    )
    .limit(5);
  for (const row of answered) await runCoach(env, row.attemptId, db, CRON_TIMEOUT_MS);
  return waiting.length + answered.length;
}
