/**
 * Choices Today makes that both people must agree on, kept pure so the unit tests can cover them.
 */

/** Ideas this old are candidates for the back burner. */
export const BACK_BURNER_AFTER_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD in local time: the same for both people all day, and different tomorrow. */
export function localDay(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** A small, stable hash of a string (FNV-1a). */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

interface IdeaLike {
  id: string;
  stage: string;
  createdAt: number;
  /** Still only on this device. */
  pending?: boolean;
}

/**
 * One old idea comes back each day, so the inbox doesn't become a graveyard. The pick is the day's hash modulo
 * the candidates (ideas older than two weeks, oldest first, ties by id), so both people see the same idea all
 * day, whatever order their lists are in.
 */
export function backBurnerIdea<T extends IdeaLike>(ideas: readonly T[], now = Date.now()): T | undefined {
  const candidates = ideas
    .filter((idea) => idea.stage === "idea" && !idea.pending && now - idea.createdAt > BACK_BURNER_AFTER_DAYS * DAY)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  if (candidates.length === 0) return undefined;
  return candidates[hash(localDay(now)) % candidates.length];
}
