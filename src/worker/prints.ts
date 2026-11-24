/**
 * Prints the printer bridge files, and where they belong (decision 0076): the candidates the matcher weighs (ideas
 * and builds in progress, their files, what was downloaded or opened in Bambu Studio), the printer's own build that
 * the bridge makes for a print, and what the attempt says about it on the way out (`print`, `moved`).
 */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { AttemptMoved, AttemptPrint } from "../shared/api.ts";
import { byPrintTime } from "../shared/attempts.ts";
import type { ChangeActor } from "../shared/changes.ts";
import {
  type CandidateFile,
  type CandidatePrint,
  type MatchCandidate,
  type PrintFacts,
  placePrint,
  type ScoredCandidate,
  scorePrint,
} from "../shared/print-match.ts";
import { recordChange } from "./changes.ts";
import type { Db } from "./db/index.ts";
import {
  type Attempt,
  agents,
  attemptFiles,
  attemptMoves,
  attempts,
  bridge,
  fileDownloads,
  type Item,
  itemFiles,
  items,
  photos,
  printJobs,
} from "./db/schema.ts";
import { traysFor } from "./print-fill.ts";

const MINUTE = 60_000;
/** A printer's build is fresh, and its print may still go elsewhere, for this long after the bridge made it. */
const FRESH_FOR_MS = 30 * MINUTE;
/** Downloads older than this before a print say nothing about it. */
const SENDS_WITHIN_MS = 24 * 60 * MINUTE;
/** How long downloads are kept: the daily cron forgets older ones. */
export const DOWNLOADS_KEPT_MS = 30 * 24 * 60 * MINUTE;

const chunks = <T>(list: T[], size = 90): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** The printer bridge's agents (`agents.printer`): what they recorded is the printer's, not their owner's. */
export async function printerAgents(db: Db): Promise<Set<string>> {
  const rows = await db.select({ id: agents.id }).from(agents).where(eq(agents.printer, true));
  return new Set(rows.map((row) => row.id));
}

/** SQL: whether the agent in `column` is the printer's. */
export const printerViaSql = (column: string) => `${column} IN (SELECT id FROM agents WHERE printer = 1)`;

/**
 * SQL: the person the attempt row `a` is credited to (shared/attempts.ts `creditedTo`): who logged it, or for a print
 * from the printer whoever a person said started it, else NULL.
 */
export const creditedSql = (a: string) =>
  `COALESCE(${a}.started_by, CASE WHEN ${printerViaSql(`${a}.created_via`)} THEN NULL ELSE ${a}.created_by END)`;

/** SQL: the person the item row `i` is credited to: who captured it, and nobody for a build the printer made. */
export const itemCreditedSql = (i: string) =>
  `CASE WHEN ${printerViaSql(`${i}.created_via`)} THEN NULL ELSE ${i}.created_by END`;

/** Whether this agent is the printer bridge's (the one whose token last said the bridge was there). */
export async function isBridgeAgent(db: Db, via: string): Promise<boolean> {
  const row = await db.select({ id: bridge.id }).from(bridge).where(eq(bridge.agentId, via)).get();
  return !!row;
}

/**
 * A build the bridge made a moment ago for the print it is filing, with nothing in it yet: the print may belong to
 * another build, and this one can go.
 */
export async function isFreshPrinterBuild(db: Db, item: Item, via: string, now: number): Promise<boolean> {
  if (item.createdVia !== via || item.stage !== "building" || item.note.trim()) return false;
  if (now - item.createdAt.getTime() > FRESH_FOR_MS) return false;
  const [attempt, photo, file] = await Promise.all([
    db
      .select({ id: attempts.id })
      .from(attempts)
      .where(and(eq(attempts.itemId, item.id), isNull(attempts.deletedAt)))
      .get(),
    db
      .select({ id: photos.id })
      .from(photos)
      .where(and(eq(photos.itemId, item.id), isNull(photos.deletedAt)))
      .get(),
    db
      .select({ id: itemFiles.id })
      .from(itemFiles)
      .where(and(eq(itemFiles.itemId, item.id), isNull(itemFiles.deletedAt)))
      .get(),
  ]);
  return !attempt && !photo && !file;
}

/** The estimate a file's reading gave, in minutes. */
const estimateOf = (prefill: { estimatedMinutes?: number } | null | undefined) => prefill?.estimatedMinutes ?? null;

/**
 * Every idea and build in progress (but those in `exclude`) as the matcher sees it: its files, kept with it and
 * printed in its attempts, how many attempts it has, and what of it was downloaded in the day before `at`.
 */
export async function loadCandidates(db: Db, exclude: readonly string[], at: number): Promise<MatchCandidate[]> {
  const open = and(isNull(items.deletedAt), inArray(items.stage, ["idea", "building"]));
  const [rows, kept, printed, sends] = await Promise.all([
    db
      .select({ id: items.id, title: items.title, stage: items.stage, startedAt: items.startedAt })
      .from(items)
      .where(open),
    db
      .select({ id: itemFiles.id, itemId: itemFiles.itemId, name: itemFiles.name, prefill: itemFiles.prefill })
      .from(itemFiles)
      .innerJoin(items, eq(items.id, itemFiles.itemId))
      .where(and(open, isNull(itemFiles.deletedAt)))
      .orderBy(desc(itemFiles.createdAt)),
    db
      .select({
        id: attempts.id,
        itemId: attempts.itemId,
        printedAt: attempts.printedAt,
        createdAt: attempts.createdAt,
        fileId: attemptFiles.id,
        fileName: attemptFiles.name,
        prefill: attemptFiles.prefill,
        jobName: printJobs.name,
        jobAsking: printJobs.asking,
        jobItemId: printJobs.itemId,
      })
      .from(attempts)
      .innerJoin(items, eq(items.id, attempts.itemId))
      .leftJoin(attemptFiles, and(eq(attemptFiles.attemptId, attempts.id), isNull(attemptFiles.deletedAt)))
      .leftJoin(printJobs, eq(printJobs.attemptId, attempts.id))
      .where(and(open, isNull(attempts.deletedAt))),
    db
      .select({
        fileId: fileDownloads.fileId,
        itemId: fileDownloads.itemId,
        at: fileDownloads.at,
        how: fileDownloads.how,
      })
      .from(fileDownloads)
      .where(and(gte(fileDownloads.at, new Date(at - SENDS_WITHIN_MS)), lte(fileDownloads.at, new Date(at + MINUTE)))),
  ]);
  const skip = new Set(exclude);
  const candidates = new Map<string, MatchCandidate>();
  for (const row of rows) {
    if (skip.has(row.id)) continue;
    candidates.set(row.id, {
      id: row.id,
      title: row.title,
      stage: row.stage,
      startedAt: row.startedAt?.getTime() ?? null,
      attempts: 0,
      files: [],
      sends: [],
    });
  }
  for (const file of kept) {
    candidates
      .get(file.itemId)
      ?.files.push({ id: file.id, name: file.name, estimatedMinutes: estimateOf(file.prefill) });
  }
  const byItem = new Map<string, typeof printed>();
  for (const row of printed) byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row]);
  for (const [itemId, list] of byItem) {
    const candidate = candidates.get(itemId);
    if (!candidate) continue;
    const ordered = byPrintTime(
      list.map((row) => ({ ...row, printedAt: row.printedAt.getTime(), createdAt: row.createdAt.getTime() })),
    );
    // An attempt with several files comes once for each: attempts are numbered as the build numbers them.
    const numberOf = new Map<string, number>();
    for (const row of ordered) if (!numberOf.has(row.id)) numberOf.set(row.id, numberOf.size + 1);
    candidate.attempts = numberOf.size;
    // The newest attempt's file first: "same file as attempt 3" names the latest print of it.
    const files: CandidateFile[] = [];
    const prints: CandidatePrint[] = [];
    for (const row of ordered) {
      const attempt = numberOf.get(row.id) ?? 0;
      // A print still asking in the printer's own build says nothing yet about what this build is.
      const asking = !!row.jobAsking && row.jobItemId === row.itemId;
      if (asking) candidate.unplaced = true;
      // The name the printer gave it (wherever it was filed first), newest first like the files.
      if (row.jobName && !asking && !prints.some((one) => one.attempt === attempt)) {
        prints.unshift({ name: row.jobName, attempt });
      }
      if (row.fileId && row.fileName) {
        files.unshift({ id: row.fileId, name: row.fileName, estimatedMinutes: estimateOf(row.prefill), attempt });
      }
    }
    candidate.files.push(...files);
    candidate.prints = prints;
  }
  for (const send of sends) {
    candidates.get(send.itemId)?.sends.push({ fileId: send.fileId, at: send.at.getTime(), how: send.how });
  }
  return [...candidates.values()];
}

/**
 * What the app knows of an attempt's print: what the bridge said when it filed it, else the name of its file or of
 * its build (a printer's build is named after the print), and when it was printed.
 */
export async function printFactsOf(db: Db, attempt: Attempt): Promise<PrintFacts> {
  const [job, file, item] = await Promise.all([
    db.select().from(printJobs).where(eq(printJobs.attemptId, attempt.id)).get(),
    db
      .select({ name: attemptFiles.name })
      .from(attemptFiles)
      .where(and(eq(attemptFiles.attemptId, attempt.id), isNull(attemptFiles.deletedAt)))
      .get(),
    db.select({ title: items.title }).from(items).where(eq(items.id, attempt.itemId)).get(),
  ]);
  return {
    name: job?.name ?? file?.name ?? item?.title ?? null,
    startedAt: attempt.printedAt.getTime(),
    estimateMinutes: job?.estimateMinutes ?? null,
    fileId: job?.fileId ?? null,
  };
}

/** The build a merged one went into, following a chain (a print moved twice): null when it wasn't merged. */
export async function mergedTarget(db: Db, itemId: string): Promise<string | null> {
  const seen = new Set([itemId]);
  let id = itemId;
  for (let hop = 0; hop < 5; hop++) {
    const row = await db
      .select({ mergedInto: items.mergedInto, deletedAt: items.deletedAt })
      .from(items)
      .where(eq(items.id, id))
      .get();
    // A live build at the end of the chain; a missing one, or one deleted for good reasons of its own, is a dead end.
    if (!row) return null;
    if (!row.deletedAt) return hop ? id : null;
    if (!row.mergedInto || seen.has(row.mergedInto)) return null;
    seen.add(row.mergedInto);
    id = row.mergedInto;
  }
  return null;
}

/**
 * Where the print the printer bridge (`via`) filed in its own build `itemId` is now: the attempt and the build it is
 * in, wherever the app or someone moved it since. Released bridges (0.1.3, 0.1.4) keep calling their own build: they
 * end a print by looking for its attempt there, send its photo there and retry its start there.
 */
export async function printNowIn(
  db: Db,
  itemId: string,
  via: string | null,
): Promise<{ attemptId: string; itemId: string } | null> {
  if (!via) return null;
  const row = await db
    .select({ attemptId: attempts.id, itemId: attempts.itemId })
    .from(printJobs)
    .innerJoin(attempts, eq(attempts.id, printJobs.attemptId))
    .innerJoin(items, eq(items.id, attempts.itemId))
    .where(
      and(
        sql`coalesce(${printJobs.ownItemId}, ${printJobs.itemId}) = ${itemId}`,
        eq(attempts.createdVia, via),
        isNull(attempts.deletedAt),
        isNull(items.deletedAt),
      ),
    )
    .get();
  return row ?? null;
}

/** What each attempt says about its print and its last move (`Attempt.print`, `Attempt.moved`). */
export async function printViews(
  db: Db,
  rows: ReadonlyArray<Pick<Attempt, "id" | "itemId" | "createdVia">>,
): Promise<Map<string, PrintView>> {
  const views = new Map<string, PrintView>();
  if (!rows.length) return views;
  const ids = rows.map((row) => row.id);
  const [printer, jobs, moves] = await Promise.all([
    printerAgents(db),
    Promise.all(chunks(ids).map((slice) => db.select().from(printJobs).where(inArray(printJobs.attemptId, slice)))),
    Promise.all(
      chunks(ids).map((slice) =>
        db
          .select()
          .from(attemptMoves)
          .where(inArray(attemptMoves.attemptId, slice))
          .orderBy(desc(attemptMoves.movedAt)),
      ),
    ),
  ]);
  const jobOf = new Map(jobs.flat().map((job) => [job.attemptId, job]));
  const moveOf = new Map<string, (typeof moves)[number][number]>();
  for (const move of moves.flat()) if (!moveOf.has(move.attemptId)) moveOf.set(move.attemptId, move);
  for (const row of rows) {
    const job = jobOf.get(row.id);
    const move = moveOf.get(row.id);
    // The reasons and the question hold only while it is in the build the printer put it in.
    const here = job?.itemId === row.itemId;
    views.set(row.id, {
      fromPrinter: !!row.createdVia && printer.has(row.createdVia),
      print: job
        ? {
            name: job.name,
            placed: job.placed,
            reasons: here && job.placed === "matched" ? job.reasons : [],
            asking: here && job.asking,
            ownItemId: ownBuildOf(job),
            ownTitle: job.ownTitle,
          }
        : null,
      moved:
        move && move.toItemId === row.itemId
          ? {
              fromItemId: move.fromItemId,
              fromTitle: move.fromTitle,
              by: move.movedBy,
              via: move.movedVia,
              at: move.movedAt.getTime(),
            }
          : null,
    });
  }
  return views;
}

/** The printer's own build for a print: where a new one was placed, or (matched) the one it made and merged away. */
export const ownBuildOf = (job: { ownItemId: string | null; itemId: string }) => job.ownItemId ?? job.itemId;

/** What an attempt says on its way out about the printer: whether it is the printer's, how it was placed, its move. */
export interface PrintView {
  fromPrinter: boolean;
  print: AttemptPrint | null;
  moved: AttemptMoved | null;
}

/** Adds `fromPrinter`, `print` and `moved` to attempts on their way out. */
export function withPrintViews<T extends { id: string }>(
  list: T[],
  views: Map<string, PrintView>,
): Array<T & PrintView> {
  return list.map((attempt) => ({
    ...attempt,
    fromPrinter: views.get(attempt.id)?.fromPrinter ?? false,
    print: views.get(attempt.id)?.print ?? null,
    moved: views.get(attempt.id)?.moved ?? null,
  }));
}

/** The latest of an attempt's moves that left it where it is (the one its undo takes back). */
export function latestMove(db: Db, attemptId: string) {
  return db
    .select()
    .from(attemptMoves)
    .where(eq(attemptMoves.attemptId, attemptId))
    .orderBy(desc(attemptMoves.movedAt), sql`rowid desc`)
    .get();
}

/** What the bridge sends about a print with its attempt (`CreateAttemptRequest.print`). */
export interface PrintFactsBody {
  name?: string | null;
  gcodeFile?: string | null;
  plate?: number | null;
  estimateMinutes?: number | null;
  fileId?: string | null;
  trays?: string[] | null;
}

/**
 * The printer bridge filing a print in the build it just made for it (decision 0076): the app looks for the build it
 * belongs to. A match takes the attempt instead, and the printer's build goes (merged into it, so the bridge still
 * finds its print); otherwise the print stays in its own build, which asks "which build is this?". Null when this
 * isn't such a filing: a person, another agent, or a build that is more than the bridge's fresh one.
 */
export async function fileThePrint(
  db: Db,
  via: string | null,
  item: Item,
  print: PrintFactsBody | undefined,
  printedAt: number,
  now: Date,
) {
  // Only the printer bridge's own print: another agent sending print facts files its attempt where it says.
  if (!via || !(await isBridgeAgent(db, via))) return null;
  if (!(await isFreshPrinterBuild(db, item, via, now.getTime()))) return null;
  const facts: PrintFacts = {
    name: print?.name ?? item.title,
    startedAt: printedAt,
    estimateMinutes: print?.estimateMinutes ?? null,
    fileId: print?.fileId ?? null,
  };
  const candidates = await loadCandidates(db, [item.id], facts.startedAt);
  const unplaced = new Set(candidates.filter((one) => one.unplaced).map((one) => one.id));
  const placement = placePrint(scorePrint(facts, candidates), unplaced);
  const target =
    placement.kind === "match"
      ? await db
          .select()
          .from(items)
          .where(and(eq(items.id, placement.best.itemId), isNull(items.deletedAt)))
          .get()
      : undefined;
  const job = {
    trays: await traysFor(db, print?.trays),
    name: facts.name,
    gcodeFile: print?.gcodeFile ?? null,
    plate: print?.plate ?? null,
    estimateMinutes: facts.estimateMinutes ? Math.round(facts.estimateMinutes) : null,
    fileId: facts.fileId ?? null,
    createdAt: now,
  };
  return {
    /** The matcher couldn't place it: the print asks, and Claude may be asked for a second opinion (decision 0080). */
    unsure: placement.kind !== "match" || !target,
    /** Where the attempt goes: the build it matched, or the printer's own. */
    target: target ?? item,
    /** What goes in the batch after the attempt's insert. */
    statements: (attemptId: string, actor: ChangeActor) =>
      target && placement.kind === "match"
        ? [
            db
              .update(items)
              .set({ deletedAt: now, mergedInto: target.id })
              .where(and(eq(items.id, item.id), isNull(items.deletedAt))),
            recordChange(db, { entity: "item", id: item.id, itemId: item.id, action: "deleted", actor }),
            db
              .insert(printJobs)
              .values({
                ...job,
                attemptId,
                placed: "matched",
                reasons: placement.best.reasons,
                itemId: target.id,
                ownItemId: item.id,
                ownTitle: item.title,
                asking: false,
                // The attempt's insert starts an idea it matched: "Not this build?" makes it an idea again, in its
                // place in Up next.
                startedIdea: target.stage === "idea",
                ideaUpNext: target.stage === "idea" ? target.upNext : null,
              })
              .onConflictDoNothing(),
          ]
        : [
            db
              .insert(printJobs)
              .values({
                ...job,
                attemptId,
                placed: "new",
                reasons: [],
                itemId: item.id,
                ownTitle: item.title,
                asking: true,
              })
              .onConflictDoNothing(),
          ],
  };
}

/** The daily cron: downloads older than a month say nothing about any print to come. */
export async function pruneDownloads(db: Db, now = Date.now()) {
  await db.delete(fileDownloads).where(lte(fileDownloads.at, new Date(now - DOWNLOADS_KEPT_MS)));
}
