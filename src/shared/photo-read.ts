/**
 * Claude glancing at an attempt's photo and suggesting how it went (docs/decisions/0023). It only ever suggests: the
 * attempt keeps no outcome until a person picks one, and the picked outcome and tags are the person's.
 */
import { FAILURE_TAGS, OUTCOMES, type Outcome, SUCCESS_NOTES, tagLabel } from "./attempts.ts";

/** Per day, for the whole workspace (people's photos and the printer bridge's frame both count). */
export const PHOTO_READS_PER_DAY = 30;

/** What the attempt shows of a read: "reading" while Claude looks, "read" once it has a suggestion. A photo it couldn't tell from shows nothing. */
export interface PhotoRead {
  status: "reading" | "read";
  /** The photo it looked at (the newest one wins). */
  photoId: string;
  outcome: Outcome | null;
  /** Slugs from the built-in lists only. */
  failureTags: string[];
  successNotes: string[];
  /** One short, friendly sentence of why. */
  reason: string | null;
}

export const FAILURE_SLUGS = FAILURE_TAGS.map((tag) => tag.slug);
export const SUCCESS_SLUGS = SUCCESS_NOTES.map((tag) => tag.slug);
export { OUTCOMES };

/** The suggestion's tags as words, for the chips under the picker: failure tags unless it worked, success notes unless it failed. */
export function suggestedTagWords(
  read: Pick<PhotoRead, "outcome" | "failureTags" | "successNotes">,
): Array<{ kind: "failure" | "success"; label: string }> {
  return [
    ...(read.outcome !== "success"
      ? read.failureTags.map((slug) => ({ kind: "failure" as const, label: tagLabel("failure", slug) }))
      : []),
    ...(read.outcome !== "failed"
      ? read.successNotes.map((slug) => ({ kind: "success" as const, label: tagLabel("success", slug) }))
      : []),
  ];
}

/** What the person's answer takes along when it is picked: the tags as they now stand, only where they change. */
export interface TakenWith {
  failureTags?: string[];
  successNotes?: string[];
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((slug) => b.includes(slug));

/**
 * The tags an answer to "How did it go?" brings along (decision 0023). Claude's suggested tags and success notes come
 * only with the outcome Claude suggested: picking another outcome is just picking, and they stay offered, marked, one
 * tap each. The printer's suggested failure tag (Spaghetti, or Other for a print that stopped) comes only with the
 * Spaghetti answer, like Claude's: on another it stays offered, marked. Nothing is ever added over what the
 * person already chose; leaving an answer for another takes off what came along with it untouched (never a failure
 * tag on Worked, never a Spaghetti tag on Partly unless the person took it).
 */
export function takenWith(
  picked: Outcome,
  before: { outcome: Outcome | null; failureTags: readonly string[]; successNotes: readonly string[] },
  suggestion: {
    read: Pick<PhotoRead, "outcome" | "failureTags" | "successNotes"> | null;
    printerTag: string | null;
  },
): TakenWith {
  const { read, printerTag } = suggestion;
  let failureTags = [...before.failureTags];
  let successNotes = [...before.successNotes];
  // What came with the previous answer, untouched since, goes with it.
  if (before.outcome && before.outcome !== picked) {
    if (read?.outcome === before.outcome) {
      if (failureTags.length && sameSet(failureTags, read.failureTags)) failureTags = [];
      if (successNotes.length && sameSet(successNotes, read.successNotes)) successNotes = [];
    }
    if (picked !== "failed" && printerTag && sameSet(failureTags, [printerTag])) failureTags = [];
  }
  const claude = read?.outcome === picked ? read : null;
  if (picked !== "success" && failureTags.length === 0) {
    if (claude?.failureTags.length) failureTags = [...claude.failureTags];
    else if (picked === "failed" && printerTag) failureTags = [printerTag];
  }
  if (picked !== "failed" && successNotes.length === 0 && claude?.successNotes.length)
    successNotes = [...claude.successNotes];
  return {
    ...(sameSet(failureTags, before.failureTags) ? {} : { failureTags }),
    ...(sameSet(successNotes, before.successNotes) ? {} : { successNotes }),
  };
}
