import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { InsightsResponse } from "../../shared/api.ts";
import { computeInsights } from "../../shared/insights.ts";
import { attempts, items, photos, tags } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";

const query = z.object({
  year: z.coerce.number().int().min(2000).max(2200).optional(),
  /** The viewer's zone in minutes behind UTC (`Date.getTimezoneOffset()`). */
  tz: z.coerce.number().int().min(-840).max(840).optional(),
});

/** The year so far, computed from attempts (nothing about it is stored). */
export const insightRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const parsed = query.safeParse(c.req.query());
  if (!parsed.success) return apiError(c, 400, "invalid", "That year or time zone isn't one I know.");
  const tz = parsed.data.tz ?? 0;
  const year = parsed.data.year ?? new Date(Date.now() - tz * 60_000).getUTCFullYear();
  const { db } = c.var;

  const [rows, builds, pictures, custom] = await Promise.all([
    db
      .select({
        id: attempts.id,
        itemId: attempts.itemId,
        outcome: attempts.outcome,
        printedAt: attempts.printedAt,
        createdAt: attempts.createdAt,
        failureTags: attempts.failureTags,
        settings: attempts.settings,
      })
      .from(attempts)
      .innerJoin(items, eq(items.id, attempts.itemId))
      .where(and(isNull(attempts.deletedAt), isNull(items.deletedAt))),
    db
      .select({ id: items.id, title: items.title, coverPhotoId: items.coverPhotoId })
      .from(items)
      .where(isNull(items.deletedAt)),
    db
      .select({
        id: photos.id,
        itemId: photos.itemId,
        attemptId: photos.attemptId,
        color: photos.color,
        createdAt: photos.createdAt,
      })
      .from(photos)
      .where(isNull(photos.deletedAt)),
    db.select({ kind: tags.kind, slug: tags.slug, label: tags.label }).from(tags),
  ]);

  const insights = computeInsights(
    rows.map((row) => ({ ...row, printedAt: row.printedAt.getTime(), createdAt: row.createdAt.getTime() })),
    new Map(builds.map((build) => [build.id, { title: build.title, coverPhotoId: build.coverPhotoId }])),
    pictures.map((photo) => ({ ...photo, createdAt: photo.createdAt.getTime() })),
    year,
    tz,
    custom.filter((tag) => tag.kind === "failure"),
  );
  return c.json<InsightsResponse>({ insights });
});
