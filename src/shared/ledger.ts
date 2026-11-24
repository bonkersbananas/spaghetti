/**
 * Filament in grams, as a ledger (decision 0009). A spool has a net weight
 * (what it held when new), optional weighings (each a fresh baseline) and
 * the usage of every finished attempt that linked it. Nothing keeps a running
 * number: grams left are worked out from those, so editing or deleting an
 * attempt, and undoing that, simply gives a different answer. Shared by the
 * Worker (which sends the answer) and the app (which warns before a print).
 */
import type { AttemptSettings, Outcome } from "./attempts.ts";
import type { Remaining } from "./spools.ts";

/** Sizes offered when a spool is new; any other number works too. */
export const NET_WEIGHT_PRESETS = [250, 500, 750, 1000, 2000] as const;
/** What a new Bambu spool holds. */
export const DEFAULT_NET_GRAMS = 1000;
export const MAX_SPOOL_GRAMS = 20_000;

/**
 * Where the levels start: full from 70 % of the net weight, half from 30 %, low above 10 g, and
 * empty at 10 g or less (a tangle-free remainder that prints practically nothing). The first two are
 * the printer bridge's thresholds for the AMS's own percentage (bridge/ams.ts); "low" is an amount,
 * not a share, because 62 g is still a small print on a 1 kg or a 250 g spool.
 */
export const LEVEL_FROM = { full: 0.7, half: 0.3 } as const;
export const EMPTY_GRAMS = 10;

/** Spools at or below this many grams are on the Running low list, whatever their size. */
export const LOW_GRAMS = 100;

/** The level that grams over the net weight give. */
export function levelFromGrams(left: number, net: number): Remaining {
  if (left <= EMPTY_GRAMS) return "empty";
  if (net <= 0) return "full";
  const share = left / net;
  if (share >= LEVEL_FROM.full) return "full";
  return share >= LEVEL_FROM.half ? "half" : "low";
}

/** The parts of an attempt that decide what it used. */
export interface UsageAttempt {
  id: string;
  outcome: Outcome | null;
  /** When it got its outcome, epoch ms (printedAt for one that never recorded it). */
  at: number;
  settings: AttemptSettings;
}

export interface Usage {
  attemptId: string;
  spoolId: string;
  /** Rounded to a tenth of a gram. */
  grams: number;
  /** A failed print counted by a guess: "about". */
  approximate: boolean;
  at: number;
}

const tenth = (value: number) => Math.round(value * 10) / 10;

/**
 * What a finished attempt took off each spool it linked. A print that worked
 * or partly worked used all its grams. A failed one used its grams in
 * proportion to how far it got when that is known, else all of them, and is
 * marked approximate either way. A filament with no grams of its own uses the
 * attempt's total when it is the only filament. A print still going, or off
 * the bed with no outcome, has used nothing yet.
 */
export function attemptUsage(attempt: UsageAttempt): Usage[] {
  if (!attempt.outcome) return [];
  const filaments = attempt.settings.filaments ?? [];
  const failed = attempt.outcome === "failed";
  const percent = attempt.settings.failedAtPercent;
  const share = failed && percent !== undefined ? Math.min(Math.max(percent, 0), 100) / 100 : 1;
  const perSpool = new Map<string, number>();
  for (const filament of filaments) {
    if (!filament.spoolId) continue;
    const planned = filament.grams ?? (filaments.length === 1 ? attempt.settings.weightGrams : undefined);
    if (planned === undefined || planned <= 0) continue;
    perSpool.set(filament.spoolId, (perSpool.get(filament.spoolId) ?? 0) + planned * share);
  }
  return [...perSpool].map(([spoolId, grams]) => ({
    attemptId: attempt.id,
    spoolId,
    grams: tenth(grams),
    approximate: failed,
    at: attempt.at,
  }));
}

export interface Weighing {
  id: string;
  /** Grams of filament left when weighed (the scale's figure minus the empty spool). */
  gramsLeft: number;
  /** What the scale said, if it was entered that way. */
  onScale: number | null;
  at: number;
}

export interface SpoolGrams {
  /** Null when nobody has given this spool a weight: its level stays hand-set. */
  netGrams: number | null;
  tareGrams: number | null;
  /** About how many grams are left; null without gram data. */
  gramsLeft: number | null;
  /** Some of what was counted since the baseline was a guess (a failed print). */
  approximate: boolean;
  /** The last weighing, epoch ms. */
  weighedAt: number | null;
  /** What counted since the baseline, newest first. */
  used: Usage[];
}

/**
 * Grams left: the latest weighing (else the net weight) minus the usage after
 * it. A weighing is taken at its time, so an attempt finished before it is
 * already in the figure and does not come off again. Never below zero.
 */
export function spoolGrams(
  spool: { netGrams: number | null; tareGrams: number | null },
  weighings: readonly Weighing[],
  usage: readonly Usage[],
): SpoolGrams {
  const latest = weighings.reduce<Weighing | null>((best, w) => (!best || w.at > best.at ? w : best), null);
  const base = latest ? latest.gramsLeft : spool.netGrams;
  const used = usage.filter((entry) => !latest || entry.at > latest.at).sort((a, b) => b.at - a.at);
  const result = {
    netGrams: spool.netGrams,
    tareGrams: spool.tareGrams,
    weighedAt: latest?.at ?? null,
    used,
  };
  if (base === null) return { ...result, gramsLeft: null, approximate: false };
  const total = used.reduce((sum, entry) => sum + entry.grams, 0);
  return {
    ...result,
    gramsLeft: Math.max(0, Math.round(base - total)),
    approximate: used.some((entry) => entry.approximate),
  };
}

/** The level to show: from grams when they are known, else the hand-set (or AMS-reported) one. */
export function levelOf(spool: { remaining: Remaining; gramsLeft: number | null; netGrams: number | null }): Remaining {
  if (spool.gramsLeft === null) return spool.remaining;
  return levelFromGrams(spool.gramsLeft, spool.netGrams ?? Math.max(spool.gramsLeft, DEFAULT_NET_GRAMS));
}

/** The scale's figure minus the empty spool: filament left. */
export const gramsFromScale = (onScale: number, tare: number | null | undefined) =>
  Math.max(0, Math.round(onScale - (tare ?? 0)));

/** "420 g", "about 420 g" (grams are never exact once prints came off). */
export const gramsText = (grams: number) => `${Math.round(grams).toLocaleString("en")} g`;

/** What a spool offers a print check. */
export interface StockedSpool {
  id: string;
  gramsLeft: number | null;
  colorName?: string | null;
  material: string;
}

export interface NotEnough {
  /** The filament's index in the attempt. */
  filament: number;
  spoolId: string;
  need: number;
  left: number;
}

/**
 * Where a print needs more than its spool has left. Only spools with gram
 * data count, and only filaments that say how many grams they use: a calm
 * heads-up, never a block.
 */
export function notEnough(
  settings: AttemptSettings,
  spools: readonly StockedSpool[],
): Array<NotEnough & { spool: StockedSpool }> {
  const filaments = settings.filaments ?? [];
  const needs = new Map<string, { need: number; first: number }>();
  filaments.forEach((filament, index) => {
    if (!filament.spoolId) return;
    const planned = filament.grams ?? (filaments.length === 1 ? settings.weightGrams : undefined);
    if (planned === undefined || planned <= 0) return;
    const entry = needs.get(filament.spoolId);
    needs.set(filament.spoolId, { need: (entry?.need ?? 0) + planned, first: entry?.first ?? index });
  });
  const out: Array<NotEnough & { spool: StockedSpool }> = [];
  for (const [spoolId, { need, first }] of needs) {
    const spool = spools.find((s) => s.id === spoolId);
    if (!spool || spool.gramsLeft === null || need <= spool.gramsLeft) continue;
    out.push({ filament: first, spoolId, need: Math.ceil(need), left: spool.gramsLeft, spool });
  }
  return out;
}

/** "Sunflower yellow has about 40 g left; this plate needs 66 g." */
export function notEnoughText(entry: NotEnough & { spool: StockedSpool }, what = "this plate"): string {
  const name = entry.spool.colorName || entry.spool.material;
  return `${name} has about ${gramsText(entry.left)} left; ${what} needs ${gramsText(entry.need)}.`;
}

/** Whether a spool belongs on the Running low list. */
export function isRunningLow(spool: { remaining: Remaining; gramsLeft: number | null }): boolean {
  if (spool.gramsLeft !== null && spool.gramsLeft <= LOW_GRAMS) return true;
  return spool.remaining === "low" || spool.remaining === "empty";
}
