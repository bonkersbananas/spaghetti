/**
 * The idea scout (decision 0039): once a week Claude suggests three models to print. The shapes the page and the API
 * share and the few pure rules both sides need: which links may be suggested and what makes two of them the same
 * model. Pure, so the browser, the Worker and the unit tests agree.
 */
import { checkLinkUrl } from "./link-safety.ts";
import { modelSite } from "./model-links.ts";

/** The scout shows this many. */
export const SCOUT_COUNT = 3;
/** Claude is asked for more than it shows, so that a dead link or a model already seen doesn't leave a gap. */
export const SCOUT_CANDIDATES = 6;
/** The scout makes its week's suggestions from this local hour (workspace time) on, so nothing arrives in the night. */
export const SCOUT_FROM_HOUR = 7;
/** Most characters of the sentence on why it fits. */
export const SCOUT_WHY_MAX = 140;

/** Printables answers Cloudflare Workers with a bot challenge, so the scout can't check its links: never suggested. */
export const SCOUT_SITE_IDS = ["makerworld", "thingiverse"] as const;
export type ScoutSiteId = (typeof SCOUT_SITE_IDS)[number];
/** The domains Claude's search and fetch are limited to. */
export const SCOUT_DOMAINS = ["makerworld.com", "thingiverse.com"] as const;

export type ScoutStatus = "suggested" | "kept" | "dismissed";

export interface ScoutPick {
  id: string;
  url: string;
  site: ScoutSiteId;
  siteName: string;
  title: string;
  /** One short sentence on why it fits the two of you. */
  why: string;
  /** The picture is served at `/api/scout/:id/picture`. */
  hasPicture: boolean;
  status: ScoutStatus;
  /** The idea a kept pick became. */
  itemId: string | null;
}

/**
 * thinking: Claude is looking; ready: there are picks (some may be decided already); none: nothing this week (no
 * key, no round yet, or nothing worth showing).
 */
export type ScoutState = "thinking" | "ready" | "none";

export interface ScoutRound {
  /** The Monday of the week the picks are for. */
  monday: string;
  state: ScoutState;
  picks: ScoutPick[];
}

export interface ScoutResponse {
  scout: ScoutRound;
}

/**
 * What a suggested link is: its site, its address without the query and the part that never changes, and a key
 * (`makerworld:1234567`, `thingiverse:6543210`) that is the same for every address of one model. Null for anything
 * that isn't a MakerWorld model page or a Thingiverse thing: a search, a collection, a designer's page, Printables.
 */
export function scoutLink(raw: string): { site: ScoutSiteId; url: string; key: string } | null {
  const found = modelSite(raw);
  if (!found || !checkLinkUrl(raw)) return null;
  const { site, url } = found;
  if (site.id === "makerworld") {
    const id = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/(\d{3,12})(?:-[\w-]*)?\/?$/i.exec(url.pathname)?.[1];
    if (!id) return null;
    return {
      site: "makerworld",
      url: `https://makerworld.com${url.pathname.replace(/\/$/, "")}`,
      key: `makerworld:${id}`,
    };
  }
  if (site.id === "thingiverse") {
    const id = /^\/thing:(\d{3,12})\/?$/i.exec(url.pathname)?.[1];
    if (!id) return null;
    return { site: "thingiverse", url: `https://www.thingiverse.com/thing:${id}`, key: `thingiverse:${id}` };
  }
  return null;
}

/** The keys of every scout link in some text (an idea's note), so a model already saved as an idea isn't suggested. */
export function scoutKeysIn(text: string): string[] {
  const keys = new Set<string>();
  for (const raw of text.match(/https?:\/\/\S+/g) ?? []) {
    const key = scoutLink(raw.replace(/[).,;]+$/, ""))?.key;
    if (key) keys.add(key);
  }
  return [...keys];
}

/** A tidy one-line sentence from what Claude wrote. */
export const tidyWhy = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > SCOUT_WHY_MAX ? `${line.slice(0, SCOUT_WHY_MAX - 1).trimEnd()}…` : line;
};
