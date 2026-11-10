/**
 * Claude drafting an idea from a model page: the shapes both sides share (docs/decisions/0019). The draft is a row
 * of its own next to the idea; the idea's own fields are only ever filled when they were empty.
 */
import type { ModelSiteId } from "./model-links.ts";

/** Per day, for the whole workspace: a key can't run up a bill. */
export const DRAFTS_PER_DAY = 30;

/** Why a draft didn't come: each is shown as one honest line with a retry (the cap says it plainly). */
export type DraftFailure = "unreadable" | "refused" | "timeout" | "cap";

export const FAILURE_LINES: Record<DraftFailure, string> = {
  unreadable: "Claude couldn't read that page.",
  refused: "Claude couldn't draft that one.",
  timeout: "Reading the page took too long.",
  cap: "That's enough drafts for today. It starts fresh tomorrow.",
};

/** What Claude found on the page, when it said. All of it is optional: a page rarely says everything. */
export interface DraftFindings {
  designer: string | null;
  license: string | null;
  /** The suggested material, e.g. "PETG". */
  material: string | null;
  /** The plate it's meant for, e.g. "Textured PEI plate". */
  plate: string | null;
  /** The suggested print settings in a short plain sentence, e.g. "0.2 mm layers, 15% infill, no supports". */
  settings: string | null;
}

export interface ItemDraft {
  status: "reading" | "drafted" | "failed";
  site: ModelSiteId;
  /** The page it reads or read. */
  url: string;
  failure: DraftFailure | null;
  /** Which of the idea's own fields it filled; the text it wrote is `title` and `note`, so the screen can tell whether they are still untouched. */
  applied: Array<"title" | "note" | "photos">;
  title: string | null;
  note: string | null;
  findings: DraftFindings | null;
  /** When it was drafted (epoch ms). */
  draftedAt: number | null;
}
