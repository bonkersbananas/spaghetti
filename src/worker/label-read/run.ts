import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  LABEL_FIELDS,
  LABEL_READS_PER_DAY,
  type LabelField,
  type LabelRead,
  type LabelSpool,
} from "../../shared/label-read.ts";
import { DEFAULT_NET_GRAMS } from "../../shared/ledger.ts";
import { recordChange } from "../changes.ts";
import { type Db, getDb } from "../db/index.ts";
import { type LabelReadRow, labelReads, type Spool, spools } from "../db/schema.ts";
import { photoKey } from "../photos.ts";
import { askClaudeToReadLabel } from "./claude.ts";

/** A worker that has had a read this long is taken to be gone. */
export const STALE_MS = 4 * 60 * 1000;
const MAX_TRIES = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The Messages API takes images up to 5 MB; a margin for the encoding. */
const MAX_READ_BYTES = 4_800_000;
/** After the response, `waitUntil` has about 30 seconds. */
export const WAIT_UNTIL_TIMEOUT_MS = 26_000;
const CRON_TIMEOUT_MS = 120_000;
const CONTENT_TYPES = ["image/jpeg", "image/webp", "image/png", "image/gif"] as const;

/** The feature exists only where the key is set: without it nothing about it shows. */
export const labelReadsEnabled = (env: Pick<Env, "ANTHROPIC_API_KEY">) => !!env.ANTHROPIC_API_KEY?.trim();

const isLabelSpool = (value: unknown): value is LabelSpool => typeof value === "object" && value !== null;

const parseFound = (row: LabelReadRow): LabelSpool[] => {
  try {
    const found: unknown = JSON.parse(row.found ?? "[]");
    return Array.isArray(found) ? found.filter(isLabelSpool) : [];
  } catch {
    return [];
  }
};

/** What a spool shows of the read of its current photo, if there is something to show. */
export function toApiLabelRead(row: LabelReadRow | undefined): LabelRead | null {
  if (!row) return null;
  switch (row.status) {
    case "reading":
      return { status: "reading", photoId: row.photoId, spools: [] };
    case "multiple":
      return { status: "multiple", photoId: row.photoId, spools: parseFound(row) };
    case "unreadable":
    case "failed":
    case "cap":
      return { status: row.status, photoId: row.photoId, spools: [] };
    default:
      return null;
  }
}

/** The read of each spool's current photo, by spool id. */
export async function readsBySpool(
  db: Db,
  rows: Array<Pick<Spool, "id" | "photoId">>,
): Promise<Map<string, LabelReadRow>> {
  const bySpool = new Map<string, LabelReadRow>();
  const ids = rows.filter((spool) => spool.photoId).map((spool) => spool.id);
  const current = new Map(rows.map((spool) => [spool.id, spool.photoId]));
  for (let i = 0; i < ids.length; i += 50) {
    const found = await db
      .select()
      .from(labelReads)
      .where(inArray(labelReads.spoolId, ids.slice(i, i + 50)));
    for (const row of found) if (current.get(row.spoolId) === row.photoId) bySpool.set(row.spoolId, row);
  }
  return bySpool;
}

/**
 * Makes the read job for the spool's current photo, so it shows "Reading the label…" at once. Doesn't call Claude
 * (`runLabelRead` does). A photo is read once, but a read that found nothing or failed is tried again on request.
 * Returns false when there is nothing to start: it is being read, or it was read.
 */
export async function startLabelRead(
  db: Db,
  spool: { id: string; photoId: string },
  placeholders: string[],
  actor: { id: string },
): Promise<boolean> {
  const existing = await db.select().from(labelReads).where(eq(labelReads.photoId, spool.photoId)).get();
  if (existing && !["unreadable", "failed", "cap", "dismissed"].includes(existing.status)) return false;
  const now = new Date();
  const [saved] = await db.batch([
    existing
      ? db
          .update(labelReads)
          .set({ status: "reading", placeholders, found: null, claimedAt: null, tries: 0, createdAt: now })
          .where(eq(labelReads.photoId, spool.photoId))
          .returning({ id: labelReads.photoId })
      : db
          .insert(labelReads)
          .values({
            photoId: spool.photoId,
            spoolId: spool.id,
            status: "reading",
            placeholders,
            createdBy: actor.id,
            createdAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: labelReads.photoId }),
    recordChange(db, { entity: "spool", id: spool.id, action: "updated", actor: { kind: "person", id: actor.id } }),
  ]);
  return saved.length > 0;
}

async function settle(db: Db, row: LabelReadRow, set: Partial<typeof labelReads.$inferInsert>) {
  await db.batch([
    db
      .update(labelReads)
      .set({ claimedAt: null, ...set })
      .where(eq(labelReads.photoId, row.photoId)),
    recordChange(db, {
      entity: "spool",
      id: row.spoolId,
      action: "updated",
      actor: { kind: "person", id: row.createdBy ?? "" },
    }),
  ]);
}

const isEmpty = (value: unknown) => value === null || value === undefined || value === "";

/**
 * Fills what is empty (or still the sheet's starting value) with what the label says. Never replaces anything a
 * person set. Written only if nobody edited the spool in the meantime, else tried again against its new state.
 * Returns the fields it filled.
 */
export async function fillSpool(
  db: Db,
  spoolId: string,
  label: LabelSpool,
  placeholders: readonly string[],
  actor: { id: string },
): Promise<LabelField[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const spool = await db
      .select()
      .from(spools)
      .where(and(eq(spools.id, spoolId), isNull(spools.deletedAt)))
      .get();
    if (!spool) return [];
    const set: Record<string, unknown> = {};
    const filled: LabelField[] = [];
    for (const field of LABEL_FIELDS) {
      const value = label[field];
      if (isEmpty(value)) continue;
      const current = spool[field];
      if (isEmpty(current) || placeholders.includes(field)) {
        if (current === value) continue;
        set[field] = value;
        filled.push(field);
      }
    }
    // A color's name is a pair with its hex: when one is a person's, the other still fills in only if empty (above).
    if (filled.length === 0) return [];
    const labelFields = [...new Set([...spool.labelFields, ...filled])];
    const [written] = await db.batch([
      db
        .update(spools)
        .set({ ...set, labelFields, updatedAt: new Date(Math.max(Date.now(), spool.updatedAt.getTime() + 1)) })
        .where(and(eq(spools.id, spoolId), eq(spools.updatedAt, spool.updatedAt), isNull(spools.deletedAt)))
        .returning({ id: spools.id }),
      recordChange(db, { entity: "spool", id: spoolId, action: "updated", actor: { kind: "person", id: actor.id } }),
    ]);
    if (written.length > 0) return filled;
  }
  return [];
}

/**
 * A person edited these fields: they are theirs now, so they stop being "from the label", and a read still going
 * won't replace them. Called with the fields of a PATCH or weight change.
 */
export async function touchFields(db: Db, spoolId: string, fields: string[]) {
  if (fields.length === 0) return;
  const reading = await db
    .select()
    .from(labelReads)
    .where(and(eq(labelReads.spoolId, spoolId), inArray(labelReads.status, ["reading", "multiple"])));
  for (const row of reading) {
    const left = row.placeholders.filter((field) => !fields.includes(field));
    if (left.length !== row.placeholders.length) {
      await db.update(labelReads).set({ placeholders: left }).where(eq(labelReads.photoId, row.photoId));
    }
  }
}

/** The label fields a PATCH or weight change touched, for `fromLabel` and `touchFields`. */
export const touchedLabelFields = (keys: string[]) =>
  keys.filter((key) => (LABEL_FIELDS as readonly string[]).includes(key));

/**
 * Takes the spool's read job and does it: reads the photo with Claude and fills the spool, or keeps what it found when
 * the photo has several labels. Safe to call from several places at once (the request's waitUntil, the cron): only
 * the one that wins the claim goes on. It never throws.
 */
export async function runLabelRead(
  env: Env,
  photoId: string,
  db: Db = getDb(env.DB),
  timeoutMs = WAIT_UNTIL_TIMEOUT_MS,
): Promise<void> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return;
  const now = Date.now();
  const [row] = await db
    .update(labelReads)
    .set({ claimedAt: new Date(now), tries: sql`${labelReads.tries} + 1` })
    .where(
      and(
        eq(labelReads.photoId, photoId),
        eq(labelReads.status, "reading"),
        or(isNull(labelReads.claimedAt), lt(labelReads.claimedAt, new Date(now - STALE_MS))),
      ),
    )
    .returning();
  if (!row) return;
  const spool = await db
    .select()
    .from(spools)
    .where(and(eq(spools.id, row.spoolId), isNull(spools.deletedAt)))
    .get();
  if (!spool || spool.photoId !== photoId) {
    return settle(db, row, { status: "dismissed", runOutcome: spool ? "photo_replaced" : "gone" });
  }
  const fail = (runOutcome: string, detail?: object, status: "failed" | "cap" = "failed") =>
    settle(db, row, { status, runOutcome, detail: detail ? JSON.stringify(detail) : null });

  // The day's cap is shared by both people (UTC days: it only has to be about right).
  const since = new Date(now - (now % DAY_MS));
  if ((await db.$count(labelReads, gte(labelReads.ranAt, since))) >= LABEL_READS_PER_DAY) {
    return fail("cap", undefined, "cap");
  }

  const object = await env.PHOTOS.get(photoKey(photoId, "large"));
  if (!object) return fail("no_photo");
  const contentType = (object.httpMetadata?.contentType ?? "image/jpeg") as (typeof CONTENT_TYPES)[number];
  if (
    !CONTENT_TYPES.includes(contentType) ||
    object.size > MAX_READ_BYTES ||
    (spool.photoWidth ?? 0) > 8000 ||
    (spool.photoHeight ?? 0) > 8000
  ) {
    return fail("too_large", { size: object.size });
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  await db
    .update(labelReads)
    .set({ ranAt: new Date(now) })
    .where(eq(labelReads.photoId, photoId));

  const written = [
    spool.brand && `Brand: ${spool.brand}`,
    spool.material && !row.placeholders.includes("material") && `Material: ${spool.material}`,
    spool.colorName && `Color: ${spool.colorName}`,
    spool.note.trim() && `Their note: ${spool.note.trim().slice(0, 300)}`,
  ].filter(Boolean);
  const answer = await askClaudeToReadLabel(
    apiKey,
    {
      bytes,
      contentType,
      context: written.length ? `What they already wrote about this spool:\n${written.join("\n")}` : "",
    },
    { baseURL: env.ANTHROPIC_BASE_URL?.trim(), timeoutMs },
  );
  const { outcome: runOutcome, ...detail } = answer.diagnosis;
  const record = { runOutcome, detail: JSON.stringify(detail) };
  if (!answer.ok) return settle(db, row, { status: answer.unreadable ? "unreadable" : "failed", ...record });

  const owner = { id: row.createdBy ?? spool.createdBy };
  if (answer.spools.length > 1) {
    // Several labels: nothing is made until a person confirms the list.
    return settle(db, row, { status: "multiple", found: JSON.stringify(answer.spools), ...record });
  }
  const [only] = answer.spools;
  if (only) {
    // Fields typed while Claude was looking are no longer the sheet's starting values.
    const fresh = await db
      .select({ placeholders: labelReads.placeholders })
      .from(labelReads)
      .where(eq(labelReads.photoId, photoId))
      .get();
    await fillSpool(db, spool.id, only, fresh?.placeholders ?? [], owner);
  }
  await settle(db, row, { status: "done", ...record });
}

/**
 * One tap on the confirmation: the first label fills the spool the photo belongs to and each other label becomes a
 * spool of its own, with a copy of the photo. Returns null when there is nothing waiting.
 */
export async function acceptLabelRead(
  env: Env,
  db: Db,
  spoolId: string,
  actor: { id: string },
): Promise<{ ids: string[] } | null> {
  const row = await db
    .select()
    .from(labelReads)
    .where(and(eq(labelReads.spoolId, spoolId), eq(labelReads.status, "multiple")))
    .get();
  if (!row) return null;
  // Taking it first makes a double tap do nothing the second time.
  const [taken] = await db
    .update(labelReads)
    .set({ status: "done" })
    .where(and(eq(labelReads.photoId, row.photoId), eq(labelReads.status, "multiple")))
    .returning();
  if (!taken) return null;
  const found = parseFound(row);
  const spool = await db.select().from(spools).where(eq(spools.id, spoolId)).get();
  if (!spool || !spool.photoId) return { ids: [] };
  const [first, ...others] = found;
  if (first) await fillSpool(db, spoolId, first, row.placeholders, actor);
  const now = new Date();
  const ids: string[] = [];
  for (const [index, label] of others.entries()) {
    const id = crypto.randomUUID();
    const photoId = crypto.randomUUID();
    for (const variant of ["large", "thumb"] as const) {
      const object = await env.PHOTOS.get(photoKey(spool.photoId, variant));
      if (object) {
        await env.PHOTOS.put(photoKey(photoId, variant), await object.arrayBuffer(), {
          httpMetadata: { contentType: object.httpMetadata?.contentType ?? "image/jpeg" },
        });
      }
    }
    const filled = LABEL_FIELDS.filter((field) => !isEmpty(label[field]));
    const created = new Date(now.getTime() + index);
    await db.batch([
      db.insert(spools).values({
        id,
        material: label.material ?? "PLA",
        brand: label.brand,
        colorName: label.colorName,
        colorHex: label.colorHex,
        finish: label.finish,
        netGrams: label.netGrams ?? DEFAULT_NET_GRAMS,
        diameterMm: label.diameterMm,
        nozzleTempMin: label.nozzleTempMin,
        nozzleTempMax: label.nozzleTempMax,
        bedTempMin: label.bedTempMin,
        bedTempMax: label.bedTempMax,
        dryTempC: label.dryTempC,
        dryHours: label.dryHours,
        productCode: label.productCode,
        labelFields: filled,
        photoId,
        photoWidth: spool.photoWidth,
        photoHeight: spool.photoHeight,
        photoColor: spool.photoColor,
        createdBy: actor.id,
        createdAt: created,
        updatedAt: created,
      }),
      recordChange(db, { entity: "spool", id, action: "created", actor: { kind: "person", id: actor.id } }),
    ]);
    ids.push(id);
  }
  return { ids };
}

/** "Not these" or a dismissed failure line: puts the read away; the spool stays as it is. */
export async function dismissLabelRead(db: Db, spoolId: string, actor: { id: string }): Promise<boolean> {
  const [done] = await db.batch([
    db
      .update(labelReads)
      .set({ status: "dismissed" })
      .where(
        and(eq(labelReads.spoolId, spoolId), inArray(labelReads.status, ["multiple", "unreadable", "failed", "cap"])),
      )
      .returning({ id: labelReads.photoId }),
    recordChange(db, { entity: "spool", id: spoolId, action: "updated", actor: { kind: "person", id: actor.id } }),
  ]);
  return done.length > 0;
}

/** The cron's fallback: reads nobody is working on any more (a recycled Worker) are picked up. */
export async function resumeLabelReads(env: Env, now = Date.now()): Promise<number> {
  if (!labelReadsEnabled(env)) return 0;
  const db = getDb(env.DB);
  const stale = new Date(now - STALE_MS);
  const waiting = await db
    .select()
    .from(labelReads)
    .where(and(eq(labelReads.status, "reading"), or(isNull(labelReads.claimedAt), lt(labelReads.claimedAt, stale))))
    .limit(3);
  for (const row of waiting) {
    if (row.tries >= MAX_TRIES) await settle(db, row, { status: "failed", runOutcome: "timeout" });
    else await runLabelRead(env, row.photoId, db, CRON_TIMEOUT_MS);
  }
  return waiting.length;
}
