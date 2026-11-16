import { checkLinkUrl } from "../../shared/link-safety.ts";
import { isModelHost, type ModelSiteId } from "../../shared/model-links.ts";
import { extractMakerWorldDesign, extractModelPage, type PageFacts } from "../../shared/model-page.ts";
import { readCapped, resolvesPublic } from "../link-preview.ts";

/** MakerWorld's pages are about 1.4 MB (the design is a 900 KB JSON blob inside); anything bigger isn't read. */
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
/** The same name the link cards use: MakerWorld answers it with the real page. */
const USER_AGENT = "SpaghettiLinkPreview/1.0";

export interface FetchedPage {
  /** The HTTP status of the last answer, or null when nothing answered (refused, timed out, not allowed). */
  status: number | null;
  /** The page's HTML when it answered 200 with HTML. */
  html: string | null;
  /** The answer was a bot challenge (Cloudflare's `cf-mitigated: challenge`), not the site's own answer. */
  challenged?: boolean;
}

/**
 * Fetches a model page from the Worker itself: Anthropic's web fetch is turned away by MakerWorld's bot
 * protection, a Worker is not. Only the three model sites, https, every redirect checked to stay on them (and the
 * name to resolve to public addresses, like the link cards), a size cap and a timeout. Never throws.
 */
export async function fetchModelPage(link: string): Promise<FetchedPage> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    let url = checkLinkUrl(link);
    for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
      if (!isModelHost(url.hostname)) return { status: null, html: null };
      if (!(await resolvesPublic(url.hostname.replace(/\.$/, ""), signal))) return { status: null, html: null };
      const response = await fetch(url, {
        redirect: "manual",
        signal,
        headers: { Accept: "text/html", "Accept-Language": "en", "User-Agent": USER_AGENT },
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel().catch(() => undefined);
        url = checkLinkUrl(new URL(location, url).href);
        continue;
      }
      const type = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!response.ok || !(type.startsWith("text/html") || type.startsWith("application/xhtml+xml"))) {
        await response.body?.cancel().catch(() => undefined);
        const challenged = response.headers.get("cf-mitigated")?.toLowerCase() === "challenge";
        return { status: response.status, html: null, ...(challenged ? { challenged } : {}) };
      }
      return { status: response.status, html: await readCapped(response, MAX_BYTES) };
    }
    return { status: null, html: null };
  } catch {
    return { status: null, html: null };
  }
}

/**
 * Why the Worker couldn't read a model: nothing answered (`unreachable`: refused, timed out, DNS, a redirect off the
 * sites), the site says it isn't there (`not_found`: a 404 or 410, or MakerWorld's API saying 404), a bot challenge,
 * another status, an answer that isn't HTML, or a page that names no model (`no_model`: a soft "not found").
 */
export type UnreadReason = "unreachable" | "not_found" | "challenge" | `http_${number}` | "not_html" | "no_model";

export interface ModelRead {
  /** What the model's page (or MakerWorld's API) states, or null when the Worker couldn't read the model. */
  facts: PageFacts | null;
  /** Which way it was read. */
  via: "page" | "api" | null;
  /** The page's HTTP status: null when it wasn't asked or nothing answered. */
  pageStatus: number | null;
  /** Why nothing was read: the site's own "not found" over anything else, then the page's reason. */
  reason: UnreadReason | null;
  /** Why the page itself gave nothing, when it was asked. */
  pageReason: UnreadReason | null;
}

function unreadReason(page: FetchedPage): UnreadReason {
  if (page.status === null) return "unreachable";
  if (page.status === 404 || page.status === 410) return "not_found";
  if (page.challenged) return "challenge";
  if (page.status !== 200) return `http_${page.status}`;
  return page.html ? "no_model" : "not_html";
}

/** A MakerWorld model's number, from any address of its page. */
const makerWorldId = (link: string) =>
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/(\d{1,12})(?:[-/]|$)/i.exec(
    URL.canParse(link) ? new URL(link).pathname : "",
  )?.[1] ?? null;

/**
 * MakerWorld's public design API (`/api/v1/design-service/design/<id>`): JSON, answered where the page itself is
 * behind a bot challenge, and a plain 404 for a model that isn't there. Only that one address on makerworld.com,
 * no redirects followed, the same cap and timeout as a page. Never throws.
 */
export async function fetchMakerWorldDesign(
  id: string,
): Promise<{ status: number | null; facts: PageFacts | null; challenged?: boolean }> {
  try {
    const response = await fetch(`https://makerworld.com/api/v1/design-service/design/${encodeURIComponent(id)}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json", "Accept-Language": "en", "User-Agent": USER_AGENT },
    });
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!response.ok || !type.startsWith("application/json")) {
      await response.body?.cancel().catch(() => undefined);
      const challenged = response.headers.get("cf-mitigated")?.toLowerCase() === "challenge";
      return { status: response.status, facts: null, ...(challenged ? { challenged } : {}) };
    }
    const text = await readCapped(response, MAX_BYTES);
    let facts: PageFacts | null = null;
    try {
      facts = extractMakerWorldDesign(JSON.parse(text), id);
    } catch {
      facts = null;
    }
    return { status: response.status, facts };
  } catch {
    return { status: null, facts: null };
  }
}

/**
 * Reads a model the way a Worker can: its page (decision 0019's fetch), and for MakerWorld its design API as well,
 * which gets through where MakerWorld's bot protection challenges the page. `apiFirst` asks the API before the page
 * (the scout: smaller, and a made-up number is a plain 404); otherwise the API is only asked when the page gave
 * nothing (the drafts, which read the page's English design). Never throws.
 */
export async function readModel(
  site: ModelSiteId,
  link: string,
  options: { apiFirst?: boolean } = {},
): Promise<ModelRead> {
  const id = site === "makerworld" ? makerWorldId(link) : null;
  let pageStatus: number | null = null;
  let pageReason: UnreadReason | null = null;
  let apiReason: UnreadReason | null = null;
  const fromPage = async (): Promise<PageFacts | null> => {
    const page = await fetchModelPage(link);
    pageStatus = page.status;
    let facts: PageFacts | null = null;
    try {
      facts = page.html ? extractModelPage(site, page.html) : null;
    } catch {
      // A page that breaks the reader is a page it can't read.
      facts = null;
    }
    if (!facts) pageReason = unreadReason(page);
    return facts;
  };
  const fromApi = async (): Promise<PageFacts | null> => {
    if (!id) return null;
    const answer = await fetchMakerWorldDesign(id);
    if (!answer.facts)
      apiReason = unreadReason({
        status: answer.status,
        html: answer.status === 200 ? "json" : null,
        challenged: answer.challenged,
      });
    return answer.facts;
  };
  const ways: Array<["page" | "api", () => Promise<PageFacts | null>]> = options.apiFirst
    ? [
        ["api", fromApi],
        ["page", fromPage],
      ]
    : [
        ["page", fromPage],
        ["api", fromApi],
      ];
  for (const [via, read] of ways) {
    if (via === "api" && !id) continue;
    const facts = await read();
    if (facts) return { facts, via, pageStatus, reason: null, pageReason };
    // MakerWorld's own "there is no such model" is the answer: the page isn't asked after it.
    if (apiReason === "not_found") break;
  }
  return {
    facts: null,
    via: null,
    pageStatus,
    reason: apiReason === "not_found" ? "not_found" : (pageReason ?? apiReason),
    pageReason,
  };
}
