import { checkLinkUrl } from "../../shared/link-safety.ts";
import { isModelHost } from "../../shared/model-links.ts";
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
        return { status: response.status, html: null };
      }
      return { status: response.status, html: await readCapped(response, MAX_BYTES) };
    }
    return { status: null, html: null };
  } catch {
    return { status: null, html: null };
  }
}
