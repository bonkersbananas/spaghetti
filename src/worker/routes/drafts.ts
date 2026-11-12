import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { DraftResponse, FeaturesResponse } from "../../shared/api.ts";
import { firstModelLink } from "../../shared/model-links.ts";
import { coachEnabled } from "../coach/run.ts";
import { itemDrafts, items } from "../db/schema.ts";
import { draftsEnabled, getPictures, runDraft, startDraft, toApiDraft, undoDraft } from "../draft/run.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { labelReadsEnabled } from "../label-read/run.ts";
import { photoReadsEnabled } from "../photo-read/run.ts";
import { suggestionsEnabled } from "../shopping/suggest.ts";
import { secretKeySource } from "../webhooks/secrets.ts";

const body = z.object({ url: z.string().max(2000).optional(), sharedTitle: z.string().max(200).optional() });

/**
 * Claude drafting an idea from a model page (decision 0019). People only, like link previews (nothing here is in
 * auth/scopes.ts): an agent's token never starts one. Without ANTHROPIC_API_KEY the endpoints answer 404 and the
 * app never offers them.
 */
export const draftRoutes = new Hono<AppEnv>()
  .get("/features", (c) =>
    c.json<FeaturesResponse>({
      drafts: draftsEnabled(c.env),
      photoReads: photoReadsEnabled(c.env),
      labelReads: labelReadsEnabled(c.env),
      priceSuggestions: suggestionsEnabled(c.env),
      coach: coachEnabled(c.env),
      webhooks: Boolean(secretKeySource(c.env)),
    }),
  )
  /**
   * Asks for the draft and, because the browser keeps this request open, does it here: an Opus call that reads a
   * page can outlast what waitUntil allows. If the browser goes away first, the cron picks the job up.
   */
  .post("/items/:id/draft", async (c) => {
    if (!draftsEnabled(c.env)) return apiError(c, 404, "not_found", "Drafting isn't set up.");
    const id = c.req.param("id");
    const db = c.var.db;
    const item = await db
      .select()
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .get();
    if (!item) return apiError(c, 404, "not_found", "That isn't here any more.");
    const parsed = body.safeParse(await c.req.json().catch(() => ({})));
    const link = parsed.success && parsed.data.url ? { url: parsed.data.url } : firstModelLink(item.note);
    if (!link) return apiError(c, 400, "invalid", "There's no MakerWorld, Printables or Thingiverse link to read.");
    const started = await startDraft(
      db,
      id,
      link.url,
      c.var.user,
      // Only a title that is still exactly the one that came with the share counts as shared.
      parsed.success && parsed.data.sharedTitle && parsed.data.sharedTitle === item.title ? item.title : null,
    );
    const current = await db.select().from(itemDrafts).where(eq(itemDrafts.itemId, id)).get();
    // Nothing started and nothing there: the link isn't a model page.
    if (!started && !current)
      return apiError(c, 400, "invalid", "That isn't a MakerWorld, Printables or Thingiverse link.");
    if (started || current?.status === "reading") await runDraft(c.env, id, db);
    const row = await db.select().from(itemDrafts).where(eq(itemDrafts.itemId, id)).get();
    return c.json<DraftResponse>({ draft: toApiDraft(row) });
  })
  /** "Get the pictures": for a drafted idea without any, tries the page's pictures again. */
  .post("/items/:id/draft/pictures", async (c) => {
    if (!draftsEnabled(c.env)) return apiError(c, 404, "not_found", "Drafting isn't set up.");
    const id = c.req.param("id");
    const stored = await getPictures(c.env, c.var.db, id, c.var.user);
    if (stored === null) return apiError(c, 404, "not_found", "There's nothing to fetch pictures for.");
    const row = await c.var.db.select().from(itemDrafts).where(eq(itemDrafts.itemId, id)).get();
    return c.json<DraftResponse>({ draft: toApiDraft(row), stored });
  })
  /** Undo: takes back what the draft wrote, as long as it is still what's there. */
  .delete("/items/:id/draft", async (c) => {
    if (!draftsEnabled(c.env)) return apiError(c, 404, "not_found", "Drafting isn't set up.");
    const done = await undoDraft(c.var.db, c.req.param("id"), c.var.user);
    if (!done) return apiError(c, 404, "not_found", "There's no draft to take back.");
    return c.json<DraftResponse>({ draft: null });
  });

/** For the OpenAPI document (worker/openapi). */
export { body as draftBody };
