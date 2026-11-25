import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { firstModelLink } from "../../shared/model-links.ts";
import { noteWords, TITLES_PER_DAY, wantsTitle } from "../../shared/title.ts";
import { recordChange } from "../changes.ts";
import { type Db, getDb } from "../db/index.ts";
import { type ItemTitleRow, itemDrafts, items, itemTitles, photos } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { MAX_READ_BYTES } from "../photo-read/run.ts";
import { photoKey } from "../photos.ts";
import { askClaudeForTitle, type IdeaToName } from "./claude.ts";

/** A worker that has had a job this long is taken to be gone (the Worker was recycled after the response). */
export const STALE_MS = 4 * 60 * 1000;
/** A job that was taken and lost this many times is given up on. */
const MAX_TRIES = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * How long the job waits before it reads the idea: a capture sends its note with the idea and its photos one by one
 * after it, so the first save gives the rest of the capture a moment to arrive.
 */
export const SETTLE_MS = 2500;
/** TITLES_SETTLE_MS shortens the wait (the tests set it, so they don't each sit out 2.5 s); unset it is SETTLE_MS. */
function settleFor(env: Env): number {
  const set = Number(env.TITLES_SETTLE_MS);
  return env.TITLES_SETTLE_MS && Number.isFinite(set) && set >= 0 ? set : SETTLE_MS;
}
/**
 * A capture that said its photos were on their way may still be sending the first when the wait is over: the job
 * looks for it every half second for this long more before it gives up (a slow connection).
 */
export const PHOTO_WAIT_MS = 8000;
/** After the response, `waitUntil` has about 30 seconds: the waits and the call fit in a little less than that. */
export const WAIT_UNTIL_TIMEOUT_MS = 15_000;
/** The cron has all the time it needs. */
const CRON_TIMEOUT_MS = 60_000;
/** The photos Claude looks at: the first few say what the idea is. */
const MAX_PHOTOS = 3;
const CONTENT_TYPES = ["image/jpeg", "image/webp", "image/png", "image/gif"] as const;

/** The feature exists only where the key is set: without it nothing about it shows. */
export const titlesEnabled = (env: Pick<Env, "ANTHROPIC_API_KEY">) => !!env.ANTHROPIC_API_KEY?.trim();

/** What the screens know of an idea's naming job: its state, the title it gave and when it began. */
export interface TitleJobView {
  status: ItemTitleRow["status"];
  title: string | null;
  since: number;
}

/**
 * The naming jobs of these items (decision 0070): the title Claude gave, which the screen marks as Claude's while it
 * is still that, and whether Claude is naming one right now, which the screen shows in place of the title (0072).
 */
export async function titleJobs(db: Db, itemIds: string[]): Promise<Map<string, TitleJobView>> {
  const jobs = new Map<string, TitleJobView>();
  for (let i = 0; i < itemIds.length; i += 50) {
    const rows = await db
      .select({
        itemId: itemTitles.itemId,
        status: itemTitles.status,
        title: itemTitles.title,
        createdAt: itemTitles.createdAt,
      })
      .from(itemTitles)
      .where(inArray(itemTitles.itemId, itemIds.slice(i, i + 50)));
    for (const row of rows) {
      jobs.set(row.itemId, { status: row.status, title: row.title, since: row.createdAt.getTime() });
    }
  }
  return jobs;
}

const livePhotos = (itemId: string) =>
  and(eq(photos.itemId, itemId), isNull(photos.attemptId), isNull(photos.deletedAt));

/**
 * An idea was saved, or got its first photo or words: makes its naming job if it is an idea Claude should name (no
 * title, no model link, something to read) and it was never named before. An idea is named once. Doesn't call Claude
 * (`runTitle` does) and shows nothing: the idea keeps showing as it was until the title arrives.
 */
export async function startTitle(db: Db, itemId: string, photosComing = 0): Promise<boolean> {
  const item = await db
    .select({ stage: items.stage, title: items.title, note: items.note })
    .from(items)
    .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
    .get();
  if (!item) return false;
  const photoCount = await db.$count(photos, livePhotos(itemId));
  // Photos a capture said are on their way count: the job (and the screens' "Naming…") starts with the idea.
  if (!wantsTitle({ ...item, photos: photoCount + photosComing })) return false;
  // A model page's idea is the draft's to name (decision 0019).
  if (await db.select({ id: itemDrafts.itemId }).from(itemDrafts).where(eq(itemDrafts.itemId, itemId)).get()) {
    return false;
  }
  const inserted = await db
    .insert(itemTitles)
    .values({ itemId, status: "naming", createdAt: new Date() })
    .onConflictDoNothing()
    .returning({ id: itemTitles.itemId });
  return inserted.length > 0;
}

/**
 * After a save that may have left an untitled idea with something to read (POST /api/items, its PATCH, a photo, the
 * capture endpoint): starts the naming job and runs it after the response. Only a person's save, or their sharing
 * token's (the capture scope alone), starts one: an agent that can do more names what it saves itself.
 */
export async function titleAfterSave(c: Context<AppEnv>, itemId: string, photosComing = 0): Promise<void> {
  const scopes = c.var.scopes;
  const sharingToken = scopes?.length === 1 && scopes[0] === "capture";
  if ((scopes && !sharingToken) || !titlesEnabled(c.env) || c.env.TITLES_ON_SAVE === "off") return;
  const started = await startTitle(c.var.db, itemId, photosComing).catch(() => false);
  if (!started) return;
  try {
    c.executionCtx.waitUntil(
      runTitle(c.env, itemId, c.var.db).catch((error) => console.error("naming an idea failed", error)),
    );
  } catch {
    // No execution context: the cron's fallback does it.
  }
}

/**
 * Ends the job without a title of Claude's, and tells the feed, so the screens that show "Naming…" stop at once rather
 * than wait for their timeout.
 */
async function settle(db: Db, itemId: string, set: Partial<typeof itemTitles.$inferInsert>) {
  const owner = (await db.select({ id: items.createdBy }).from(items).where(eq(items.id, itemId)).get())?.id;
  const update = db
    .update(itemTitles)
    .set({ claimedAt: null, ...set })
    .where(eq(itemTitles.itemId, itemId));
  if (!owner) {
    await update;
    return;
  }
  await db.batch([
    update,
    recordChange(db, { entity: "item", id: itemId, itemId, action: "updated", actor: { kind: "person", id: owner } }),
  ]);
}

/**
 * Takes the idea's naming job and does it: looks at its photos and note with Claude and gives it the title, if it
 * still has none. Safe to call from several places at once (the save's waitUntil, the cron): only the one that wins
 * the claim goes on. It never throws, and it never replaces a title a person gave, before or while it worked.
 */
export async function runTitle(
  env: Env,
  itemId: string,
  db: Db = getDb(env.DB),
  { settleMs = settleFor(env), timeoutMs = WAIT_UNTIL_TIMEOUT_MS } = {},
): Promise<void> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return;
  const claimed = Date.now();
  const [row] = await db
    .update(itemTitles)
    .set({ claimedAt: new Date(claimed), tries: sql`${itemTitles.tries} + 1` })
    .where(
      and(
        eq(itemTitles.itemId, itemId),
        eq(itemTitles.status, "naming"),
        or(isNull(itemTitles.claimedAt), lt(itemTitles.claimedAt, new Date(claimed - STALE_MS))),
      ),
    )
    .returning();
  if (!row) return;
  if (settleMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    // Started by a capture whose photos are still on their way, with no words to go on yet: wait for the first.
    for (let waited = 0; waited < PHOTO_WAIT_MS; waited += 500) {
      const note = (await db.select({ note: items.note }).from(items).where(eq(items.id, itemId)).get())?.note ?? "";
      if (noteWords(note) || (await db.$count(photos, livePhotos(itemId)))) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  const item = await db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
    .get();
  if (!item) return settle(db, itemId, { status: "failed", runOutcome: "gone" });
  // A person named it meanwhile, it grew a model link (the draft names those) or it became a build: theirs wins.
  if (item.title?.trim()) return settle(db, itemId, { status: "kept", runOutcome: "named_by_person" });
  if (firstModelLink(item.note)) return settle(db, itemId, { status: "kept", runOutcome: "model_link" });
  if (item.stage !== "idea") return settle(db, itemId, { status: "kept", runOutcome: "not_an_idea" });

  // The day's cap is shared by both people (UTC days: it only has to be about right).
  const now = Date.now();
  const since = new Date(now - (now % DAY_MS));
  if ((await db.$count(itemTitles, gte(itemTitles.ranAt, since))) >= TITLES_PER_DAY) {
    return settle(db, itemId, { status: "failed", runOutcome: "cap" });
  }

  // The first few photos' large variants (resized in the browser; a shared original is read as it is when it fits).
  const photoRows = await db
    .select()
    .from(photos)
    .where(livePhotos(itemId))
    .orderBy(asc(photos.position), asc(photos.createdAt))
    .limit(MAX_PHOTOS);
  const read: IdeaToName["photos"] = [];
  for (const photo of photoRows) {
    const object = await env.PHOTOS.get(photoKey(photo.id, "large"));
    if (!object) continue;
    const contentType = (object.httpMetadata?.contentType ?? photo.contentType) as (typeof CONTENT_TYPES)[number];
    if (!CONTENT_TYPES.includes(contentType) || object.size > MAX_READ_BYTES) continue;
    if (photo.width > 8000 || photo.height > 8000) continue;
    read.push({ bytes: new Uint8Array(await object.arrayBuffer()), contentType });
  }
  if (!read.length && !noteWords(item.note)) {
    // Its photos haven't come (a slow connection): the job steps aside, so the first photo to arrive starts it again.
    await db.batch([
      db.delete(itemTitles).where(eq(itemTitles.itemId, itemId)),
      recordChange(db, {
        entity: "item",
        id: itemId,
        itemId,
        action: "updated",
        actor: { kind: "person", id: item.createdBy },
      }),
    ]);
    return;
  }

  await db
    .update(itemTitles)
    .set({ ranAt: new Date(now) })
    .where(eq(itemTitles.itemId, itemId));
  const answer = await askClaudeForTitle(
    apiKey,
    { photos: read, note: item.note },
    { baseURL: env.ANTHROPIC_BASE_URL?.trim() || undefined, timeoutMs },
  );
  const { outcome: runOutcome, ...detail } = answer.diagnosis;
  const record = { runOutcome, detail: JSON.stringify(detail) };
  if (!answer.ok) return settle(db, itemId, { status: answer.none ? "none" : "failed", ...record });

  // Written only while it is still an idea with no title, in the database too: a person at the same moment wins.
  const [written] = await db
    .update(items)
    .set({ title: answer.title, updatedAt: new Date() })
    .where(
      and(
        eq(items.id, itemId),
        isNull(items.deletedAt),
        // Still an idea: a build started meanwhile keeps the name its person gives it.
        eq(items.stage, "idea"),
        or(isNull(items.title), sql`trim(${items.title}) = ''`),
      ),
    )
    .returning({ id: items.id });
  if (!written) return settle(db, itemId, { status: "kept", ...record, runOutcome: "named_by_person" });
  await db.batch([
    db
      .update(itemTitles)
      .set({ status: "titled", title: answer.title, claimedAt: null, ...record })
      .where(eq(itemTitles.itemId, itemId)),
    // The other screens (and the other person's) hear of it and show the title.
    recordChange(db, {
      entity: "item",
      id: itemId,
      itemId,
      action: "updated",
      actor: { kind: "person", id: item.createdBy },
    }),
  ]);
}

/** The cron's fallback: naming jobs nobody is working on any more (a recycled Worker) are picked up. */
export async function resumeTitles(env: Env, now = Date.now()): Promise<number> {
  if (!titlesEnabled(env)) return 0;
  const db = getDb(env.DB);
  const stale = new Date(now - STALE_MS);
  const waiting: ItemTitleRow[] = await db
    .select()
    .from(itemTitles)
    .where(and(eq(itemTitles.status, "naming"), or(isNull(itemTitles.claimedAt), lt(itemTitles.claimedAt, stale))))
    .limit(3);
  for (const row of waiting) {
    if (row.tries >= MAX_TRIES) await settle(db, row.itemId, { status: "failed", runOutcome: "timeout" });
    else await runTitle(env, row.itemId, db, { settleMs: 0, timeoutMs: CRON_TIMEOUT_MS });
  }
  return waiting.length;
}
