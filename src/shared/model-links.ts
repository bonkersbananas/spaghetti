/**
 * The three model sites an idea can be drafted from, and the image hosts they serve pictures from. Pure, so the
 * client (is this a model link?), the Worker (what may Claude read, which pictures may be stored) and the tests
 * all use the same list.
 */
import { checkLinkUrl } from "./link-safety.ts";
import { mirrorSource } from "./mirrors.ts";

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
    imageHosts: ["cdn.thingiverse.com"],
  },
];

/** Every domain the web fetch tool may be given. */
export const MODEL_DOMAINS = MODEL_SITES.flatMap((site) => site.domains);

const hostMatches = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`);

/** Which model site a link is on, or null for anything else (and for links that aren't safe public https links). */
export function modelSite(raw: string): { site: ModelSite; url: URL } | null {
  const given = checkLinkUrl(raw);
  if (!given) return null;
  // A mirror's page for a model (3dgo.app) is read as the source's own page.
  const url = new URL(mirrorSource(given) ?? given.href);
  const host = url.hostname.toLowerCase();
  const site = MODEL_SITES.find((candidate) => candidate.domains.some((domain) => hostMatches(host, domain)));
  return site ? { site, url } : null;
}

/** Whether a host is one of the three sites' own pages (the Worker fetches only these itself). */
export const isModelHost = (host: string) =>
  MODEL_SITES.some((site) => site.domains.some((domain) => hostMatches(host.toLowerCase(), domain)));

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

/** The boxes Printables' image host makes thumbnails in (`thumbs/inside/<box>` fits a picture inside one). */
const PRINTABLES_BOXES = ["320x240", "1280x960", "1600x1200", "1920x1440"] as const;

/**
 * A Printables picture as a WebP that fits inside the smallest box at least `width` wide. Printables keeps the
 * originals as uploaded (9 MB JPEGs, PNG renders), and its image host serves any of them, or one of its own
 * thumbnails, resized at `<folder>/thumbs/inside/<box>/<original extension>/<name>.webp`.
 */
function printablesPicture(url: URL, width: number): string | null {
  const match =
    /^(\/media\/prints\/[^/]+\/images\/[^/]+)\/(?:thumbs\/[a-z]+\/\d+x\d+\/([a-z0-9]+)\/)?([^/]+?)\.([a-z0-9]+)$/i.exec(
      url.pathname,
    );
  if (!match) return null;
  const [, folder, thumbOf, name, extension] = match;
  const box = PRINTABLES_BOXES.find((size) => Number(size.split("x")[0]) >= width) ?? PRINTABLES_BOXES.at(-1);
  return `${url.origin}${folder}/thumbs/inside/${box}/${(thumbOf ?? extension)?.toLowerCase()}/${name}.webp`;
}

/**
 * The address to download a picture from. MakerWorld and Printables keep their pictures as large PNGs or JPEGs of
 * megabytes, which can't be stored (PNGs at all); their image hosts convert and resize on request, so ask for a
 * WebP about `width` px wide (1600 by default).
 */
export function pictureRequestUrl(raw: string, width = 1600): string {
  const url = new URL(raw);
  if (url.hostname === "makerworld.bblmw.com" && !url.search)
    url.search = `?x-oss-process=image/resize,w_${width}/format,webp`;
  if (url.hostname === "media.printables.com" && !url.search) return printablesPicture(url, width) ?? url.href;
  return url.href;
}
