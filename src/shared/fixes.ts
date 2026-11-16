/**
 * "What fixed it": for a failure that a search found ("warping"), the later attempt on the same build that went
 * better without the problem coming back. Pure, so the Worker's search and the tests read it the same way.
 */
import type { Outcome } from "./outcomes.ts";

/** What the rule needs to know of an attempt. */
export interface FixableAttempt {
  id: string;
  /** Null while printing, or while it waits to hear how it went: not an answer yet. */
  outcome: Outcome | null;
  printedAt: number;
  createdAt: number;
}

/** How well it went: spaghetti, then partly, then worked. */
const RANK: Record<Outcome, number> = { failed: 0, partial: 1, success: 2 };

/** A failure (spaghetti or partly): something to learn from. */
export const isFailure = (outcome: Outcome | null): outcome is "failed" | "partial" =>
  outcome === "failed" || outcome === "partial";

/** Attempts in the order they were printed (as `byPrintTime`, kept here so this file stays small). */
function printOrder<T extends FixableAttempt>(attempts: readonly T[]): T[] {
  return [...attempts].sort((a, b) => a.printedAt - b.printedAt || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/**
 * The attempt that fixed this failure: the first one printed after it on the same build that went better (partly
 * after spaghetti, worked after either) and didn't have the same problem again. `repeats` says whether an attempt
 * had it (the failure tag or the words the search was for); one that worked is a fix whatever its note says
 * ("no warping at all"). Null when nothing after it went better: still printing, the same again, or worse.
 */
export function pickFix<T extends FixableAttempt>(
  build: readonly T[],
  failure: FixableAttempt,
  repeats: (attempt: T) => boolean = () => false,
): T | null {
  if (!isFailure(failure.outcome)) return null;
  const rank = RANK[failure.outcome];
  const ordered = printOrder([...build.filter((attempt) => attempt.id !== failure.id), failure as T]);
  const later = ordered.slice(ordered.findIndex((attempt) => attempt.id === failure.id) + 1);
  return (
    later.find(
      (attempt) =>
        attempt.outcome !== null &&
        RANK[attempt.outcome] > rank &&
        (attempt.outcome === "success" || !repeats(attempt)),
    ) ?? null
  );
}

/** A fix and the failures it came after, the latest last. */
export interface Fix<T extends FixableAttempt> {
  fix: T;
  after: T[];
}

/**
 * The fixes for failures a search found, one per fixing attempt (two failures fixed by the same print are one fix),
 * in the order of the failure that first led to each. `attemptsOf` gives a failure's build's attempts.
 */
export function findFixes<T extends FixableAttempt>(
  failures: readonly T[],
  attemptsOf: (failure: T) => readonly T[],
  repeats?: (attempt: T) => boolean,
): Array<Fix<T>> {
  const fixes = new Map<string, Fix<T>>();
  for (const failure of failures) {
    const fix = pickFix(attemptsOf(failure), failure, repeats);
    if (!fix) continue;
    const known = fixes.get(fix.id);
    if (known) known.after = printOrder([...known.after, failure]);
    else fixes.set(fix.id, { fix, after: [failure] });
  }
  return [...fixes.values()];
}
