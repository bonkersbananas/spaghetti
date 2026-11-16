import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { PURGE_AFTER_MS } from "../../shared/deleted.ts";
import { isModelImageUrl, pictureRequestUrl } from "../../shared/model-links.ts";
import { isSiteTitle, unwrapImage } from "../../shared/model-page.ts";
import {
  SCOUT_COUNT,
  SCOUT_FROM_HOUR,
  type ScoutPick,
  type ScoutRound,
  scoutLink,
  tidyWhy,
} from "../../shared/scout.ts";
import { addWeeks, mondayOf, zonedParts } from "../../shared/week.ts";
import { recordChange } from "../changes.ts";
import { type Db, getDb } from "../db/index.ts";
import { type ScoutPickRow, scoutPicks, scoutRounds } from "../db/schema.ts";
import { readModel, type UnreadReason } from "../draft/page.ts";
import { fromUrl, type ImageInfo, readImage } from "../mcp/image.ts";
import { askClaudeToScout, type ReadPage, type ScoutResult } from "./claude.ts";
import { type ScoutNotebook, scoutNotebook } from "./context.ts";

/** A claim that has gone quiet this long is taken over (once more). */
export const SCOUT_CLAIM_STALE_MS = 10 * 60 * 1000;
const MAX_TRIES = 2;
/** The hard cap on Claude runs a day (UTC), whatever the weeks say: a week is one run, this only guards the bill. */
export const SCOUT_RUNS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The picture's width on MakerWorld's converting host: three of them sit side by side. */
const PICTURE_WIDTH = 900;

/** The feature exists only where the key is set: without it nothing about it shows. */
export const scoutEnabled = (env: Pick<Env, "ANTHROPIC_API_KEY">) => !!env.ANTHROPIC_API_KEY?.trim();

export const scoutPictureKey = (pickId: string) => `scout/${pickId}`;

export const toApiPick = (row: ScoutPickRow): ScoutPick => ({
  id: row.id,
  url: row.url,
  site: row.site,
  siteName: row.site === "makerworld" ? "MakerWorld" : "Thingiverse",
  title: row.title,
  why: row.why,
  hasPicture: row.pictureType !== null,
  status: row.status,
  itemId: row.itemId,
});

/**
 * Takes the week's job, or says there is nothing to do: only with the key, only for this week, only from the
 * morning (nothing arrives in the night; a stand-in server ignores the hour) and only once (a claim that went quiet
 * is taken over once more). The claim is made before Claude is asked, so a week costs one run.
 */
export async function claimScoutRound(env: Env, now: number, db: Db): Promise<string | null> {
  if (!scoutEnabled(env)) return null;
  const standIn = !!env.ANTHROPIC_BASE_URL?.trim();
  if (!standIn && zonedParts(now).hour < SCOUT_FROM_HOUR) return null;
  const monday = mondayOf(now);
  const made = await db
    .insert(scoutRounds)
    .values({ monday, status: "thinking", claimedAt: new Date(now), tries: 1, createdAt: new Date(now) })
    .onConflictDoNothing()
    .returning({ monday: scoutRounds.monday });
  if (made.length) return monday;
  const retaken = await db
    .update(scoutRounds)
    .set({ claimedAt: new Date(now), tries: sql`${scoutRounds.tries} + 1` })
    .where(
      and(
        eq(scoutRounds.monday, monday),
        eq(scoutRounds.status, "thinking"),
        lt(scoutRounds.tries, MAX_TRIES),
        or(isNull(scoutRounds.claimedAt), lt(scoutRounds.claimedAt, new Date(now - SCOUT_CLAIM_STALE_MS))),
      ),
    )
    .returning({ monday: scoutRounds.monday });
  return retaken.length ? monday : null;
}

interface Checked {
  link: NonNullable<ReturnType<typeof scoutLink>>;
  title: string;
  why: string;
  picture: ImageInfo | null;
  /** How it was seen alive: the Worker read MakerWorld's API or the page, or Claude's web fetch read it. */
  by: "api" | "page" | "web_fetch" | "stand_in";
}

/** Why a link was dropped (decision 0067): the Worker's reason, or the reason was the sentence on why it fits. */
type DeadReason = UnreadReason | "no_why";

/** A web fetch document's title without the site's name after it ("Octopus - Thingiverse"). */
export const readTitle = (title: string) =>
  title
    .replace(/\s+/g, " ")
    .replace(/\s*[-|–—]\s*(free 3d print model\s*[-|–—]\s*)?(makerworld|thingiverse)(\.com)?\s*$/i, "")
    .trim();

/**
 * Whether a suggested link is alive and what the model is called and looks like, never from Claude's words alone
 * (decision 0067, which amends 0040): the Worker reads it (MakerWorld's design API, then the page; Thingiverse's
 * page), and when it can't, a page Claude's own web fetch read in this answer counts, with the title it read. A link
 * nobody saw alive, or a page that names no model (a soft "not found"), is dropped with its reason. Against a
 * stand-in Anthropic (e2e, screenshots) nothing is fetched, and an address with the word `dead` in it is the dead one.
 */
export async function checkCandidate(
  env: Env,
  candidate: { url: string; title: string; why: string; imageUrl: string | null },
  read: ReadPage[] = [],
): Promise<{ ok: Checked } | { dead: DeadReason }> {
  const link = scoutLink(candidate.url);
  if (!link) return { dead: "not_found" };
  const standIn = env.ANTHROPIC_BASE_URL?.trim() ? new URL(env.ANTHROPIC_BASE_URL.trim()).origin : null;
  let title = candidate.title.replace(/\s+/g, " ").trim();
  let imageUrls: string[] = candidate.imageUrl ? [candidate.imageUrl] : [];
  let by: Checked["by"] = "stand_in";
  if (standIn) {
    if (/dead/i.test(link.url)) return { dead: "not_found" };
  } else {
    const worker = await readModel(link.site, link.url, { apiFirst: true });
    const fetched = read.find(
      (page) => scoutLink(page.url)?.key === link.key && !!page.title && !isSiteTitle(readTitle(page.title)),
    );
    if (worker.facts?.title) {
      title = worker.facts.title;
      imageUrls = [...worker.facts.imageUrls, ...imageUrls];
      by = worker.via ?? "page";
    } else if (fetched?.title) {
      title = readTitle(fetched.title);
      imageUrls = [...imageUrls, ...fetched.links.map(unwrapImage)];
      by = "web_fetch";
    } else {
      return { dead: worker.reason ?? "unreachable" };
    }
    title = title.replace(/\s+/g, " ").trim();
  }
  const why = tidyWhy(candidate.why);
  if (!title) return { dead: "no_model" };
  if (!why) return { dead: "no_why" };
  const allowed = (url: string) =>
    isModelImageUrl(url) || (!!standIn && URL.canParse(url) && new URL(url).origin === standIn);
  let picture: ImageInfo | null = null;
  for (const url of [...new Set(imageUrls)].filter(allowed).slice(0, 3)) {
    try {
      // A redirect off the image host would be a way past the allowlist: they aren't followed.
      picture = readImage(await fromUrl(pictureRequestUrl(url, PICTURE_WIDTH), "manual", !!standIn));
      break;
    } catch {
      picture = null;
    }
  }
  return { ok: { link, title: title.slice(0, 120), why, picture, by } };
}

function tally(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

type Settled = "done" | "nothing" | "failed";

/**
 * Does a claimed week's job: asks Claude, checks every link, keeps up to three that live. Never throws, and writes
 * nothing but the round, its picks and their pictures. It never makes an idea.
 */
export async function runScout(
  env: Env,
  monday: string,
  options: { now?: number; db?: Db; timeoutMs?: number } = {},
): Promise<Settled> {
  const { now = Date.now(), db = getDb(env.DB) } = options;
  const apiKey = env.ANTHROPIC_API_KEY?.trim() ?? "";
  const settle = async (status: Settled, set: Partial<typeof scoutRounds.$inferInsert> = {}) => {
    await db
      .update(scoutRounds)
      .set({ status, claimedAt: null, ...set })
      .where(eq(scoutRounds.monday, monday));
    return status;
  };
  try {
    const notebook: ScoutNotebook = await scoutNotebook(db);
    // A stand-in server (the e2e tests, screenshots) isn't counted: the cap is for the bill.
    const standIn = !!env.ANTHROPIC_BASE_URL?.trim();
    // Nothing to go on yet: no guess, and no round kept for the week (the first idea can still get its scouting).
    if (!notebook.hasSignal) {
      await db.delete(scoutRounds).where(eq(scoutRounds.monday, monday));
      return "nothing";
    }
    const since = new Date(now - (now % DAY_MS));
    if (!standIn && (await db.$count(scoutRounds, gte(scoutRounds.ranAt, since))) >= SCOUT_RUNS_PER_DAY) {
      return await settle("failed", { runOutcome: "cap" });
    }
    await db
      .update(scoutRounds)
      .set({ ranAt: new Date(now) })
      .where(eq(scoutRounds.monday, monday));
    const answer: ScoutResult = await askClaudeToScout(apiKey, notebook.text, {
      baseURL: env.ANTHROPIC_BASE_URL?.trim(),
      timeoutMs: options.timeoutMs,
    });
    const { outcome, ...diagnosis } = answer.diagnosis;
    if (!answer.ok) {
      // A busy or unreachable Claude (overloaded, rate limited, timed out) is tried once more ten minutes on, rather
      // than costing the two of them the whole week; a refusal or a bad answer would only come again.
      const transient =
        outcome === "timeout" ||
        (outcome === "api_error" &&
          (diagnosis.httpStatus === undefined || diagnosis.httpStatus === 429 || diagnosis.httpStatus >= 500));
      const round = await db.select().from(scoutRounds).where(eq(scoutRounds.monday, monday)).get();
      if (transient && round && round.tries < MAX_TRIES) {
        await db
          .update(scoutRounds)
          .set({ claimedAt: new Date(now), runOutcome: outcome, detail: JSON.stringify(diagnosis) })
          .where(eq(scoutRounds.monday, monday));
        return "failed";
      }
      return await settle("failed", { runOutcome: outcome, detail: JSON.stringify(diagnosis) });
    }

    // Links: well-formed, not seen before, not twice in one answer, and alive.
    const seen = new Set(notebook.seen);
    const fresh: typeof answer.suggestions = [];
    let repeated = 0;
    let malformed = 0;
    for (const suggestion of answer.suggestions) {
      const link = scoutLink(suggestion.url);
      if (!link) malformed++;
      else if (seen.has(link.key)) repeated++;
      else {
        seen.add(link.key);
        fresh.push(suggestion);
      }
    }
    const results = await Promise.all(
      fresh.map(async (suggestion) => ({
        suggestion,
        result: await checkCandidate(env, suggestion, answer.found.read),
      })),
    );
    const checked = results.flatMap(({ result }) => ("ok" in result ? [result.ok] : []));
    const dropped = results.flatMap(({ suggestion, result }) =>
      "dead" in result ? [{ suggestion, by: result.dead }] : [],
    );
    const dead = dropped.length;
    const searched = new Set(answer.found.searched.map((url) => scoutLink(url)?.key).filter(Boolean));
    // Pictures first: a suggestion without one is shown only when there are not enough with.
    const chosen = [...checked.filter((c) => c.picture), ...checked.filter((c) => !c.picture)].slice(0, SCOUT_COUNT);
    const record = {
      detail: JSON.stringify({
        ...diagnosis,
        asked: answer.suggestions.length,
        malformed,
        repeated,
        dead,
        // Why each was dropped, and how the others were seen alive: the next quiet week says why.
        ...(dead ? { deadBy: tally(dropped.map((drop) => drop.by)) } : {}),
        ...(checked.length ? { aliveBy: tally(checked.map((pick) => pick.by)) } : {}),
        kept: chosen.length,
        // The dropped links themselves (public model addresses), and whether Claude's own search had returned them.
        ...(dead
          ? {
              dropped: dropped.map(({ suggestion, by }) => ({
                url: suggestion.url.slice(0, 200),
                by,
                inSearch: searched.has(scoutLink(suggestion.url)?.key),
              })),
            }
          : {}),
      }),
    };
    if (!chosen.length) {
      // A stand-in that has nothing to say isn't kept as the week's answer, so a test can ask again.
      if (standIn && !answer.suggestions.length) {
        await db.delete(scoutRounds).where(eq(scoutRounds.monday, monday));
        return "nothing";
      }
      return await settle("nothing", { runOutcome: answer.suggestions.length ? "all_dead" : "nothing", ...record });
    }

    for (const [position, pick] of chosen.entries()) {
      const id = crypto.randomUUID();
      if (pick.picture) {
        await env.PHOTOS.put(scoutPictureKey(id), pick.picture.bytes, {
          httpMetadata: { contentType: pick.picture.contentType },
        });
      }
      const [row] = await db
        .insert(scoutPicks)
        .values({
          id,
          monday,
          position,
          key: pick.link.key,
          url: pick.link.url,
          site: pick.link.site,
          title: pick.title,
          why: pick.why,
          pictureType: pick.picture?.contentType ?? null,
          pictureWidth: pick.picture?.width ?? null,
          pictureHeight: pick.picture?.height ?? null,
          createdAt: new Date(now),
        })
        .onConflictDoNothing()
        .returning({ id: scoutPicks.id });
      // Lost a race for the same model (the key is unique): its picture is not needed.
      if (!row) await env.PHOTOS.delete(scoutPictureKey(id));
    }
    await db.batch([
      db
        .update(scoutRounds)
        .set({ status: "done", claimedAt: null, runOutcome: "done", ...record })
        .where(eq(scoutRounds.monday, monday)),
      recordChange(db, {
        entity: "scout",
        id: monday,
        itemId: null,
        action: "created",
        actor: { kind: "agent", id: "scout" },
      }),
    ]);
    return "done";
  } catch (error) {
    console.error("scout failed", error);
    return settle("failed", { runOutcome: "exception" }).catch(() => "failed" as const);
  }
}

/** The cron: claims this week's round if nobody has and does it. A no-op without the key, before the morning or once done. */
export async function scoutTick(env: Env, now = Date.now(), db: Db = getDb(env.DB)): Promise<Settled | "skipped"> {
  const monday = await claimScoutRound(env, now, db);
  return monday ? runScout(env, monday, { now, db }) : "skipped";
}

/** What the page shows: this week's round and its picks, in order. */
export async function loadScout(db: Db, now: number): Promise<ScoutRound> {
  const monday = mondayOf(now);
  const round = await db.select().from(scoutRounds).where(eq(scoutRounds.monday, monday)).get();
  const picks = await db
    .select()
    .from(scoutPicks)
    .where(eq(scoutPicks.monday, monday))
    .orderBy(asc(scoutPicks.position));
  // A claim nobody can take over any more (it went quiet after its last try) is not "looking": the week stays quiet.
  const looking =
    round?.status === "thinking" &&
    (round.tries < MAX_TRIES || (round.claimedAt?.getTime() ?? 0) > now - SCOUT_CLAIM_STALE_MS);
  const state = looking ? "thinking" : picks.length ? "ready" : "none";
  return { monday, state, picks: picks.map(toApiPick) };
}

/** The daily tidy: pictures of picks decided a month ago are removed (the rows stay: they are what the scout remembers). */
export async function purgeScoutPictures(env: Env, now = Date.now()): Promise<number> {
  const db = getDb(env.DB);
  const old = await db
    .select({ id: scoutPicks.id })
    .from(scoutPicks)
    .where(
      and(
        isNotNull(scoutPicks.pictureType),
        inArray(scoutPicks.status, ["kept", "dismissed"]),
        lt(scoutPicks.decidedAt, new Date(now - PURGE_AFTER_MS)),
      ),
    )
    .limit(100);
  // Picks nobody decided are old news after a month too.
  const stale = await db
    .select({ id: scoutPicks.id })
    .from(scoutPicks)
    .where(
      and(
        isNotNull(scoutPicks.pictureType),
        eq(scoutPicks.status, "suggested"),
        lt(scoutPicks.monday, addWeeks(mondayOf(now), -5)),
      ),
    )
    .limit(100);
  const ids = [...old, ...stale].map((row) => row.id);
  if (!ids.length) return 0;
  await env.PHOTOS.delete(ids.map(scoutPictureKey));
  await db.update(scoutPicks).set({ pictureType: null }).where(inArray(scoutPicks.id, ids));
  return ids.length;
}
