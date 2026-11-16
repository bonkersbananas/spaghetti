/**
 * "Is there a real model for this idea?" Recognises a link to a model page on a known site, or straight to a
 * model file, in an idea's note. Pure and offline: it only reads the address. It knows more sites than
 * model-links.ts (which lists what the Worker may fetch for drafts); a site's home or search page doesn't count.
 */

import { checkLinkUrl } from "./link-safety.ts";
import { findLinks } from "./links.ts";

export type ModelMarkSite =
  | "makerworld"
  | "printables"
  | "thingiverse"
  | "thangs"
  | "cults3d"
  | "myminifactory"
  | "crealitycloud";

export interface ModelMark {
  /** A model page on a known site, or a direct link to a model file. */
  kind: "page" | "file";
  /** Set for pages. */
  site: ModelMarkSite | null;
  /** "MakerWorld", "Printables"…; for a file, its extension: ".3mf". */
  name: string;
  url: string;
}

interface Site {
  id: ModelMarkSite;
  name: string;
  domains: readonly string[];
  /** Tested against the pathname: only a model's own page matches, and its first group is what names the model. */
  page: RegExp;
}

const SITES: readonly Site[] = [
  {
    id: "makerworld",
    name: "MakerWorld",
    domains: ["makerworld.com"],
    page: /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/(\d+)/i,
  },
  { id: "printables", name: "Printables", domains: ["printables.com"], page: /^\/(?:[a-z]{2}\/)?model\/(\d+)/i },
  { id: "thingiverse", name: "Thingiverse", domains: ["thingiverse.com"], page: /^\/thing:(\d+)/i },
  { id: "thangs", name: "Thangs", domains: ["thangs.com"], page: /^\/designer\/[^/]+\/3d-model\/([^/]+)/i },
  { id: "cults3d", name: "Cults", domains: ["cults3d.com"], page: /^\/(?:[a-z]{2}\/)?3d-model\/[^/]+\/([^/]+)/i },
  {
    id: "myminifactory",
    name: "MyMiniFactory",
    domains: ["myminifactory.com"],
    page: /^\/object\/(3d-print-[^/]+)/i,
  },
  {
    id: "crealitycloud",
    name: "Creality Cloud",
    domains: ["crealitycloud.com"],
    page: /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?model-detail\/([^/]+)/i,
  },
];

const FILE = /\.(3mf|stl|step|stp|obj)$/i;

const hostIs = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** What a link points at: a model page (and the part of its address that names the model), a model file, or neither. */
function readModelLink(raw: string): { mark: ModelMark; key: string } | null {
  const url = checkLinkUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const site = SITES.find((candidate) => candidate.domains.some((domain) => hostIs(host, domain)));
  if (site) {
    const id = site.page.exec(url.pathname)?.[1];
    if (!id) return null;
    // A model page is its path: what follows it (?from=search, #profileId-…) only says how it was found.
    const page = `${url.origin}${url.pathname}`;
    return { mark: { kind: "page", site: site.id, name: site.name, url: page }, key: `${site.id}:${id.toLowerCase()}` };
  }
  const ext = FILE.exec(url.pathname)?.[0];
  // A file's query may be what lets it download (a signed link): it stays.
  return ext ? { mark: { kind: "file", site: null, name: ext.toLowerCase(), url: url.href }, key: url.href } : null;
}

/**
 * The model link this one is, or null (a home page, a search, a creator's page, an unsafe address). A page's `url` is
 * its address without the query and fragment that only track where it was found.
 */
export function modelMarkOf(raw: string): ModelMark | null {
  return readModelLink(raw)?.mark ?? null;
}

/**
 * Whether two links are the same model: the same MakerWorld design whether the address has /en/ or not, a slug or
 * ?from=search, the same thing:123 on www. or not. False when either isn't a model link.
 */
export function sameModel(a: string, b: string): boolean {
  const key = readModelLink(a)?.key;
  return !!key && key === readModelLink(b)?.key;
}

/** One key per model a link points at (sameModel's), or the link itself when it isn't one: for listing each once. */
export const linkKey = (url: string) => readModelLink(url)?.key ?? url;

/** A model page's link without its tracking bits ("…/models/3531476-flexi-mini-hummingbird"); any other link as it is. */
export function cleanModelUrl(raw: string): string {
  const mark = modelMarkOf(raw);
  return mark?.kind === "page" ? mark.url : raw;
}

/**
 * The text with each model page's link cleaned (cleanModelUrl), for a note as it is saved: "?from=search#profileId-…"
 * is noise to read and to search. Anything else in it stays exactly as it was.
 */
export function tidyModelLinks(text: string): string {
  let result = text;
  for (const { url, start, end } of findLinks(text).reverse()) {
    if (!/[?#]/.test(url)) continue;
    const clean = cleanModelUrl(url);
    if (clean !== url) result = `${result.slice(0, start)}${clean}${result.slice(end)}`;
  }
  return result;
}

/** The first model link in a note, or null: the idea has no model (yet). */
export function modelMarkIn(note: string): ModelMark | null {
  for (const { url } of findLinks(note)) {
    const mark = modelMarkOf(url);
    if (mark) return mark;
  }
  return null;
}

/**
 * The model an idea has: its first model link, else its draft's page, else a kept file (ours, so not a link out): a
 * slicer's .3mf, or a model Spaghetti slices (.stl, .3mf).
 */
export function modelOf(item: {
  note: string;
  draft?: { url: string } | null;
  files?: ReadonlyArray<{ id: string; name?: string }>;
}): ModelMark | null {
  const file = item.files?.[0];
  const ext = (file?.name ? FILE.exec(file.name)?.[0] : undefined)?.toLowerCase() ?? ".3mf";
  return (
    modelMarkIn(item.note) ??
    (item.draft ? modelMarkOf(item.draft.url) : null) ??
    (file ? { kind: "file", site: null, name: ext, url: `/api/files/${file.id}` } : null)
  );
}

/** "MakerWorld", or "STL file" for a direct link to a model file. */
export const modelPlace = (mark: ModelMark) =>
  mark.kind === "page" ? mark.name : `${mark.name.slice(1).toUpperCase()} file`;

/** The letter that stands for where the model lives: M for MakerWorld, STL for a .stl file. */
export const modelLetter = (mark: ModelMark) =>
  mark.kind === "page" ? mark.name.charAt(0) : mark.name.slice(1).toUpperCase();
