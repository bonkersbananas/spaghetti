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
  /** Tested against `pathname + search`: only a model's own page matches. */
  page: RegExp;
}

const SITES: readonly Site[] = [
  {
    id: "makerworld",
    name: "MakerWorld",
    domains: ["makerworld.com"],
    page: /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/\d+/i,
  },
  { id: "printables", name: "Printables", domains: ["printables.com"], page: /^\/(?:[a-z]{2}\/)?model\/\d+/i },
  { id: "thingiverse", name: "Thingiverse", domains: ["thingiverse.com"], page: /^\/thing:\d+/i },
  { id: "thangs", name: "Thangs", domains: ["thangs.com"], page: /^\/designer\/[^/]+\/3d-model\/[^/]+/i },
  { id: "cults3d", name: "Cults", domains: ["cults3d.com"], page: /^\/(?:[a-z]{2}\/)?3d-model\/[^/]+\/[^/]+/i },
  {
    id: "myminifactory",
    name: "MyMiniFactory",
    domains: ["myminifactory.com"],
    page: /^\/object\/3d-print-[^/]+/i,
  },
  {
    id: "crealitycloud",
    name: "Creality Cloud",
    domains: ["crealitycloud.com"],
    page: /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?model-detail\/[^/]+/i,
  },
];

const FILE = /\.(3mf|stl|step|stp|obj)$/i;

const hostIs = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** The model link this one is, or null (a home page, a search, a creator's page, an unsafe address). */
export function modelMarkOf(raw: string): ModelMark | null {
  const url = checkLinkUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const site = SITES.find((candidate) => candidate.domains.some((domain) => hostIs(host, domain)));
  if (site)
    return site.page.test(url.pathname) ? { kind: "page", site: site.id, name: site.name, url: url.href } : null;
  const ext = FILE.exec(url.pathname)?.[0];
  return ext ? { kind: "file", site: null, name: ext.toLowerCase(), url: url.href } : null;
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
