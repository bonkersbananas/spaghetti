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
  /** The names the printer gave the prints already in it (its attempts from the printer), newest first. */
  prints?: CandidatePrint[];
}

/** A print already in a candidate: the job's name as the printer said it, and which attempt it is. */
export interface CandidatePrint {
  name: string;
  attempt: number;
}

/** One reason a print may belong to a build, as a person would check it. */
export type MatchReason =
  /** The print's file says it is this one of ours (sliced here, the bridge read it). */
  | { kind: "marker"; file: string }
  /** The same file by name (copies such as "(2)" count): kept with the build, or printed in attempt N. */
  | { kind: "file"; file: string; attempt?: number }
  /** A file whose name shares most of its words with the print's. */
  | { kind: "like-file"; file: string }
  /** An earlier print in this build had the same name (copies and versions aside), or (`like`) one much like it. */
  | { kind: "printed"; name: string; attempt: number; like?: boolean }
  /** Claude's pick when the matcher wasn't sure (decision 0080): never scored, never placed without a person's yes. */
  | { kind: "claude"; why: string }
  /** The build's title is the print's name. */
  | { kind: "title" }
  /** The build's title shares most of its words with the print's name. */
  | { kind: "words" }
  /**
   * One of its files was downloaded or opened in Bambu Studio this long before the print began; `unrelated` when its
   * name has nothing in common with the print's (likely another print's file, so it counts for little).
   */
  | { kind: "sent"; file: string; how: SendHow; minutes: number; unrelated?: boolean }
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
  /** An earlier print of the build had the same name, or one much like it. */
  printed: 55,
  likePrinted: 30,
  title: 45,
  words: 20,
  sentSoon: 45,
  sentHours: 25,
  sentDay: 10,
  /** A file taken away just before whose name has nothing in common with the print's: it was likely another. */
  sentUnrelated: 10,
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

/** A name that says nothing about the thing: "Untitled", "Model", "Part 2" (a copy of one is no better). */
const meaningless = (key: string) => MEANINGLESS.has(key) || MEANINGLESS.has(withoutCopyNumber(key));

/** Words a print's name gains on the way to the printer that say nothing about what it is ("…-print", "…_final"). */
const FILLER = new Set(["print", "prints", "printing", "printed", "final", "copy", "gcode"]);

/**
 * A key without its filler words and the copy numbers left at its end: "uobf glass marker v3 4 print" (from
 * "UOBF-glass-marker-v3(4)-print") is "uobf glass marker v3", the name of the file it was sliced from.
 */
export function looseKey(key: string): string {
  let words = key.split(" ").filter((word) => word && !FILLER.has(word));
  while (words.length > 1 && /^\d{1,2}$/.test(words.at(-1) ?? "")) words = words.slice(0, -1);
  return words.join(" ");
}

/** "markers" → "marker", "boxes" → "box", "trays" → "tray", "assemblies" → "assembly"; "glass" stays. */
function stem(word: string): string {
  if (word.length <= 3 || /\d/.test(word)) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(x|ch|sh|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** A version ("v3", "v2b", "rev2", "ver3") or a bare number: what changes between tries of the same thing. */
const versionish = (word: string) => /^(v|rev|ver)?\d+[a-z]?$/.test(word);

/**
 * What a name is about, as words: no filler, no versions or numbers, each word in its simplest form. "UOBF glass
 * markers" and "UOBF-glass-marker-v3(4)-print" are both "uobf glass marker".
 */
export function coreKey(key: string): string {
  return looseKey(key)
    .split(" ")
    .filter((word) => word && !versionish(word) && !FILLER.has(word))
    .map(stem)
    .join(" ");
}

/** Whether two names share at least one word of what they are about (no filler, versions or numbers). */
function related(a: string, b: string): boolean {
  const words = new Set(coreKey(a).split(" ").filter(Boolean));
  return coreKey(b)
    .split(" ")
    .some((word) => word && words.has(word));
}

/** How many of the words two keys have in common, over all their words (0–1). */
function overlap(a: string, b: string): number {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared);
}

/**
 * How well two names agree: the same key; the same but for a copy's number or filler ("ring-2", "…(4)-print"); or
 * about the same thing (the same words but for versions and plurals, or most words in common).
 */
function nameMatch(print: string, other: string, share: number): "same" | "variant" | "like" | null {
  if (!print || !other) return null;
  if (print === other) return "same";
  if (withoutCopyNumber(print) === other || print === withoutCopyNumber(other)) return "variant";
  const loose = looseKey(print);
  if (loose && loose === looseKey(other)) return "variant";
  const core = coreKey(print);
  const otherCore = coreKey(other);
  if (core && core === otherCore) return "like";
  if (alike(print, other, share) || (core && otherCore && alike(core, otherCore, share))) return "like";
  return null;
}

/** Shares most words: at least two of them, and three quarters of all (for a title, three fifths). */
function alike(a: string, b: string, share: number): boolean {
  const shared = a.split(" ").filter((word) => word && b.split(" ").includes(word)).length;
  return shared >= 2 && overlap(a, b) >= share;
}

/** A file taken away this long before the print, whose name agrees with the print's (or the print has none). */
function sendPoints(minutes: number, unrelated = false): number {
  if (unrelated) return minutes <= 30 ? POINTS.sentUnrelated : 0;
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
      return sendPoints(reason.minutes, reason.unrelated);
    case "printed":
      return reason.like ? POINTS.likePrinted : POINTS.printed;
    case "claude":
      return 1000;
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
  const named = !meaningless(key);
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
      if (meaningless(fileKey)) continue;
      const how = nameMatch(key, fileKey, 0.75);
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

  // The prints already in it, as the printer named them: a print named like them is very likely the next of them.
  if (named && candidate.prints?.length) {
    let best: { print: CandidatePrint; like: boolean } | null = null;
    for (const earlier of candidate.prints) {
      const earlierKey = printKey(earlier.name);
      if (meaningless(earlierKey)) continue;
      const how = nameMatch(key, earlierKey, 0.75);
      // The newest of the best: they come newest first.
      if (how && (!best || (best.like && how !== "like"))) best = { print: earlier, like: how === "like" };
    }
    if (best) {
      reasons.push({
        kind: "printed",
        name: best.print.name,
        attempt: best.print.attempt,
        ...(best.like ? { like: true } : {}),
      });
      score += best.like ? POINTS.likePrinted : POINTS.printed;
    }
  }

  if (named) {
    const titleKey = printKey(candidate.title);
    if (titleKey && !meaningless(titleKey)) {
      const how = nameMatch(key, titleKey, 0.6);
      // The same words but for versions and plurals ("UOBF glass markers" for "UOBF-glass-marker-v3") is its name.
      if (how && (how !== "like" || coreKey(key) === coreKey(titleKey))) {
        reasons.push({ kind: "title" });
        score += POINTS.title;
      } else if (how) {
        reasons.push({ kind: "words" });
        score += POINTS.words;
      }
    }
  }

  // Its file taken away before the print began that says the most (a minute's leeway for the two clocks): one whose
  // name has nothing in common with a named print's was most likely meant for another print, and counts for little.
  let sent: { send: CandidateSend; file: CandidateFile; minutes: number; unrelated: boolean; points: number } | null =
    null;
  for (const send of candidate.sends) {
    const file = candidate.files.find((one) => one.id === send.fileId);
    if (!file || send.at > print.startedAt + MINUTE) continue;
    const minutes = Math.max(0, Math.round((print.startedAt - send.at) / MINUTE));
    const fileKey = printKey(file.name);
    const unrelated = named && !meaningless(fileKey) && !related(key, fileKey);
    const points = sendPoints(minutes, unrelated);
    if (points && (!sent || points > sent.points || (points === sent.points && send.at > sent.send.at))) {
      sent = { send, file, minutes, unrelated, points };
    }
  }
  if (sent) {
    reasons.push({
      kind: "sent",
      file: sent.file.name,
      how: sent.send.how,
      minutes: sent.minutes,
      ...(sent.unrelated ? { unrelated: true } : {}),
    });
    score += sent.points;
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

/**
 * Every candidate with something going for it, best first. Ties: a build in progress before an idea, then the one
 * started last, then the one with fewer attempts, then by id (so the order never changes between two looks).
 */
export function scorePrint(print: PrintFacts, candidates: readonly MatchCandidate[]): ScoredCandidate[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const building = (id: string) => (byId.get(id)?.stage === "building" ? 1 : 0);
  const started = (id: string) => byId.get(id)?.startedAt ?? 0;
  return candidates
    .map((candidate) => scoreCandidate(print, candidate))
    .filter((scored) => scored.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        building(b.itemId) - building(a.itemId) ||
        started(b.itemId) - started(a.itemId) ||
        (byId.get(a.itemId)?.attempts ?? 0) - (byId.get(b.itemId)?.attempts ?? 0) ||
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
 * A file's name as people see it: no folder and no slicer's ending, its own spelling kept. "UOBF-fit-test-ring.3mf"
 * is "UOBF-fit-test-ring", "/cache/bath-boat.gcode.3mf" is "bath-boat".
 */
export function shownName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? name;
  return last.replace(/\.(gcode\.3mf|3mf|gcode|bgcode|stl|step|stp|obj)$/i, "").trim() || last;
}

/**
 * A build's title from a print's name, as a person would write it, for the build the printer makes: no folder, no
 * slicer's ending and no copy number Bambu Studio adds ("(2)"), hyphens and underscores as spaces, the first letter a
 * capital and every other letter as it was. "UOBF-fit-test-ring(2)" is "UOBF fit test ring",
 * "spaghetti-mascot-tomato-40mm-v2(2)" is "Spaghetti mascot tomato 40mm v2". Only a number in parentheses at the end
 * is a copy: "Smiley Box (print in place)" stays as it is. Null when nothing is left (titles are optional). Only the
 * title: the print is matched on its name as the printer said it (`printKey`).
 */
export function readableTitle(name: string): string | null {
  const last = name.split(/[\\/]/).pop() ?? name;
  const words = last
    .replace(/\.(gcode\.3mf|3mf|gcode|bgcode|stl|step|stp|obj)$/i, "")
    .replace(/(\s*\(\d+\))+\s*$/, "")
    .replace(/[-_\s]+/g, " ")
    .trim();
  return words ? words.charAt(0).toLocaleUpperCase() + words.slice(1) : null;
}

/** The file names a reason names, as people see them (for keeping each whole on a line). */
export function namesIn(reasons: readonly MatchReason[]): string[] {
  return reasons.flatMap((reason) =>
    "file" in reason ? [shownName(reason.file)] : reason.kind === "printed" ? [shownName(reason.name)] : [],
  );
}

/**
 * Why the app filed a print in the build it is in, as one sentence: "Filed here: it printed bath-boat, this build's
 * file." The strongest reason, and with it when that same file was taken away just before ("…, opened in Bambu Studio
 * just before it began."). A matching estimate or a fresh start only backs a name up, so they are never said alone.
 */
export function filedWords(reasons: readonly MatchReason[]): string {
  const [first, second] = reasons;
  if (!first) return "";
  let lead: string;
  switch (first.kind) {
    case "marker":
      lead = `it printed ${shownName(first.file)}, sliced here for this build`;
      break;
    case "file":
      lead = first.attempt
        ? `it printed ${shownName(first.file)}, as attempt ${first.attempt} did`
        : `it printed ${shownName(first.file)}, this build's file`;
      break;
    case "like-file":
      lead = `its file is named much like ${shownName(first.file)}, this build's`;
      break;
    case "printed":
      lead = first.like
        ? `its name is much like attempt ${first.attempt}'s, ${shownName(first.name)}`
        : `attempt ${first.attempt} had the same name, ${shownName(first.name)}`;
      break;
    case "claude":
      lead = `Claude thought so, ${claudeWhy(first.why)}`;
      break;
    case "title":
      lead = "it has this build's name";
      break;
    case "words":
      lead = "its name is much like this build's";
      break;
    case "sent":
      lead = `${shownName(first.file)} was ${sentWords(first.how)} ${before(first.minutes)}`;
      break;
    case "estimate":
      lead = `it takes as long as ${shownName(first.file)}`;
      break;
    case "fresh":
      lead = "this build was started just before";
      break;
  }
  if (second?.kind === "sent" && (first.kind === "file" || first.kind === "marker") && second.file === first.file) {
    lead += `, ${sentWords(second.how)} ${before(second.minutes)}`;
  }
  return `Filed here: ${lead}.`;
}

/** Claude's few words of why, to follow a colon: no full stop, the first letter small unless it starts a name. */
export function claudeWhy(why: string): string {
  const words = why.trim().replace(/[.!]+$/, "");
  return /^\p{Lu}\p{Ll}/u.test(words) ? words.charAt(0).toLowerCase() + words.slice(1) : words;
}

/** Why a build is offered for a print, in a few words for its row: "Same file: planter-v2", "Same name". */
export function rowWords(reasons: readonly MatchReason[]): string {
  const first = reasons[0];
  if (!first) return "";
  switch (first.kind) {
    case "marker":
      return `Sliced here: ${shownName(first.file)}`;
    case "file":
      return first.attempt
        ? `Attempt ${first.attempt} printed ${shownName(first.file)}`
        : `Same file: ${shownName(first.file)}`;
    case "like-file":
      return `A file named like it: ${shownName(first.file)}`;
    case "printed":
      return first.like ? `Named like attempt ${first.attempt}` : `Same name as attempt ${first.attempt}`;
    case "claude":
      return `Claude thinks so: ${claudeWhy(first.why)}`;
    case "title":
      return "Same name";
    case "words":
      return "A name much like it";
    case "sent":
      return `${first.how === "studio" ? "Opened in Bambu Studio" : "Downloaded"} ${before(first.minutes)}`;
    case "estimate":
      return `As long as ${shownName(first.file)}`;
    case "fresh":
      return "Started just before";
  }
}

/**
 * What every offered build has going for it, said once over all of them ("Both print planter-v2.", "All three have
 * its name."), so each row can say what sets it apart; null when their strongest reasons differ.
 */
export function sharedWords(offers: ReadonlyArray<{ reasons: readonly MatchReason[] }>): string | null {
  if (offers.length < 2) return null;
  const firsts = offers.map((offer) => offer.reasons[0]);
  const who = offers.length === 2 ? "Both" : offers.length === 3 ? "All three" : `All ${offers.length}`;
  const head = firsts[0];
  if (!head) return null;
  const fileOf = (reason: MatchReason | undefined) =>
    reason && (reason.kind === "file" || reason.kind === "marker") ? shownName(reason.file).toLowerCase() : null;
  const file = fileOf(head);
  if (file && firsts.every((reason) => fileOf(reason) === file)) return `${who} print ${shownName(firstFile(head))}.`;
  if (firsts.every((reason) => reason?.kind === "title")) return `${who} have its name.`;
  return null;
}

const firstFile = (reason: MatchReason) => ("file" in reason ? reason.file : "");
