import { checkLinkUrl, isPublicAddress, readPreview } from "../shared/link-safety.ts";

/** Everything the fetch is allowed: how long, how much, how many redirects. */
export const LIMITS = { timeoutMs: 3000, maxBytes: 256 * 1024, maxRedirects: 3 } as const;

const DOH = "https://cloudflare-dns.com/dns-query";

/**
 * Whether a name points only at public addresses. A Worker can't look at DNS
 * itself, so this asks Cloudflare's resolver over HTTPS: a name that points
 * into the home network (a public name with a private address) is refused,
 * and so is one that can't be resolved. It cannot rule out a name that changes
 * its answer between this check and the fetch; the host rules and the
 * people-only endpoint carry the rest.
 */
export async function resolvesPublic(host: string, signal: AbortSignal): Promise<boolean> {
  const answers = await Promise.all(
    (["A", "AAAA"] as const).map(async (type) => {
      const response = await fetch(`${DOH}?name=${encodeURIComponent(host)}&type=${type}`, {
        headers: { Accept: "application/dns-json" },
        signal,
      });
      if (!response.ok) throw new Error(`DNS ${response.status}`);
      const body = (await response.json()) as { Status?: number; Answer?: Array<{ type: number; data: string }> };
      return body.Status === 0 ? (body.Answer ?? []).filter((answer) => answer.type === 1 || answer.type === 28) : [];
    }),
  );
  const addresses = answers.flat().map((answer) => answer.data);
  return addresses.length > 0 && addresses.every(isPublicAddress);
}

/** Whether DNS says a name doesn't exist at all (NXDOMAIN); false for a name that resolves, and for any doubt. */
export async function nameMissing(host: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${DOH}?name=${encodeURIComponent(host)}&type=A`, {
      headers: { Accept: "application/dns-json" },
      signal,
    });
    if (!response.ok) return false;
    return ((await response.json()) as { Status?: number }).Status === 3;
  } catch {
    return false;
  }
}

/** Reads at most `maxBytes` of a body, then lets go of the rest. */
export async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value.length > maxBytes - size ? value.slice(0, maxBytes - size) : value);
    size += value.length;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(Math.min(size, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const charset = /charset=["']?([\w-]+)/i.exec(response.headers.get("content-type") ?? "")?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/**
 * The title and site name of a public web page, or null when it can't be had
 * (not https, a private or local address, too slow, too many redirects, not
 * HTML, nothing in it). Every hop, the first and each redirect, goes through
 * the same checks; only `<title>` and the `og:` tags are read, from the first
 * 256 KB.
 */
export async function fetchPreview(link: URL): Promise<{ title: string | null; site: string | null } | null> {
  const signal = AbortSignal.timeout(LIMITS.timeoutMs);
  try {
    let url = link;
    for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
      if (!(await resolvesPublic(url.hostname.replace(/\.$/, ""), signal))) return null;
      const response = await fetch(url, {
        redirect: "manual",
        signal,
        headers: { Accept: "text/html", "User-Agent": "SpaghettiLinkPreview/1.0" },
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel().catch(() => undefined);
        const next = checkLinkUrl(new URL(location, url).href);
        if (!next) return null;
        url = next;
        continue;
      }
      if (!response.ok) return null;
      const type = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!type.startsWith("text/html") && !type.startsWith("application/xhtml+xml")) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      const preview = readPreview(await readCapped(response, LIMITS.maxBytes));
      return preview.title || preview.site ? preview : null;
    }
    return null;
  } catch {
    return null;
  }
}
