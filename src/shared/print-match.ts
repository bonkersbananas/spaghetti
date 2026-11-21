/**
 * Which build a print the printer bridge saw belongs to (decision 0076). Pure: the Worker runs it when the bridge
 * files a print and when someone asks "which build is this?"; the screens use its words for the reason.
 *
 * Everything it knows is something a person could check: the print's name against the builds' files and titles, a
 * file downloaded or opened in Bambu Studio just before the print began, the printer's estimate against the file's,
 * and a build that was started moments before with nothing printed yet. Each counts for points; the reasons are kept
 * with the score so the app can say why it guessed. One build well ahead of the rest is a match and the print goes
 * there; a few close ones are suggestions to pick from; nothing is nothing, and the print starts a build of its own.
 */
import type { ItemStage } from "./api.ts";

const MINUTE = 60_000;

/** What the printer said about a print. */
export interface PrintFacts {
  /** The job's name as the printer reports it ("UOBF-fit-test-ring(2)"), or a file's name. */
  name: string | null;
  /** When it began, epoch ms. */
  startedAt: number;
  /** The printer's own estimate at the start, minutes (newer bridges send it). */
  estimateMinutes?: number | null;
  /** The id of the Spaghetti file the print's .gcode.3mf says it came from (only when the bridge read the file). */
  fileId?: string | null;
}

/** A file a candidate holds: kept with it, or printed in one of its attempts. */
export interface CandidateFile {
  id: string;
  name: string;
  /** The slicer's estimate, when the file said. */
  estimatedMinutes?: number | null;
  /** Set for an attempt's file: which attempt printed it. */
  attempt?: number;
}

/** A file of a candidate that someone took away to print: downloaded, or opened in Bambu Studio. */
export interface CandidateSend {
  fileId: string;
  at: number;
  how: SendHow;
}

export type SendHow = "download" | "studio";

/** An idea or a build in progress that a print might belong to. */
export interface MatchCandidate {
  id: string;
  title: string | null;
  stage: ItemStage;
  /** When it became a build. */
  startedAt: number | null;
  /** How many attempts it has, not counting deleted ones. */
  attempts: number;
  files: CandidateFile[];
  sends: CandidateSend[];
}

/** One reason a print may belong to a build, as a person would check it. */
export type MatchReason =
  /** The print's file says it is this one of ours (sliced here, the bridge read it). */
  | { kind: "marker"; file: string }
  /** The same file by name (copies such as "(2)" count): kept with the build, or printed in attempt N. */
  | { kind: "file"; file: string; attempt?: number }
  /** A file whose name shares most of its words with the print's. */
  | { kind: "like-file"; file: string }
  /** The build's title is the print's name. */
  | { kind: "title" }
  /** The build's title shares most of its words with the print's name. */
  | { kind: "words" }
  /** One of its files was downloaded or opened in Bambu Studio this long before the print began. */
  | { kind: "sent"; file: string; how: SendHow; minutes: number }
  /** The printer's estimate is the file's, give or take a little. */
  | { kind: "estimate"; file: string; minutes: number }
  /** Started (or last touched) just before the print, with nothing printed yet. */
  | { kind: "fresh" };

export interface ScoredCandidate {
  itemId: string;
  score: number;
  /** Strongest first. */
  reasons: MatchReason[];
}

/** Where a print goes: straight into one build, a few to choose from, or none that fits. */
export type Placement =
  | { kind: "match"; best: ScoredCandidate }
  | { kind: "ask"; suggestions: ScoredCandidate[] }
  | { kind: "none" };

/** The points each reason is worth. A name and a fresh start (70) is a match; a name alone (60) asks. */
export const POINTS = {
  marker: 100,
  file: 60,
  /** A copy whose name only adds a number ("ring-2"): very likely, not certain. */
  fileVariant: 50,
  likeFile: 25,
  title: 45,
  words: 20,
  sentSoon: 45,
  sentHours: 25,
  sentDay: 10,
  estimate: 15,
  fresh: 10,
} as const;

/** A match needs this many points, and this lead over the next build. */
export const MATCH_SCORE = 70;
export const MATCH_LEAD = 30;
/** A suggestion needs this many points; at most this many are offered. */
export const SUGGEST_SCORE = 25;
export const MAX_SUGGESTIONS = 3;

/** Names that say nothing about what is printed. */
const MEANINGLESS = new Set(["", "untitled", "model", "plate", "print", "project", "new project", "object", "part"]);

/**
 * A print's or a file's name as one comparable key: the last part of a path, no extension (.gcode.3mf, .3mf, .gcode,
 * .stl, .step, .obj), no copy suffix ("(2)", " (1)", " copy"), no "_plate_2", no accents (UÖBF → uobf), lower case,
 * and any run of separators one space. "UOBF-fit-test-ring(2)" and "UOBF-fit-test-ring.3mf" are both
 * "uobf fit test ring".
 */
export function printKey(name: string | null | undefined): string {
  if (!name) return "";
  let key = name.replace(/^.*[\\/]/, "").trim();
  for (let round = 0; round < 4; round++) {
    const before = key;
    key = key
      .replace(/\.(gcode\.3mf|3mf|gcode|bgcode|stl|step|stp|obj)$/i, "")
      .replace(/\s*\(\d{1,3}\)$/, "")
      .replace(/[\s_-]*copy(\s*\d{1,3})?$/i, "")
      .replace(/[\s_-]*plate[\s_-]*\d{1,3}$/i, "")
      .trim();
    if (key === before) break;
  }
  return key
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** "uobf fit test ring 2" → "uobf fit test ring": a trailing small number some browsers add to a copy ("ring-2"). */
const withoutCopyNumber = (key: string) => key.replace(/ (\d{1,2})$/, "");

/** How many of the words two keys have in common, over all their words (0–1). */
function overlap(a: string, b: string): number {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared);
}

/** Two names for the same thing: the same key, or one is the other plus a copy's number. */
function sameName(print: string, file: string): "same" | "variant" | null {
  if (!print || !file) return null;
  if (print === file) return "same";
  if (withoutCopyNumber(print) === file || print === withoutCopyNumber(file)) return "variant";
  return null;
}

/** Shares most words: at least two of them, and three quarters of all (for a title, three fifths). */
function alike(a: string, b: string, share: number): boolean {
  const shared = a.split(" ").filter((word) => word && b.split(" ").includes(word)).length;
  return shared >= 2 && overlap(a, b) >= share;
}

function sendPoints(minutes: number): number {
  if (minutes <= 30) return POINTS.sentSoon;
  if (minutes <= 3 * 60) return POINTS.sentHours;
  if (minutes <= 24 * 60) return POINTS.sentDay;
  return 0;
}

const reasonWeight = (reason: MatchReason): number => {
  switch (reason.kind) {
    case "marker":
      return POINTS.marker;
    case "file":
      return POINTS.file;
    case "sent":
      return sendPoints(reason.minutes);
    case "title":
      return POINTS.title;
    case "like-file":
      return POINTS.likeFile;
    case "words":
      return POINTS.words;
    case "estimate":
      return POINTS.estimate;
    case "fresh":
      return POINTS.fresh;
  }
};

/** One candidate's score and reasons for this print. */
export function scoreCandidate(print: PrintFacts, candidate: MatchCandidate): ScoredCandidate {
  const key = printKey(print.name);
  const named = !MEANINGLESS.has(key);
  const reasons: MatchReason[] = [];
  let score = 0;

  const marked = print.fileId ? candidate.files.find((file) => file.id === print.fileId) : undefined;
  if (marked) {
    reasons.push({ kind: "marker", file: marked.name });
    score += POINTS.marker;
  }

  // The best name among its files: the same file beats a copy of it, which beats one named much like it.
  if (named && !marked) {
    let best: { file: CandidateFile; how: "same" | "variant" | "like" } | null = null;
    const rank = { same: 3, variant: 2, like: 1 } as const;
    for (const file of candidate.files) {
      const fileKey = printKey(file.name);
      const how = sameName(key, fileKey) ?? (alike(key, fileKey, 0.75) ? "like" : null);
      // A file kept with the build counts before an attempt's, and a later attempt before an earlier one.
      if (how && (!best || rank[how] > rank[best.how])) best = { file, how };
    }
    if (best?.how === "same" || best?.how === "variant") {
      reasons.push({
        kind: "file",
        file: best.file.name,
        ...(best.file.attempt ? { attempt: best.file.attempt } : {}),
      });
      score += best.how === "same" ? POINTS.file : POINTS.fileVariant;
    } else if (best?.how === "like") {
      reasons.push({ kind: "like-file", file: best.file.name });
      score += POINTS.likeFile;
    }
  }

  if (named) {
    const titleKey = printKey(candidate.title);
    if (titleKey && !MEANINGLESS.has(titleKey)) {
      if (sameName(key, titleKey)) {
        reasons.push({ kind: "title" });
        score += POINTS.title;
      } else if (alike(key, titleKey, 0.6)) {
        reasons.push({ kind: "words" });
        score += POINTS.words;
      }
    }
  }

  // The latest of its files taken away before the print began (a minute's leeway for the two clocks).
  const sent = candidate.sends.filter((send) => send.at <= print.startedAt + MINUTE).sort((a, b) => b.at - a.at)[0];
  const sentFile = sent && candidate.files.find((file) => file.id === sent.fileId);
  if (sent && sentFile) {
    const minutes = Math.max(0, Math.round((print.startedAt - sent.at) / MINUTE));
    const points = sendPoints(minutes);
    if (points) {
      reasons.push({ kind: "sent", file: sentFile.name, how: sent.how, minutes });
      score += points;
    }
  }

  const estimate = print.estimateMinutes;
  if (estimate && estimate > 0) {
    const close = candidate.files.find(
      (file) =>
        file.estimatedMinutes && Math.abs(file.estimatedMinutes - estimate) <= Math.max(2, file.estimatedMinutes * 0.1),
    );
    if (close?.estimatedMinutes) {
      reasons.push({ kind: "estimate", file: close.name, minutes: close.estimatedMinutes });
      score += POINTS.estimate;
    }
  }

  // A build started moments before, with nothing printed in it yet, is what someone is about to print.
  if (
    candidate.stage === "building" &&
    candidate.attempts === 0 &&
    candidate.startedAt !== null &&
    candidate.startedAt <= print.startedAt + MINUTE &&
    print.startedAt - candidate.startedAt <= 2 * 60 * MINUTE &&
    score > 0
  ) {
    reasons.push({ kind: "fresh" });
    score += POINTS.fresh;
  }

  reasons.sort((a, b) => reasonWeight(b) - reasonWeight(a));
  return { itemId: candidate.id, score, reasons };
}

/** Every candidate with something going for it, best first (ties: the one with fewer attempts, then by id). */
export function scorePrint(print: PrintFacts, candidates: readonly MatchCandidate[]): ScoredCandidate[] {
  const attempts = new Map(candidates.map((candidate) => [candidate.id, candidate.attempts]));
  return candidates
    .map((candidate) => scoreCandidate(print, candidate))
    .filter((scored) => scored.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (attempts.get(a.itemId) ?? 0) - (attempts.get(b.itemId) ?? 0) ||
        a.itemId.localeCompare(b.itemId),
    );
}

/** One build well ahead is a match; a few with something going for them are suggestions; else nothing. */
export function placePrint(scored: readonly ScoredCandidate[]): Placement {
  const [best, next] = scored;
  if (best && best.score >= MATCH_SCORE && best.score - (next?.score ?? 0) >= MATCH_LEAD)
    return { kind: "match", best };
  const suggestions = scored.filter((candidate) => candidate.score >= SUGGEST_SCORE).slice(0, MAX_SUGGESTIONS);
  return suggestions.length ? { kind: "ask", suggestions } : { kind: "none" };
}

/** "2 min", "1 h 10 min", "a minute": how long before the print. */
function before(minutes: number): string {
  if (minutes < 1) return "just before it began";
  if (minutes === 1) return "a minute before it began";
  if (minutes < 60) return `${minutes} min before it began`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h${rest ? ` ${rest} min` : ""} before it began`;
}

const sentWords = (how: SendHow) => (how === "studio" ? "opened in Bambu Studio" : "downloaded");

/**
 * Why a print was put in a build, or is suggested for it, in one sentence: the strongest reason and the one after
 * it. "Same file as UOBF-fit-test-ring.3mf, opened in Bambu Studio a minute before it began." `brief` keeps to the
 * strongest (a card's line); a file's name is never capitalised.
 */
export function whyWords(reasons: readonly MatchReason[], { brief = false }: { brief?: boolean } = {}): string {
  const [first, second] = reasons;
  if (!first) return "";
  const lead = phrase(first, true);
  // Two reasons about one file are one thought: "Same file as X, downloaded 2 min before".
  if (second?.kind === "sent" && (first.kind === "file" || first.kind === "marker") && second.file === first.file) {
    return `${lead}, ${sentWords(second.how)} ${before(second.minutes)}.`;
  }
  // A matching estimate or a fresh start only backs up a name: said alone, they add nothing a person can check.
  if (brief || !second || second.kind === "estimate" || second.kind === "fresh") return `${lead}.`;
  return `${lead}; ${phrase(second, false)}.`;
}

/** The short label of a suggestion's strongest reason, for a chip: "Same file", "Opened in Bambu Studio". */
export function whyLabel(reasons: readonly MatchReason[]): string {
  const first = reasons[0];
  if (!first) return "";
  switch (first.kind) {
    case "marker":
    case "file":
      return "Same file";
    case "like-file":
      return "A file named like it";
    case "title":
      return "Same name";
    case "words":
      return "A name like it";
    case "sent":
      return first.how === "studio" ? "Opened in Bambu Studio" : "Downloaded";
    case "estimate":
      return "Same estimate";
    case "fresh":
      return "Just started";
  }
}

/** One reason in words, leading the sentence or following it; a file's name is never capitalised. */
function phrase(reason: MatchReason, lead: boolean): string {
  switch (reason.kind) {
    case "marker":
      return `${lead ? "The" : "the"} file is ${reason.file}, sliced here`;
    case "file":
      return `${lead ? "Same" : "same"} file as ${reason.attempt ? `attempt ${reason.attempt} (${reason.file})` : reason.file}`;
    case "like-file":
      return `${lead ? "A" : "a"} file named much like it, ${reason.file}`;
    case "title":
      return `${lead ? "The" : "the"} build has its name`;
    case "words":
      return `${lead ? "The" : "the"} build is named much like it`;
    case "sent":
      return lead
        ? `${reason.how === "studio" ? "Opened in Bambu Studio" : "Downloaded"} ${before(reason.minutes)}: ${reason.file}`
        : `${reason.file} was ${sentWords(reason.how)} ${before(reason.minutes)}`;
    case "estimate":
      return `${lead ? "The" : "the"} same estimate as ${reason.file}`;
    case "fresh":
      return lead ? "Started just before, with nothing printed yet" : "nothing printed in it yet";
  }
}
