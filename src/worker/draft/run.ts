import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { DRAFTS_PER_DAY, type DraftFailure, type ItemDraft } from "../../shared/draft.ts";
import { isModelImageUrl, modelSite } from "../../shared/model-links.ts";
import { afterChange, recordChange } from "../changes.ts";
import { type Db, getDb } from "../db/index.ts";
import { draftRuns, type ItemDraftRow, itemDrafts, items, photos } from "../db/schema.ts";
import { fromUrl, readImage } from "../mcp/image.ts";
import { photoKey } from "../photos.ts";
import { NEUTRAL, photoIdFor } from "../routes/capture.ts";
import { type AskResult, askClaude, MAX_DRAFT_IMAGES } from "./claude.ts";

/** A worker that has had a draft this long is taken to be gone (the browser closed, the Worker was recycled). */
export const STALE_MS = 4 * 60 * 1000;
/** A draft that was taken and lost this many times is given up on. */
const MAX_TRIES = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The feature exists only where the key is set: without it nothing about it shows. */
export const draftsEnabled = (env: Pick<Env, "ANTHROPIC_API_KEY">) => !!env.ANTHROPIC_API_KEY?.trim();

/** A note that holds nothing but links (a bare capture) has no words of a person's own to protect. */
const wordsOf = (note: string) => note.replace(/https?:\/\/\S+/g, "").trim();

export const toApiDraft = (row: ItemDraftRow | undefined | null): ItemDraft | null =>
  row
    ? {
        status: row.status,
        site: row.site,
        url: row.url,
        failure: row.failure,
        applied: row.applied,
        title: row.result?.title ?? null,
        note: row.result?.note ?? null,
        findings: row.result?.findings ?? null,
        draftedAt: row.draftedAt?.getTime() ?? null,
      }
    : null;

/**
 * Asks for a draft: makes (or resets, after a failure) the idea's draft row, so the idea shows "reading the page"
 * at once. Does not call Claude; `runDraft` does. Returns false when the link isn't a model page, or a draft is
 * already on its way or done.
 */
export async function startDraft(db: Db, itemId: string, url: string, actor: { id: string }): Promise<boolean> {
  const found = modelSite(url);
  if (!found) return false;
  const now = new Date();
  const existing = await db.select().from(itemDrafts).where(eq(itemDrafts.itemId, itemId)).get();
  if (existing && existing.status !== "failed") return false;
  await db.batch([
    db
      .insert(itemDrafts)
      .values({ itemId, url: found.url.href, site: found.site.id, status: "reading", createdAt: now })
      .onConflictDoUpdate({
        target: itemDrafts.itemId,
        set: {
          url: found.url.href,
          site: found.site.id,
          status: "reading",
          failure: null,
          claimedAt: null,
          tries: 0,
          result: null,
          applied: [],
          createdAt: now,
          draftedAt: null,
        },
      }),
    recordChange(db, {
      entity: "item",
      id: itemId,
      itemId,
      action: "updated",
      actor: { kind: "person", id: actor.id },
    }),
  ]);
  return true;
}

async function fail(db: Db, row: ItemDraftRow, failure: DraftFailure) {
  await db.batch([
    db.update(itemDrafts).set({ status: "failed", failure, claimedAt: null }).where(eq(itemDrafts.itemId, row.itemId)),
    recordChange(db, {
      entity: "item",
      id: row.itemId,
      itemId: row.itemId,
      action: "updated",
      actor: { kind: "person", id: (await ownerOf(db, row.itemId)) ?? "" },
    }),
  ]);
}

const ownerOf = async (db: Db, itemId: string) =>
  (await db.select({ id: items.createdBy }).from(items).where(eq(items.id, itemId)).get())?.id;

/** The pictures the draft pointed at that come from the three sites' own image hosts, as stored photos. */
async function storePictures(db: Db, env: Env, itemId: string, urls: string[], owner: string): Promise<string[]> {
  const wanted = [...new Set(urls)].filter(isModelImageUrl).slice(0, MAX_DRAFT_IMAGES);
  const downloaded = await Promise.all(
    wanted.map(async (url) => {
      try {
        // A redirect off the image host would be a way past the allowlist: they aren't followed.
        const bytes = await fromUrl(url, "manual");
        return readImage(bytes);
      } catch {
        return null;
      }
    }),
  );
  const stored: string[] = [];
  const now = new Date();
  for (const image of downloaded) {
    if (!image) continue;
    const photoId = await photoIdFor(itemId, 100 + stored.length);
    const httpMetadata = { contentType: image.contentType };
    const customMetadata = { provisional: "1" };
    await Promise.all(
      (["large", "thumb"] as const).map((variant) =>
        env.PHOTOS.put(photoKey(photoId, variant), image.bytes, { httpMetadata, customMetadata }),
      ),
    );
    await db.batch([
      db
        .insert(photos)
        .values({
          id: photoId,
          itemId,
          position: stored.length,
          width: image.width,
          height: image.height,
          color: NEUTRAL,
          contentType: image.contentType,
          needsResize: true,
          createdBy: owner,
          createdAt: now,
        })
        .onConflictDoNothing(),
      recordChange(db, {
        entity: "photo",
        id: photoId,
        itemId,
        action: "created",
        actor: { kind: "person", id: owner },
      }),
    ]);
    stored.push(photoId);
  }
  return stored;
}

/**
 * Takes the idea's draft job and does it: reads the page with Claude, then fills what is empty. Safe to call from
 * several places at once (the browser that asked, a capture's waitUntil, the cron): only the one that wins the
 * claim goes on. It never throws and never overwrites a person's words.
 */
export async function runDraft(env: Env, itemId: string, db: Db = getDb(env.DB)): Promise<void> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return;
  const now = Date.now();
  const [row] = await db
    .update(itemDrafts)
    .set({ claimedAt: new Date(now), tries: sql`${itemDrafts.tries} + 1` })
    .where(
      and(
        eq(itemDrafts.itemId, itemId),
        eq(itemDrafts.status, "reading"),
        or(isNull(itemDrafts.claimedAt), lt(itemDrafts.claimedAt, new Date(now - STALE_MS))),
      ),
    )
    .returning();
  if (!row) return;

  // The day's cap is shared by both people (UTC days: it only has to be about right).
  const since = new Date(now - (now % DAY_MS));
  const used = await db.$count(draftRuns, gte(draftRuns.at, since));
  if (used >= DRAFTS_PER_DAY) return fail(db, row, "cap");
  await db.insert(draftRuns).values({ id: crypto.randomUUID(), itemId, at: new Date(now) });

  const site = modelSite(row.url);
  const answer: AskResult = site ? await askClaude(apiKey, row.url, site.site) : { ok: false, failure: "unreadable" };
  if (!answer.ok) return fail(db, row, answer.failure);
  const draft = answer.draft;

  const item = await db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
    .get();
  if (!item) return;
  const title = draft.title?.trim() || null;
  const words = draft.note?.trim() || null;
  const owner = item.createdBy;
  const applied: ItemDraft["applied"] = [];
  const writes: BatchItem<"sqlite">[] = [];
  // Each write is conditional in the database too, so a person typing at the same moment still wins.
  if (title && !item.title?.trim()) {
    writes.push(
      db
        .update(items)
        .set({ title, updatedAt: new Date() })
        .where(and(eq(items.id, itemId), or(isNull(items.title), sql`trim(${items.title}) = ''`))),
    );
  }
  if (words && !wordsOf(item.note)) {
    const note = item.note.trim() ? `${words}\n\n${item.note.trim()}` : words;
    writes.push(
      db
        .update(items)
        .set({ note, updatedAt: new Date() })
        .where(and(eq(items.id, itemId), eq(items.note, item.note))),
    );
  }
  if (writes.length) await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  const after = await db.select().from(items).where(eq(items.id, itemId)).get();
  if (title && after?.title === title && !item.title?.trim()) applied.push("title");
  if (words && after?.note.startsWith(words) && !wordsOf(item.note)) applied.push("note");

  // Pictures only for an idea that has none.
  let photoIds: string[] = [];
  const hasPhotos = !!(await db
    .select({ id: photos.id })
    .from(photos)
    .where(and(eq(photos.itemId, itemId), isNull(photos.deletedAt)))
    .get());
  if (!hasPhotos) photoIds = await storePictures(db, env, itemId, draft.imageUrls, owner);
  if (photoIds.length) applied.push("photos");

  await db.batch([
    db
      .update(itemDrafts)
      .set({
        status: "drafted",
        failure: null,
        claimedAt: null,
        draftedAt: new Date(),
        applied,
        result: {
          title,
          note: words,
          photoIds,
          findings: {
            designer: draft.designer?.trim() || null,
            license: draft.license?.trim() || null,
            material: draft.material?.trim() || null,
            plate: draft.plate?.trim() || null,
            settings: draft.settings?.trim() || null,
          },
        },
      })
      .where(eq(itemDrafts.itemId, itemId)),
    recordChange(db, { entity: "item", id: itemId, itemId, action: "updated", actor: { kind: "person", id: owner } }),
    db
      .update(items)
      .set({ updatedAt: new Date() })
      .where(and(eq(items.id, itemId), afterChange)),
  ]);
}

/**
 * Takes a draft back: the title and note it wrote (only while they still say what it wrote), its pictures, and the
 * draft itself. What a person has since changed is left alone. Returns false when there was no draft.
 */
export async function undoDraft(db: Db, itemId: string, actor: { id: string }): Promise<boolean> {
  const row = await db.select().from(itemDrafts).where(eq(itemDrafts.itemId, itemId)).get();
  if (!row) return false;
  const result = row.result;
  const now = new Date();
  const statements: BatchItem<"sqlite">[] = [];
  if (result?.title && row.applied.includes("title")) {
    statements.push(
      db
        .update(items)
        .set({ title: null, updatedAt: now })
        .where(and(eq(items.id, itemId), eq(items.title, result.title))),
    );
  }
  if (result?.note && row.applied.includes("note")) {
    const item = await db.select({ note: items.note }).from(items).where(eq(items.id, itemId)).get();
    if (item?.note.startsWith(result.note)) {
      statements.push(
        db
          .update(items)
          .set({ note: item.note.slice(result.note.length).trim(), updatedAt: now })
          .where(and(eq(items.id, itemId), eq(items.note, item.note))),
      );
    }
  }
  for (const photoId of result?.photoIds ?? []) {
    statements.push(
      db
        .update(photos)
        .set({ deletedAt: now })
        .where(and(eq(photos.id, photoId), isNull(photos.deletedAt))),
    );
  }
  await db.batch([
    db.delete(itemDrafts).where(eq(itemDrafts.itemId, itemId)),
    recordChange(db, {
      entity: "item",
      id: itemId,
      itemId,
      action: "updated",
      actor: { kind: "person", id: actor.id },
    }),
    ...statements,
  ]);
  return true;
}

/** The cron's fallback: drafts nobody is working on any more (a closed tab, a recycled Worker) are picked up. */
export async function resumeDrafts(env: Env, now = Date.now()): Promise<number> {
  if (!draftsEnabled(env)) return 0;
  const db = getDb(env.DB);
  const stale = new Date(now - STALE_MS);
  const waiting = await db
    .select()
    .from(itemDrafts)
    .where(and(eq(itemDrafts.status, "reading"), or(isNull(itemDrafts.claimedAt), lt(itemDrafts.claimedAt, stale))))
    .limit(3);
  for (const row of waiting) {
    if (row.tries >= MAX_TRIES) await fail(db, row, "timeout");
    else await runDraft(env, row.itemId, db);
  }
  return waiting.length;
}
