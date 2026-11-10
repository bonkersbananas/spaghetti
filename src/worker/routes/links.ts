import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { LinkPreviewResponse } from "../../shared/api.ts";
import { checkLinkUrl } from "../../shared/link-safety.ts";
import { linkPreviews } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { fetchPreview } from "../link-preview.ts";

const DAY = 24 * 60 * 60 * 1000;
/** A page's title rarely changes; a page that couldn't be read is tried again tomorrow. */
export const FRESH_FOR = { found: 30 * DAY, failed: DAY } as const;

/**
 * /api/links: what a link in a note points at, so the note can show a card
 * with a title instead of a bare address. People only (see auth/scopes.ts): the
 * Worker fetches pages on behalf of whoever asks, so a token has no business here.
 */
export const linkRoutes = new Hono<AppEnv>().get("/preview", async (c) => {
  const raw = c.req.query("url") ?? "";
  const link = raw.length <= 2048 ? checkLinkUrl(raw) : null;
  if (!link) return apiError(c, 400, "invalid", "That isn't a public https link.");
  const key = link.href;
  const now = Date.now();

  const [cached] = await c.var.db.select().from(linkPreviews).where(eq(linkPreviews.url, key)).limit(1);
  if (cached && now - cached.fetchedAt.getTime() < (cached.failed ? FRESH_FOR.failed : FRESH_FOR.found)) {
    return c.json<LinkPreviewResponse>({ url: raw, title: cached.title, site: cached.site });
  }

  const preview = await fetchPreview(link);
  const row = {
    url: key,
    title: preview?.title ?? null,
    site: preview?.site ?? null,
    failed: !preview,
    fetchedAt: new Date(now),
  };
  await c.var.db
    .insert(linkPreviews)
    .values(row)
    .onConflictDoUpdate({
      target: linkPreviews.url,
      set: { title: row.title, site: row.site, failed: row.failed, fetchedAt: row.fetchedAt },
    });
  return c.json<LinkPreviewResponse>({ url: raw, title: row.title, site: row.site });
});
