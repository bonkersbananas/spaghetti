/**
 * What the link-preview endpoint may fetch, and how it reads a page. Pure, so
 * it is unit-tested in Node; the fetching itself is in src/worker/link-preview.ts.
 *
 * The Worker (or the container, on someone's home network) would fetch any
 * address it is given, so the rules are strict: https only, no credentials, the
 * default port, a real public-looking name. Never an address, a one-word host
 * or something local, and the same checks run again on every redirect.
 */

/** Host suffixes that mean "somewhere on a home or office network". */
const LOCAL_SUFFIXES = [".local", ".internal", ".localhost", ".localdomain", ".lan", ".home", ".home.arpa", ".corp"];

/**
 * The link as a URL if it is safe to fetch, else null: `https:` only, no
 * username or password, no port, and a host that isn't an IP address,
 * `localhost`, a single word (a name on the local network) or a local suffix.
 * The URL parser has already turned 2130706433 or 0x7f.1 into 127.0.0.1, so
 * those are caught as addresses.
 */
export function checkLinkUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.startsWith("[") || host.includes(":")) return null; // IPv6
  if (/^[0-9.]+$/.test(host)) return null; // IPv4, in any spelling
  if (!host.includes(".") || host === "localhost") return null;
  if (LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
  url.hash = "";
  return url;
}

function ipv4Octets(ip: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((n) => n <= 255) ? octets : null;
}

function publicIpv4([a, b, c]: number[]): boolean {
  if (a === undefined || b === undefined || c === undefined) return false;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return true;
}

/** Expands an IPv6 address to eight 16-bit groups, or null when it can't be read. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail) {
    const octets = ipv4Octets(tail[1] as string);
    if (!octets) return null;
    const [a, b, c, d] = octets as [number, number, number, number];
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":") : []);
  const head = parse(halves[0] ?? "");
  const rest = parse(halves[1] ?? "");
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest].map((g) =>
    /^[0-9a-f]{1,4}$/.test(g) ? Number.parseInt(g, 16) : Number.NaN,
  );
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
}

/** Whether an IPv4 or IPv6 address is one on the open internet (not private, loopback, link-local or reserved). */
export function isPublicAddress(ip: string): boolean {
  const v4 = ipv4Octets(ip);
  if (v4) return publicIpv4(v4);
  const groups = ipv6Groups(ip);
  if (!groups) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [number, number, number, number, number, number, number, number];
  if (groups.every((g) => g === 0) || (groups.slice(0, 7).every((g) => g === 0) && g7 === 1)) return false; // :: and ::1
  if ((g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xff00) === 0xff00) return false; // ULA, link-local, multicast
  // IPv4 inside IPv6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d) and NAT64 (64:ff9b::a.b.c.d).
  const embedded = [g6 >> 8, g6 & 255, g7 >> 8, g7 & 255];
  const mapped = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0);
  const nat64 = g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;
  if (mapped || nat64) return publicIpv4(embedded);
  if (g0 === 0x2001 && g1 === 0xdb8) return false; // documentation
  return true;
}

export const MAX_TITLE = 200;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1]?.toLowerCase() === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Plain text from a tag's text: entities decoded, control characters and extra whitespace gone, at most 200 characters. */
function clean(text: string | undefined): string | null {
  if (!text) return null;
  const printable = [...decodeEntities(text)].map((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? " " : char;
  });
  const plain = printable.join("").replace(/\s+/g, " ").trim();
  return plain ? plain.slice(0, MAX_TITLE).trim() : null;
}

/**
 * The title and site name of an HTML page, from its head only: `og:title`,
 * else `<title>`; `og:site_name`. Nothing else is read and nothing is run.
 */
export function readPreview(html: string): { title: string | null; site: string | null } {
  const end = html.search(/<\/head\s*>|<body[\s>]/i);
  const head = end >= 0 ? html.slice(0, end) : html;
  const meta = new Map<string, string>();
  for (const tag of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const attr of tag[0].matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs.set((attr[1] as string).toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? "");
    }
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
    const content = attrs.get("content");
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1];
  return {
    title: clean(meta.get("og:title")) ?? clean(titleTag),
    site: clean(meta.get("og:site_name")),
  };
}
