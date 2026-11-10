/**
 * The three model sites an idea can be drafted from, and the image hosts they serve pictures from. Pure, so the
 * client (is this a model link?), the Worker (what may Claude read, which pictures may be stored) and the tests
 * all use the same list.
 */
import { checkLinkUrl } from "./link-safety.ts";

export type ModelSiteId = "makerworld" | "printables" | "thingiverse";

export interface ModelSite {
  id: ModelSiteId;
  name: string;
  /** The site's own domains (subdomains are included): all the web fetch tool may read. */
  domains: readonly string[];
  /** Where its pictures come from, as host suffixes. Nothing else is ever downloaded for a draft. */
  imageHosts: readonly string[];
}

export const MODEL_SITES: readonly ModelSite[] = [
  {
    id: "makerworld",
    name: "MakerWorld",
    domains: ["makerworld.com"],
    imageHosts: ["makerworld.bblmw.com", "public-cdn.bblmw.com"],
  },
  {
    id: "printables",
    name: "Printables",
    domains: ["printables.com"],
    imageHosts: ["media.printables.com", "files.printables.com"],
  },
  {
    id: "thingiverse",
    name: "Thingiverse",
    domains: ["thingiverse.com"],
    imageHosts: ["cdn.thingiverse.com", "thingiverse-production-new.s3.amazonaws.com"],
  },
];

/** Every domain the web fetch tool may be given. */
export const MODEL_DOMAINS = MODEL_SITES.flatMap((site) => site.domains);

const hostMatches = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`);

/** Which model site a link is on, or null for anything else (and for links that aren't safe public https links). */
export function modelSite(raw: string): { site: ModelSite; url: URL } | null {
  const url = checkLinkUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const site = MODEL_SITES.find((candidate) => candidate.domains.some((domain) => hostMatches(host, domain)));
  return site ? { site, url } : null;
}

/** Whether `raw` is an https link to one of the allowed image hosts. */
export function isModelImageUrl(raw: string): boolean {
  const url = checkLinkUrl(raw);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return MODEL_SITES.some((site) => site.imageHosts.some((allowed) => host === allowed));
}

/** The one model link in a capture's text when that is all it is (a link, maybe with a few words of the site's own title). */
export function lonelyModelLink(note: string): { site: ModelSite; url: string } | null {
  const text = note.trim();
  if (!text) return null;
  const links = text.match(/https?:\/\/\S+/g) ?? [];
  const link = links[0];
  if (links.length !== 1 || !link) return null;
  // Anything beyond the link and a short headline is the person's own words: leave those alone.
  if (text.replace(link, "").trim().length > 80) return null;
  const found = modelSite(link.replace(/[).,;]+$/, ""));
  return found ? { site: found.site, url: found.url.href } : null;
}

/** The first model link anywhere in a note (for the idea page's "Draft from this page" action). */
export function firstModelLink(note: string): { site: ModelSite; url: string } | null {
  for (const raw of note.match(/https?:\/\/\S+/g) ?? []) {
    const found = modelSite(raw.replace(/[).,;]+$/, ""));
    if (found) return { site: found.site, url: found.url.href };
  }
  return null;
}
