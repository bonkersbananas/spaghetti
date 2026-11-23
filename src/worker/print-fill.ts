/**
 * What a printer-made attempt lacks once it is in a build: the printer says only that a print ran, so the attempt
 * starts with no material, colour or settings. When the print is placed (matched at its start, or put there by a
 * person later), this fills in only what is empty (never what a person or an agent set; the rule agents' files
 * follow, decision 0078) from, in turn:
 *
 * 1. the sliced file it matched: the build's file (kept with it or printed in one of its attempts) that the job is
 *    named after, on the plate printed (when the plate is unknown and the file has several, none: they differ);
 * 2. else, for an attempt with no settings of its own, the build's latest attempt that has settings, as "same as
 *    last time" carries them;
 * 3. the spools the printer's active trays held while the print ran (an old bridge sends none), only on filaments
 *    this fill put in, or where there are none: a filament a person or agent set is theirs.
 *
 * What a fill put in is remembered (`print_jobs.filled`), so that when the print is placed elsewhere ("Not this
 * build?") what the earlier fill put in goes and the new place fills afresh: a value still as the fill left it is
 * taken out, one changed since is someone's and stays.
 */
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { type AttemptFilament, type AttemptSettings, byPrintTime, carryOver, RESULT_KEYS } from "../shared/attempts.ts";
import type { ChangeActor } from "../shared/changes.ts";
import { printKey } from "../shared/print-match.ts";
import { filamentFromSpool } from "../shared/spools.ts";
import { recordChange } from "./changes.ts";
import type { Db } from "./db/index.ts";
import { type Attempt, amsSlots, attemptFiles, attempts, itemFiles, printJobs, spools } from "./db/schema.ts";

/** A tray of the printer and the spool the pantry had in it when the print began. */
export interface PrintTray {
  slot: string;
  spoolId: string | null;
}

const hasChoices = (settings: AttemptSettings) =>
  Object.keys(settings).some((key) => !(RESULT_KEYS as readonly string[]).includes(key));

/** The spools in the slots the bridge named, as the pantry has them now (only slots with a live spool). */
export async function traysFor(db: Db, slots: readonly string[] | null | undefined): Promise<PrintTray[]> {
  const wanted = [...new Set((slots ?? []).filter((slot) => /^([A-D][1-4]|Ext)$/.test(slot)))].slice(0, 16);
  if (!wanted.length) return [];
  const rows = await db
    .select({ slot: amsSlots.slot, spoolId: spools.id })
    .from(amsSlots)
    .innerJoin(spools, eq(spools.id, amsSlots.spoolId))
    .where(isNull(spools.deletedAt));
  const bySlot = new Map(rows.map((row) => [row.slot, row.spoolId]));
  return wanted.map((slot) => ({ slot, spoolId: bySlot.get(slot) ?? null }));
}

/** The settings the print's sliced file gives, when the build holds one the job is named after. */
async function fromFile(
  db: Db,
  attempt: Attempt,
  job: { name: string | null; plate: number | null; fileId: string | null },
): Promise<AttemptSettings | null> {
  const columns = (table: typeof itemFiles | typeof attemptFiles) => ({
    id: table.id,
    name: table.name,
    plate: table.plate,
    plateCount: table.plateCount,
    prefill: table.prefill,
  });
  const [kept, printed] = await Promise.all([
    db
      .select(columns(itemFiles))
      .from(itemFiles)
      .where(and(eq(itemFiles.itemId, attempt.itemId), isNull(itemFiles.deletedAt)))
      .orderBy(desc(itemFiles.createdAt)),
    db
      .select(columns(attemptFiles))
      .from(attemptFiles)
      .innerJoin(attempts, eq(attempts.id, attemptFiles.attemptId))
      .where(
        and(
          eq(attempts.itemId, attempt.itemId),
          ne(attempts.id, attempt.id),
          isNull(attempts.deletedAt),
          isNull(attemptFiles.deletedAt),
        ),
      )
      .orderBy(desc(attemptFiles.createdAt)),
  ]);
  const files = [...kept, ...printed].filter((file) => hasChoices(file.prefill));
  const key = printKey(job.name);
  const byId = job.fileId ? files.find((file) => file.id === job.fileId) : undefined;
  // With no plate named (bridges before 0.2), a file of several plates can't say which one was printed.
  const byName = key
    ? files.filter(
        (file) => printKey(file.name) === key && (job.plate ? file.plate === job.plate : file.plateCount <= 1),
      )
    : [];
  return (byId ?? byName[0])?.prefill ?? null;
}

/** The settings of the build's latest other attempt that has any, as the next attempt would start from them. */
async function fromLastAttempt(db: Db, attempt: Attempt): Promise<AttemptSettings | null> {
  const rows = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.itemId, attempt.itemId), ne(attempts.id, attempt.id), isNull(attempts.deletedAt)));
  const ordered = byPrintTime(
    rows.map((row) => ({ row, id: row.id, printedAt: row.printedAt.getTime(), createdAt: row.createdAt.getTime() })),
  );
  for (const { row } of ordered.reverse()) {
    const settings = carryOver(row.settings);
    if (hasChoices(settings)) return settings;
  }
  return null;
}

/** The stored colours (JSON) of a multi-colour spool, as a list. */
function colorsOf(stored: string | null): string[] | null {
  try {
    const list: unknown = stored ? JSON.parse(stored) : null;
    return Array.isArray(list) && list.every((one) => typeof one === "string") ? list : null;
  } catch {
    return null;
  }
}

type SpoolInTray = Omit<typeof spools.$inferSelect, "colors"> & { colors: string[] | null; slot: string };

/** The fill's filaments with the trays' spools on them, one by one (several trays only when the numbers agree). */
function withTrays(filaments: readonly AttemptFilament[], found: readonly SpoolInTray[]): AttemptFilament[] | null {
  if (!found.length) return null;
  if (filaments.length > 1 && filaments.length !== found.length) return null;
  const bare = filaments.map(({ spoolId: _spool, amsSlot: _slot, ...filament }) => filament);
  return (bare.length ? bare : [{}]).map((filament, index) => {
    const spool = found[index];
    return spool ? filamentFromSpool(spool, filament) : filament;
  });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Fills a printer-made attempt's empty settings and filaments from where it is now, after taking out what an
 * earlier fill put in (where it is still as the fill left it). Does nothing for an attempt the printer didn't file
 * (no print job), and never replaces a value that is there. Returns whether it changed anything.
 */
export async function fillPrinterAttempt(db: Db, attemptId: string, actor: ChangeActor): Promise<boolean> {
  const [attempt, job] = await Promise.all([
    db.select().from(attempts).where(eq(attempts.id, attemptId)).get(),
    db.select().from(printJobs).where(eq(printJobs.attemptId, attemptId)).get(),
  ]);
  if (!attempt || attempt.deletedAt || !job) return false;
  const settings: Record<string, unknown> = { ...attempt.settings };
  const before = job.filled ?? {};
  for (const [key, value] of Object.entries(before)) if (same(settings[key], value)) delete settings[key];

  const added: Record<string, unknown> = {};
  const source =
    (await fromFile(db, attempt, job)) ??
    // Settings the bridge sent are its own file's, complete: the last attempt's would only mix in keys the file never
    // has (a tree support beside supportEnabled false).
    (job.ownSettings && hasChoices(settings as AttemptSettings) ? null : await fromLastAttempt(db, attempt));
  for (const [key, value] of Object.entries(source ?? {})) {
    if (value === undefined || settings[key] !== undefined) continue;
    settings[key] = value;
    added[key] = value;
  }

  const trays = job.trays ?? [];
  // Only filaments this fill put in, or none at all: a filament someone set is theirs.
  if (
    trays.length &&
    trays.every((tray) => tray.spoolId) &&
    (settings.filaments === undefined || settings.filaments === added.filaments)
  ) {
    const rows = await db.select().from(spools).where(isNull(spools.deletedAt));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const found = trays.flatMap((tray) => {
      const row = tray.spoolId ? byId.get(tray.spoolId) : undefined;
      return row ? [{ ...row, colors: colorsOf(row.colors), slot: tray.slot }] : [];
    });
    // A spool gone since leaves a tray unknown: then nothing is guessed.
    const filaments =
      found.length === trays.length ? withTrays((added.filaments as AttemptFilament[]) ?? [], found) : null;
    if (filaments) {
      settings.filaments = filaments;
      added.filaments = filaments;
    }
  }

  if (same(settings, attempt.settings) && same(added, before)) return false;
  const now = new Date();
  const [changed] = await db.batch([
    db
      .update(attempts)
      .set({ settings: settings as AttemptSettings, updatedAt: now })
      // Only while nobody changed the attempt since it was read: a person's edit is never lost to a fill.
      .where(and(eq(attempts.id, attempt.id), eq(attempts.updatedAt, attempt.updatedAt)))
      .returning({ id: attempts.id }),
    recordChange(db, { entity: "attempt", id: attempt.id, itemId: attempt.itemId, action: "updated", actor }),
  ]);
  if (!changed.length) return false;
  await db
    .update(printJobs)
    .set({ filled: added as AttemptSettings })
    .where(eq(printJobs.attemptId, attempt.id));
  return true;
}
