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
