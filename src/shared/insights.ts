/**
 * The year so far: what a year of attempts says, in a few plain facts. Pure,
 * so the Worker computes it and the unit tests pin it down. Nothing here is
 * a score: it counts, and it names what people changed right before a print
 * that worked.
 */
import { type AttemptSettings, byPrintTime, diffSettings, type Outcome, plateName, tagLabel } from "./attempts.ts";
import { settingsMaterial } from "./recipes.ts";

/** What the computation needs of an attempt (plus its build's title for the longest builds). */
export interface InsightAttempt {
  id: string;
  itemId: string;
  outcome: Outcome | null;
  printedAt: number;
  createdAt: number;
  failureTags: readonly string[];
  settings: AttemptSettings;
}

export type OutcomeCounts = Record<Outcome, number>;

export interface MonthBar extends OutcomeCounts {
  /** 0 = January. */
  month: number;
}

export interface RateRow {
  /** "PLA", "Textured PEI". */
  label: string;
  /** Attempts with an outcome. */
  total: number;
  worked: number;
  /** Whole percent of those that worked. */
  percent: number;
}

export interface FixCount {
  /** "a brim", "a warmer bed". */
  phrase: string;
  count: number;
}

export interface FailureInsight {
  slug: string;
  label: string;
  /** Attempts that went wrong with this tag. */
  count: number;
  /** The changes that most often came right before an attempt that worked. */
  fixes: FixCount[];
}

/** The picture of a build as the year shows it. */
export interface MadePhoto {
  id: string;
  /** Its average color, shown while it loads. */
  color: string;
}

export interface LongBuild {
  itemId: string;
  title: string | null;
  attempts: number;
  photo: MadePhoto | null;
  /** How each attempt this year went, oldest first (null: still printing). */
  outcomes: (Outcome | null)[];
}

/** A build that got made this year: it had an attempt that worked. */
export interface MadeBuild {
  itemId: string;
  title: string | null;
  photo: MadePhoto;
}

/** What the year needs of a build besides its attempts. */
export interface InsightItem {
  title: string | null;
  coverPhotoId: string | null;
}

export interface InsightPhoto extends MadePhoto {
  itemId: string;
  /** The attempt it shows, null for the build's own photos. */
  attemptId: string | null;
  createdAt: number;
}

/** How many finished builds the year hands over: the screen shows a dozen and counts the rest. */
export const MADE_LIMIT = 36;

export interface Insights {
  year: number;
  /** Attempts with an outcome this year. */
  prints: number;
  outcomes: OutcomeCounts;
  months: MonthBar[];
  byMaterial: RateRow[];
  byPlate: RateRow[];
  failures: FailureInsight[];
  longestBuilds: LongBuild[];
  /** Builds with a working attempt this year, newest first, up to MADE_LIMIT, each with its final photo. */
  made: MadeBuild[];
  /** How many there are in all (those with a photo). */
  madeTotal: number;
}

const emptyCounts = (): OutcomeCounts => ({ success: 0, partial: 0, failed: 0 });

/** The calendar year and month of a time, for a zone given as minutes behind UTC (`Date.getTimezoneOffset`). */
export function localParts(at: number, tzOffset = 0): { year: number; month: number } {
  const date = new Date(at - tzOffset * 60_000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

const percent = (worked: number, total: number) => Math.round((worked / total) * 100);

function rates(groups: Map<string, { worked: number; total: number }>, limit: number): RateRow[] {
  return [...groups]
    .map(([label, { worked, total }]) => ({ label, total, worked, percent: percent(worked, total) }))
    .sort((a, b) => b.total - a.total || b.percent - a.percent || (a.label < b.label ? -1 : 1))
    .slice(0, limit);
}

/** Success rates by something: attempts with an outcome, grouped by the label `by` gives (null = not counted). */
export function successRates(
  attempts: readonly Pick<InsightAttempt, "outcome" | "settings">[],
  by: (settings: AttemptSettings) => string | null,
  limit = 6,
): RateRow[] {
  const groups = new Map<string, { worked: number; total: number }>();
  for (const attempt of attempts) {
    if (!attempt.outcome) continue;
    const label = by(attempt.settings);
    if (!label) continue;
    const group = groups.get(label) ?? { worked: 0, total: 0 };
    group.total += 1;
    if (attempt.outcome === "success") group.worked += 1;
    groups.set(label, group);
  }
  return rates(groups, limit);
}

const hotter = (before: number | undefined, after: number | undefined) => (after ?? 0) > (before ?? 0);

/**
 * What a change was, as a phrase that adds up across prints: "a warmer bed"
 * whatever the degrees. Null for a setting not worth naming (a different
 * profile name, a different spool).
 */
export function fixPhrase(key: string, before: AttemptSettings, after: AttemptSettings): string | null {
  switch (key) {
    case "brim":
      return after.brim ? "a brim" : "no brim";
    case "bedTemperature":
      return hotter(before.bedTemperature, after.bedTemperature) ? "a warmer bed" : "a cooler bed";
    case "nozzleTemperature":
      return hotter(before.nozzleTemperature, after.nozzleTemperature) ? "a hotter nozzle" : "a cooler nozzle";
    case "chamberTemperature":
      return hotter(before.chamberTemperature, after.chamberTemperature) ? "a warmer chamber" : "a cooler chamber";
    case "filamentDried":
      return after.filamentDried ? "drying the filament" : null;
    case "supports":
      return after.supportEnabled ? "supports" : "no supports";
    case "layerHeight":
      return (after.layerHeight ?? 0) < (before.layerHeight ?? 0) ? "thinner layers" : "thicker layers";
    case "infillDensity":
      return (after.infillDensity ?? 0) > (before.infillDensity ?? 0) ? "more infill" : "less infill";
    case "wallLoops":
      return (after.wallLoops ?? 0) > (before.wallLoops ?? 0) ? "more walls" : "fewer walls";
    case "bedType":
      return after.bedType ? `the ${plateName(after.bedType)} plate` : null;
    case "nozzleDiameter":
      return "another nozzle size";
    default:
      return key.startsWith("filament.") ? "another filament" : null;
  }
}

/** The phrases for what changed between two attempts. */
export function changePhrases(before: AttemptSettings, after: AttemptSettings): string[] {
  const phrases = new Set<string>();
  for (const row of diffSettings(before, after)) {
    if (!row.changed) continue;
    const phrase = fixPhrase(row.key, before, after);
    if (phrase) phrases.add(phrase);
  }
  return [...phrases];
}

/**
 * For each failure tag: the changes made right before an attempt of the same
 * build that worked. A failed (or partly failed) attempt followed by one that
 * worked counts each of its tags once per change; several changes at once all
 * get the credit, which is honest enough for "most often came before".
 */
export function whatFixed(attempts: readonly InsightAttempt[], inRange: (attempt: InsightAttempt) => boolean) {
  const byBuild = new Map<string, InsightAttempt[]>();
  for (const attempt of attempts) byBuild.set(attempt.itemId, [...(byBuild.get(attempt.itemId) ?? []), attempt]);
  const fixes = new Map<string, Map<string, number>>();
  for (const list of byBuild.values()) {
    const ordered = byPrintTime(list);
    for (let i = 1; i < ordered.length; i++) {
      const before = ordered[i - 1];
      const after = ordered[i];
      if (!before || !after || after.outcome !== "success" || !inRange(after)) continue;
      if (before.outcome !== "failed" && before.outcome !== "partial") continue;
      const phrases = changePhrases(before.settings, after.settings);
      for (const tag of before.failureTags) {
        const counts = fixes.get(tag) ?? new Map<string, number>();
        for (const phrase of phrases) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
        fixes.set(tag, counts);
      }
    }
  }
  return fixes;
}

/**
 * The photo that stands for a build: the cover picked for it, else the newest
 * picture of its latest attempt that worked, else the newest of any attempt,
 * else any picture of it (the same guess the app makes for a finished build).
 */
export function finalPhoto(
  item: Pick<InsightItem, "coverPhotoId">,
  photos: readonly InsightPhoto[],
  attempts: readonly Pick<InsightAttempt, "id" | "outcome" | "printedAt" | "createdAt">[],
): MadePhoto | null {
  const newest = (list: readonly InsightPhoto[]) =>
    list.reduce<InsightPhoto | undefined>((a, b) => (!a || b.createdAt > a.createdAt ? b : a), undefined);
  const cover = item.coverPhotoId ? photos.find((photo) => photo.id === item.coverPhotoId) : undefined;
  if (cover) return { id: cover.id, color: cover.color };
  const worked = [...attempts]
    .filter((a) => a.outcome === "success")
    .sort((a, b) => b.printedAt - a.printedAt || b.createdAt - a.createdAt)[0];
  const pick =
    newest(worked ? photos.filter((photo) => photo.attemptId === worked.id) : []) ??
    newest(photos.filter((photo) => photo.attemptId)) ??
    newest(photos);
  return pick ? { id: pick.id, color: pick.color } : null;
}

/**
 * The year in a few facts. `items` and `photos` name and picture the builds.
 * `tzOffset` is the viewer's zone in minutes behind UTC, so a print at 23:30
 * on New Year's Eve lands in their year.
 */
export function computeInsights(
  attempts: readonly InsightAttempt[],
  items: ReadonlyMap<string, InsightItem>,
  photos: readonly InsightPhoto[],
  year: number,
  tzOffset = 0,
  customTags: readonly { slug: string; label: string }[] = [],
): Insights {
  const inYear = (attempt: InsightAttempt) => localParts(attempt.printedAt, tzOffset).year === year;
  const mine = attempts.filter(inYear);
  const decided = mine.filter((attempt) => attempt.outcome !== null);
  const outcomes = emptyCounts();
  const months: MonthBar[] = Array.from({ length: 12 }, (_, month) => ({ month, ...emptyCounts() }));
  for (const attempt of decided) {
    if (!attempt.outcome) continue;
    outcomes[attempt.outcome] += 1;
    const bar = months[localParts(attempt.printedAt, tzOffset).month];
    if (bar) bar[attempt.outcome] += 1;
  }

  const tagCounts = new Map<string, number>();
  for (const attempt of decided) {
    if (attempt.outcome === "success") continue;
    for (const tag of attempt.failureTags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const fixes = whatFixed(attempts, inYear);
  const failures = [...tagCounts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 4)
    .map(([slug, count]) => ({
      slug,
      label: tagLabel("failure", slug, customTags),
      count,
      fixes: [...(fixes.get(slug) ?? [])]
        .map(([phrase, n]) => ({ phrase, count: n }))
        .sort((a, b) => b.count - a.count || (a.phrase < b.phrase ? -1 : 1))
        .slice(0, 3),
    }));

  const attemptsByBuild = new Map<string, InsightAttempt[]>();
  for (const attempt of mine)
    attemptsByBuild.set(attempt.itemId, [...(attemptsByBuild.get(attempt.itemId) ?? []), attempt]);
  const photosByBuild = new Map<string, InsightPhoto[]>();
  for (const photo of photos) photosByBuild.set(photo.itemId, [...(photosByBuild.get(photo.itemId) ?? []), photo]);
  const pictureOf = (itemId: string, list: readonly InsightAttempt[]) =>
    finalPhoto(items.get(itemId) ?? { coverPhotoId: null }, photosByBuild.get(itemId) ?? [], list);

  const longestBuilds = [...attemptsByBuild]
    .filter(([, list]) => list.length >= 3)
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3)
    .map(([itemId, list]) => ({
      itemId,
      title: items.get(itemId)?.title ?? null,
      attempts: list.length,
      photo: pictureOf(itemId, list),
      outcomes: byPrintTime(list).map((attempt) => attempt.outcome),
    }));

  const allMade = [...attemptsByBuild]
    .flatMap(([itemId, list]) => {
      const worked = list.filter((attempt) => attempt.outcome === "success");
      const photo = worked.length ? pictureOf(itemId, list) : null;
      const at = Math.max(0, ...worked.map((attempt) => attempt.printedAt));
      return photo ? [{ itemId, title: items.get(itemId)?.title ?? null, photo, at }] : [];
    })
    .sort((a, b) => b.at - a.at || (a.itemId < b.itemId ? -1 : 1));
  const made = allMade.slice(0, MADE_LIMIT).map(({ at: _at, ...build }) => build);

  return {
    year,
    prints: decided.length,
    outcomes,
    months,
    byMaterial: successRates(decided, settingsMaterial),
    byPlate: successRates(decided, (settings) => (settings.bedType ? plateName(settings.bedType) : null)),
    failures,
    longestBuilds,
    made,
    madeTotal: allMade.length,
  };
}

/** "Warping: fixed 3 times by a brim, twice by a warmer bed" as one sentence; null when nothing fixed it yet. */
export function fixSentence(fixes: readonly FixCount[]): string | null {
  if (fixes.length === 0) return null;
  const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
  const parts = fixes.map((fix) => `${times(fix.count)} by ${fix.phrase}`);
  const last = parts.pop();
  return `fixed ${parts.length ? `${parts.join(", ")} and ${last}` : last}`;
}
