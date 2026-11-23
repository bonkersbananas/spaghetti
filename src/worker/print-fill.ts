/**
 * What a printer-made attempt lacks once it is in a build: the printer says only that a print ran, so the attempt
 * starts with no material, colour or settings. When the print is placed (matched at its start, or put there by a
 * person later), this fills in only what is empty (never what a person or an agent set; the rule agents' files
 * follow, decision 0078) from, in turn:
 *
 * 1. the sliced file it matched: the build's file (kept with it or printed in one of its attempts) that the job is
 *    named after, on the plate printed;
 * 2. else the build's latest attempt that has settings, as "same as last time" carries them;
 * 3. the spools the printer's active trays held when the print began (an old bridge sends none).
 */
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { type AttemptSettings, byPrintTime, carryOver, fillSettings, RESULT_KEYS } from "../shared/attempts.ts";
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
  const [kept, printed] = await Promise.all([
    db
      .select({
        id: itemFiles.id,
        name: itemFiles.name,
        plate: itemFiles.plate,
        prefill: itemFiles.prefill,
      })
      .from(itemFiles)
      .where(and(eq(itemFiles.itemId, attempt.itemId), isNull(itemFiles.deletedAt)))
      .orderBy(desc(itemFiles.createdAt)),
    db
      .select({
        id: attemptFiles.id,
        name: attemptFiles.name,
        plate: attemptFiles.plate,
        prefill: attemptFiles.prefill,
      })
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
  const byName = key
    ? files.filter((file) => printKey(file.name) === key && (!job.plate || file.plate === job.plate))
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

/** Puts the spools of the active trays on the attempt's filaments, one by one, where a filament has no spool yet. */
function withTrays(settings: AttemptSettings, found: readonly SpoolInTray[]): AttemptSettings | null {
  if (!found.length) return null;
  const filaments = settings.filaments ?? [];
  // One tray feeds a one-colour print; several trays are matched to a file's filaments only when their numbers agree.
  if (filaments.length > 1 && filaments.length !== found.length) return null;
  const next = (filaments.length ? filaments : [{}]).map((filament, index) => {
    const spool = found[index];
    return spool && !filament.spoolId ? filamentFromSpool(spool, filament) : filament;
  });
  if (JSON.stringify(next) === JSON.stringify(filaments)) return null;
  return { ...settings, filaments: next };
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

/**
 * Fills a printer-made attempt's empty settings and filaments from where it is now. Does nothing for an attempt the
 * printer didn't file (no print job), and never replaces a value that is there. Returns whether it changed anything.
 */
export async function fillPrinterAttempt(db: Db, attemptId: string, actor: ChangeActor): Promise<boolean> {
  const [attempt, job] = await Promise.all([
    db.select().from(attempts).where(eq(attempts.id, attemptId)).get(),
    db.select().from(printJobs).where(eq(printJobs.attemptId, attemptId)).get(),
  ]);
  if (!attempt || attempt.deletedAt || !job) return false;
  let settings = attempt.settings;
  const source = (await fromFile(db, attempt, job)) ?? (await fromLastAttempt(db, attempt));
  if (source) settings = fillSettings(settings, source) ?? settings;
  const trays = job.trays ?? [];
  if (trays.length && trays.every((tray) => tray.spoolId)) {
    const rows = await db.select().from(spools).where(isNull(spools.deletedAt));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const found = trays.flatMap((tray) => {
      const row = tray.spoolId ? byId.get(tray.spoolId) : undefined;
      return row ? [{ ...row, colors: colorsOf(row.colors), slot: tray.slot }] : [];
    });
    // A spool gone since leaves a tray unknown: then nothing is guessed.
    if (found.length === trays.length) settings = withTrays(settings, found) ?? settings;
  }
  if (settings === attempt.settings) return false;
  const now = new Date();
  const [changed] = await db.batch([
    db
      .update(attempts)
      .set({ settings, updatedAt: now })
      // Only while nobody changed the attempt since it was read: a person's edit is never lost to a fill.
      .where(and(eq(attempts.id, attempt.id), eq(attempts.updatedAt, attempt.updatedAt)))
      .returning({ id: attempts.id }),
    recordChange(db, { entity: "attempt", id: attempt.id, itemId: attempt.itemId, action: "updated", actor }),
  ]);
  return changed.length > 0;
}
