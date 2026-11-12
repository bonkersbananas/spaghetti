/**
 * The outcome names, apart from attempts.ts and journal.ts (which are big) so the route files that read search
 * params at start-up can check them without pulling those into every screen's first load.
 */

/** How an attempt went. A printing attempt has no outcome yet (null). */
export const OUTCOMES = ["success", "partial", "failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * The outcome filter: one outcome, or "failures" (spaghetti and partly: every
 * attempt with something to learn from).
 */
export const OUTCOME_FILTERS = ["failures", ...OUTCOMES] as const;
export type OutcomeFilter = (typeof OUTCOME_FILTERS)[number];
