import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { OUTCOME_LABELS, tagLabel } from "../../shared/attempts.ts";
import { settingsMaterial } from "../../shared/recipes.ts";
import { describeSettings } from "../../shared/story.ts";
import { addWeeks, mondayOf, type Week, weekIsReadyToWrite, weekRangeLabel } from "../../shared/week.ts";
import { type Db, getDb } from "../db/index.ts";
import { attempts, items, users, weeks } from "../db/schema.ts";
import { askClaudeForWeek } from "./claude.ts";
import { loadWeek, WEEK_CLAIM_STALE_MS } from "./load.ts";

/** Paragraphs written a day, for both people (UTC days: the cap is for the bill, it only has to be about right). */
export const WEEK_NOTES_PER_DAY = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TRIES = 2;
export const WEEK_WAIT_UNTIL_TIMEOUT_MS = 26_000;

/** The text Claude reads: the week's figures and its prints in the notebook's own words. Never a photo. */
export async function weekNotebook(db: Db, week: Week): Promise<string> {
  const names = new Map((await db.select({ id: users.id, name: users.name }).from(users)).map((u) => [u.id, u.name]));
  const who = (id: string) => names.get(id) ?? "Someone";
  const rows = await db
    .select({ attempt: attempts, title: items.title })
    .from(attempts)
    .innerJoin(items, eq(items.id, attempts.itemId))
    .where(
      and(
        isNull(attempts.deletedAt),
        isNull(items.deletedAt),
        gte(attempts.printedAt, new Date(week.start)),
        lt(attempts.printedAt, new Date(week.end)),
      ),
    )
    .orderBy(attempts.printedAt);
  const lines = [`The week: ${weekRangeLabel(week.monday)} (Monday to Sunday).`];
  const { prints } = week;
  lines.push(
    `Prints: ${prints.total} (${prints.worked} worked, ${prints.partly} partly, ${prints.spaghetti} spaghetti, ${prints.printing} still on the bed).`,
  );
  if (week.grams !== null) lines.push(`Filament used: about ${week.grams} g.`);
  if (rows.length) lines.push("", "## Prints, oldest first");
  for (const { attempt, title } of rows) {
    const material = settingsMaterial(attempt.settings);
    lines.push(
      `- ${title?.trim() || "untitled"}, by ${who(attempt.createdBy)}: ${attempt.outcome ? OUTCOME_LABELS[attempt.outcome] : "still printing"}.`,
    );
    if (material) lines.push(`  Material: ${material}.`);
    const settings = describeSettings(attempt.settings);
    if (settings.length) lines.push(`  Settings: ${settings.join(", ")}.`);
    if (attempt.failureTags.length) {
      lines.push(`  Went wrong: ${attempt.failureTags.map((slug) => tagLabel("failure", slug)).join(", ")}.`);
    }
    if (attempt.successNotes.length) {
      lines.push(`  Went well: ${attempt.successNotes.map((slug) => tagLabel("success", slug)).join(", ")}.`);
    }
    if (attempt.note.trim()) lines.push(`  Their note: ${attempt.note.trim().slice(0, 240)}`);
  }
  if (week.buildsFinished.length) {
    lines.push("", `Builds finished: ${week.buildsFinished.map((b) => b.title?.trim() || "untitled").join(", ")}.`);
  }
  if (week.ideas.length) {
    lines.push(
      "",
      `Ideas captured: ${week.ideas.map((idea) => `${idea.title?.trim() || idea.note || "untitled"} (${who(idea.by)})`).join("; ")}.`,
    );
  }
  if (week.comments.total) {
    lines.push("", `Comments between them: ${week.comments.total}, about ${week.comments.threads.length} thing(s).`);
  }
  return lines.join("\n");
}

type Settled = "done" | "nothing" | "failed" | "skipped";

/**
 * Takes the week's job, or says there is nothing to do: only for a week that is over or on its Sunday evening, only
 * for last week and this one (paging back through old weeks never spends the key), only with the key, and only once
 * (a claim that went quiet is taken over once more). The claim is made before the response goes out, so the page can
 * say "Looking back at the week…" at once.
 */
export async function claimWeekNote(env: Env, monday: string, now: number, db: Db): Promise<boolean> {
  if (!env.ANTHROPIC_API_KEY?.trim()) return false;
  if (!weekIsReadyToWrite(monday, now) || monday < addWeeks(mondayOf(now), -1)) return false;
  const made = await db
    .insert(weeks)
    .values({ monday, status: "thinking", claimedAt: new Date(now), tries: 1, createdAt: new Date(now) })
    .onConflictDoNothing()
    .returning({ monday: weeks.monday });
  if (made.length) return true;
  const retaken = await db
    .update(weeks)
    .set({ claimedAt: new Date(now), tries: sql`${weeks.tries} + 1` })
    .where(
      and(
        eq(weeks.monday, monday),
        eq(weeks.status, "thinking"),
        lt(weeks.tries, MAX_TRIES),
        or(isNull(weeks.claimedAt), lt(weeks.claimedAt, new Date(now - WEEK_CLAIM_STALE_MS))),
      ),
    )
    .returning({ monday: weeks.monday });
  return retaken.length > 0;
}

/**
 * Does a claimed week's job: asks Claude and keeps what it says. Never throws, and never changes anything but the
 * `weeks` row.
 */
export async function runWeekNote(
  env: Env,
  monday: string,
  options: { now?: number; db?: Db; timeoutMs?: number } = {},
): Promise<Exclude<Settled, "skipped">> {
  const { now = Date.now(), db = getDb(env.DB), timeoutMs = WEEK_WAIT_UNTIL_TIMEOUT_MS } = options;
  const apiKey = env.ANTHROPIC_API_KEY?.trim() ?? "";
  const settle = async (status: Exclude<Settled, "skipped">, set: Partial<typeof weeks.$inferInsert>) => {
    await db
      .update(weeks)
      .set({ status, claimedAt: null, ...set })
      .where(eq(weeks.monday, monday));
    return status;
  };
  try {
    const week = await loadWeek(env, monday, now, db);
    if (week.empty) {
      // Nothing to read, and nothing kept: a print added to the week later (backdated) can still get its paragraph.
      await db.delete(weeks).where(eq(weeks.monday, monday));
      return "nothing";
    }
    // A stand-in server (the e2e tests, screenshots) isn't counted: the cap is for the bill.
    const standIn = !!env.ANTHROPIC_BASE_URL?.trim();
    const since = new Date(now - (now % DAY_MS));
    if (!standIn && (await db.$count(weeks, gte(weeks.ranAt, since))) >= WEEK_NOTES_PER_DAY) {
      return await settle("failed", { runOutcome: "cap" });
    }
    await db
      .update(weeks)
      .set({ ranAt: new Date(now) })
      .where(eq(weeks.monday, monday));
    const answer = await askClaudeForWeek(apiKey, await weekNotebook(db, week), {
      baseURL: env.ANTHROPIC_BASE_URL?.trim(),
      timeoutMs,
    });
    const { outcome: runOutcome, ...detail } = answer.diagnosis;
    const record = { runOutcome, detail: JSON.stringify(detail) };
    if (!answer.ok) return await settle("failed", record);
    if (!answer.note) return await settle("nothing", record);
    return await settle("done", { text: answer.note, ...record });
  } catch (error) {
    console.error("week note failed", error);
    return settle("failed", { runOutcome: "exception" }).catch(() => "failed" as const);
  }
}

/** Claims and writes in one go (the Sunday push, which waits for it). */
export async function writeWeekNote(
  env: Env,
  monday: string,
  options: { now?: number; db?: Db; timeoutMs?: number } = {},
): Promise<Settled> {
  const { now = Date.now(), db = getDb(env.DB) } = options;
  if (!(await claimWeekNote(env, monday, now, db))) return "skipped";
  return runWeekNote(env, monday, { ...options, now, db });
}
