/**
 * Claude's second opinion on a print the matcher couldn't place (decision 0080): asked once, after the bridge's filing
 * is answered, with the print's facts and the builds and ideas it may be. Its pick only leads the "Is this…?"
 * question (`withClaudesPick`); the print stays nobody's until a person says Yes (decision 0076). It never throws, and
 * without a key, past the day's cap or when the call fails, nothing changes: the matcher's suggestions stand.
 */
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import type { Context } from "hono";
import {
  MAX_SUGGESTIONS,
  type MatchCandidate,
  rowWords,
  type ScoredCandidate,
  SUGGEST_SCORE,
  scorePrint,
  shownName,
} from "../../shared/print-match.ts";
import { WORKSPACE_TIME_ZONE } from "../../shared/week.ts";
import { recordChange } from "../changes.ts";
import { type Db, getDb } from "../db/index.ts";
import { attempts, items, printJobs, printMatchRuns, spools } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { loadCandidates } from "../prints.ts";
import { askClaudeForBuild, type CandidateToShow } from "./claude.ts";

/** Per day, for the whole workspace: a printer prints a handful a day, and most of them the matcher places. */
export const PRINT_MATCHES_PER_DAY = 30;
/** After the response, `waitUntil` has about 30 seconds: the call is given a little less than that. */
export const WAIT_UNTIL_TIMEOUT_MS = 26_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE = 60_000;
/** At most this many builds and ideas are shown: those the matcher found something for, then the latest touched. */
const MAX_SHOWN = 30;
const MAX_NAMES = 8;

/** The feature exists only where the key is set. */
export const printMatchEnabled = (env: Pick<Env, "ANTHROPIC_API_KEY">) => !!env.ANTHROPIC_API_KEY?.trim();

/** After the bridge filed a print the matcher couldn't place: Claude is asked after the response. */
export function matchAfterFiling(c: Context<AppEnv>, attemptId: string): void {
  if (!printMatchEnabled(c.env)) return;
  try {
    c.executionCtx.waitUntil(
      runPrintMatch(c.env, attemptId, c.var.db).catch((error) =>
        console.error("asking Claude about a print failed", error),
      ),
    );
  } catch {
    // No execution context (a test calling the app directly): nothing is asked.
  }
}

/** "3 min", "2 h", "4 days": how long before the print. */
function ago(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE));
  if (minutes < 60) return `${minutes} min before the print`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h before the print`;
  return `${Math.round(hours / 24)} days before the print`;
}

const clock = (at: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: WORKSPACE_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(at));

/** "PLA Navy Blue (Clas Ohlson)": what a spool is, in a few words. */
const spoolWords = (spool: { material: string; colorName: string | null; brand: string | null }) =>
  [spool.material, spool.colorName].filter(Boolean).join(" ") + (spool.brand ? ` (${spool.brand})` : "");

/** The builds and ideas Claude is shown: those the matcher found something for first, then builds, then ideas, latest touched first. */
function pickShown(
  candidates: MatchCandidate[],
  scored: ScoredCandidate[],
  touched: Map<string, number>,
): MatchCandidate[] {
  const byId = new Map(candidates.map((one) => [one.id, one]));
  const shown: MatchCandidate[] = [];
  const add = (one: MatchCandidate | undefined) => {
    if (one && shown.length < MAX_SHOWN && !shown.includes(one)) shown.push(one);
  };
  for (const one of scored) add(byId.get(one.itemId));
  const latest = (list: MatchCandidate[]) =>
    [...list].sort((a, b) => (touched.get(b.id) ?? 0) - (touched.get(a.id) ?? 0));
  for (const one of latest(candidates.filter((one) => one.stage === "building"))) add(one);
  for (const one of latest(candidates.filter((one) => one.stage === "idea"))) add(one);
  return shown;
}

/**
 * Asks Claude about this print, once: only while it is still in the printer's own build asking which build it is.
 * The run's row is the "once": a second call finds it there and does nothing.
 */
export async function runPrintMatch(
  env: Env,
  attemptId: string,
  db: Db = getDb(env.DB),
  timeoutMs = WAIT_UNTIL_TIMEOUT_MS,
): Promise<void> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return;
  const found = await db
    .select({ attempt: attempts, job: printJobs })
    .from(printJobs)
    .innerJoin(attempts, eq(attempts.id, printJobs.attemptId))
    .where(and(eq(printJobs.attemptId, attemptId), isNull(attempts.deletedAt)))
    .get();
  // Someone answered already, or it was moved: nothing to ask.
  if (!found?.job.asking || found.job.itemId !== found.attempt.itemId) return;
  const { attempt, job } = found;
  // Nothing to go on, and nothing would show: the question offers no build for a print without a name or a mark.
  if (!job.name && !job.fileId) return;
  const now = Date.now();

  // The day's cap is shared by both people (UTC days: it only has to be about right).
  const since = new Date(now - (now % DAY_MS));
  const capped = (await db.$count(printMatchRuns, gte(printMatchRuns.ranAt, since))) >= PRINT_MATCHES_PER_DAY;
  const startedAt = attempt.printedAt.getTime();
  const candidates = capped ? [] : await loadCandidates(db, [attempt.itemId], startedAt);
  const scored = scorePrint(
    { name: job.name, startedAt, estimateMinutes: job.estimateMinutes, fileId: job.fileId },
    candidates,
  );
  const touchedRows = candidates.length
    ? await db
        .select({ id: items.id, updatedAt: items.updatedAt })
        .from(items)
        .where(inArray(items.id, candidates.map((one) => one.id).slice(0, 500)))
    : [];
  const touched = new Map(touchedRows.map((row) => [row.id, row.updatedAt.getTime()]));
  const shown = pickShown(candidates, scored, touched);

  const [claimed] = await db
    .insert(printMatchRuns)
    .values({
      attemptId,
      status: capped ? "cap" : shown.length ? "asking" : "none",
      candidateIds: shown.map((one) => one.id),
      createdAt: new Date(now),
      ranAt: capped || !shown.length ? null : new Date(now),
      runOutcome: capped ? "cap" : shown.length ? null : "no_candidates",
    })
    .onConflictDoNothing()
    .returning({ id: printMatchRuns.attemptId });
  if (!claimed || capped || !shown.length) return;

  const trayIds = (job.trays ?? []).flatMap((tray) => (tray.spoolId ? [tray.spoolId] : []));
  const trays = trayIds.length
    ? await db
        .select({ material: spools.material, colorName: spools.colorName, brand: spools.brand })
        .from(spools)
        .where(inArray(spools.id, trayIds))
    : [];
  const scoreOf = new Map(scored.map((one) => [one.itemId, one]));
  const shownToClaude: CandidateToShow[] = shown.map((one, index) => ({
    key: `c${index + 1}`,
    title: one.title,
    stage: one.stage === "idea" ? "idea" : "building",
    files: one.files.slice(0, MAX_NAMES).map((file) => shownName(file.name)),
    prints: (one.prints ?? []).slice(0, MAX_NAMES).map((print) => print.name),
    attempts: one.attempts,
    lastActivity: ago(startedAt - (touched.get(one.id) ?? startedAt)),
    sent: one.sends
      .filter((send) => send.at <= startedAt + MINUTE)
      .sort((a, b) => b.at - a.at)
      .slice(0, 3)
      .flatMap((send) => {
        const file = one.files.find((candidate) => candidate.id === send.fileId);
        if (!file) return [];
        const how = send.how === "studio" ? "opened in Bambu Studio" : "downloaded";
        return [`${shownName(file.name)} ${how} ${ago(startedAt - send.at)}`];
      }),
    matcher: scoreOf.get(one.id)?.reasons.length ? rowWords(scoreOf.get(one.id)?.reasons ?? []) : null,
  }));

  const answer = await askClaudeForBuild(
    apiKey,
    {
      name: job.name,
      plate: job.plate,
      filaments: trays.map(spoolWords),
      estimateMinutes: job.estimateMinutes,
      startedAt: clock(startedAt),
    },
    shownToClaude,
    { baseURL: env.ANTHROPIC_BASE_URL?.trim() || undefined, timeoutMs },
  );
  const { outcome: runOutcome, ...detail } = answer.diagnosis;
  const record = { runOutcome, detail: JSON.stringify(detail) };
  if (!answer.ok) {
    await db
      .update(printMatchRuns)
      .set({ status: answer.none ? "none" : "failed", ...record })
      .where(eq(printMatchRuns.attemptId, attemptId));
    return;
  }
  const picked = shown[shownToClaude.findIndex((one) => one.key === answer.key)];
  await db.batch([
    db
      .update(printMatchRuns)
      .set({ status: "picked", itemId: picked?.id ?? null, reason: answer.reason || null, ...record })
      .where(eq(printMatchRuns.attemptId, attemptId)),
    // The screens asking about this print hear of it and ask again, Claude's pick first.
    recordChange(db, {
      entity: "attempt",
      id: attemptId,
      itemId: attempt.itemId,
      action: "updated",
      actor: { kind: "agent", id: "claude" },
    }),
  ]);
}

/**
 * The suggestions for a print with Claude's pick first, when Claude picked one of the builds still open: its reason
 * leads its own (the matcher's), and the rest follow as the matcher ranked them, up to the usual three.
 */
export async function withClaudesPick(
  db: Db,
  attemptId: string,
  candidates: readonly MatchCandidate[],
  scored: readonly ScoredCandidate[],
): Promise<ScoredCandidate[]> {
  const offered = scored.filter((one) => one.score >= SUGGEST_SCORE).slice(0, MAX_SUGGESTIONS);
  const run = await db
    .select({ status: printMatchRuns.status, itemId: printMatchRuns.itemId, reason: printMatchRuns.reason })
    .from(printMatchRuns)
    .where(eq(printMatchRuns.attemptId, attemptId))
    .get();
  const pickedId = run?.status === "picked" ? run.itemId : null;
  if (!pickedId || !candidates.some((one) => one.id === pickedId)) return offered;
  const its = scored.find((one) => one.itemId === pickedId);
  const first: ScoredCandidate = {
    itemId: pickedId,
    score: its?.score ?? 0,
    reasons: [{ kind: "claude", why: run?.reason || "it fits best" }, ...(its?.reasons ?? [])],
  };
  return [first, ...offered.filter((one) => one.itemId !== pickedId)].slice(0, MAX_SUGGESTIONS);
}
