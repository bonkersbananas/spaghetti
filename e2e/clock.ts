import { startOfZonedDay, zonedParts } from "../src/shared/week.ts";

const SPREAD = 5 * 60_000;

/**
 * A moment about `ago` ms before now (at most five minutes) that is still in the workspace's (Stockholm) day, and so
 * in its week: a print seeded "a minute ago" at 00:00:30 there would otherwise be yesterday's, or last week's on a
 * Monday, and a test asking for today's or this week's prints finds nothing. Seeds keep their order: shortly after
 * midnight the moments are spread over what the day has so far.
 */
export function recently(ago: number, now = Date.now()): number {
  const p = zonedParts(now);
  const day = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const room = Math.max(now - startOfZonedDay(day) - 1000, 0);
  return room >= SPREAD ? now - ago : now - Math.round((room * Math.min(ago, SPREAD)) / SPREAD);
}
