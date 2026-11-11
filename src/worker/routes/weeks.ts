import { Hono } from "hono";
import { z } from "zod";
import { isMonday, type WeekResponse } from "../../shared/week.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { loadWeek } from "../week/load.ts";
import { claimWeekNote, runWeekNote } from "../week/note.ts";

const params = z.object({ monday: z.string().refine(isMonday, "A Monday, as YYYY-MM-DD.") });

/**
 * One week of the notebook, worked out from what is in it (decision 0030): Monday to Sunday in the workspace's time
 * zone. Anyone who can read can read it. Asking for a week that is over (last week, or this one on Sunday evening)
 * that has no paragraph by Claude yet makes it, after the response; the page then says it is being written.
 */
export const weekRoutes = new Hono<AppEnv>().get("/:monday", async (c) => {
  const parsed = params.safeParse(c.req.param());
  if (!parsed.success) return apiError(c, 400, "invalid", "A week is named by its Monday, such as 2026-11-09.");
  const { monday } = parsed.data;
  const now = Date.now();
  if (await claimWeekNote(c.env, monday, now, c.var.db).catch(() => false)) {
    c.executionCtx.waitUntil(runWeekNote(c.env, monday, { now, db: c.var.db }));
  }
  return c.json<WeekResponse>({ week: await loadWeek(c.env, monday, now, c.var.db) });
});

export { params as weekParams };
