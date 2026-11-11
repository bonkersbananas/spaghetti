import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { COACH_MAX_ITEMS, COACH_PER_DAY, type CoachItem, sanitizeCoachSettings } from "../../shared/coach.ts";
import { canUse } from "../auth/scopes.ts";
import { recordChange } from "../changes.ts";
import { type Db, getDb } from "../db/index.ts";
import { attempts, type CoachRunRow, coachRuns } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { askClaudeToCoach } from "./claude.ts";
import { coachNotebook } from "./context.ts";

/** A claim older than this is taken to be gone (the Worker was recycled after the response). */
export const STALE_MS = 4 * 60 * 1000;
const MAX_TRIES = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
export const WAIT_UNTIL_TIMEOUT_MS = 26_000;
const CRON_TIMEOUT_MS = 120_000;

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
    c.executionCtx.waitUntil(
      runCoach(c.env, attempt.id, c.var.db).catch((error) => console.error("coach failed", error)),
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

/**
 * Takes the attempt's coach job and does it: asks Claude and keeps what it suggests. Safe to call from several
 * places at once (the response's waitUntil, the cron): only the one that wins the claim goes on. Never throws, and
 * never touches the attempt itself: what it suggests is only suggested.
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
  const [row] = await db
    .update(coachRuns)
    .set({ claimedAt: new Date(now), tries: sql`${coachRuns.tries} + 1` })
    .where(
      and(
        eq(coachRuns.attemptId, attemptId),
        eq(coachRuns.status, "thinking"),
        or(isNull(coachRuns.claimedAt), lt(coachRuns.claimedAt, new Date(now - STALE_MS))),
      ),
    )
    .returning();
  if (!row) return;

  const notebook = await coachNotebook(db, attemptId, now);
  if (!notebook || !coached(notebook.attempt.outcome)) {
    return settle(db, row, { status: "skipped", runOutcome: notebook ? "outcome_changed" : "gone" });
  }
  // The day's cap is shared by both people (UTC days: it only has to be about right).
  const since = new Date(now - (now % DAY_MS));
  if ((await db.$count(coachRuns, gte(coachRuns.ranAt, since))) >= COACH_PER_DAY) {
    return settle(db, row, { status: "failed", runOutcome: "cap" });
  }
  await db
    .update(coachRuns)
    .set({ ranAt: new Date(now) })
    .where(eq(coachRuns.attemptId, attemptId));
  const answer = await askClaudeToCoach(apiKey, notebook.text, {
    baseURL: env.ANTHROPIC_BASE_URL?.trim(),
    timeoutMs,
  });
  const { outcome: runOutcome, ...detail } = answer.diagnosis;
  const record = { runOutcome, detail: JSON.stringify(detail) };
  if (!answer.ok) return settle(db, row, { status: "failed", ...record });

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
  if (!suggestions.length) return settle(db, row, { status: "nothing", ...record, runOutcome: "nothing" });
  await settle(db, row, { status: "done", suggestions, ...record });
}

/** The cron's fallback: coaches nobody is working on any more are picked up. */
export async function resumeCoaches(env: Env, now = Date.now()): Promise<number> {
  if (!coachEnabled(env)) return 0;
  const db = getDb(env.DB);
  const stale = new Date(now - STALE_MS);
  const waiting = await db
    .select()
    .from(coachRuns)
    .where(and(eq(coachRuns.status, "thinking"), or(isNull(coachRuns.claimedAt), lt(coachRuns.claimedAt, stale))))
    .limit(3);
  for (const row of waiting) {
    if (row.tries >= MAX_TRIES) await settle(db, row, { status: "failed", runOutcome: "timeout" });
    else await runCoach(env, row.attemptId, db, CRON_TIMEOUT_MS);
  }
  return waiting.length;
}
