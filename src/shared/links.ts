/** http(s) links, without trailing punctuation. */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

/** Finds http(s) links in plain text. */
export function findLinks(text: string): Array<{ url: string; start: number; end: number }> {
  return Array.from(text.matchAll(URL_PATTERN), (match) => ({
    url: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

/** True when the text is one link and nothing else (a pasted URL). */
export function isLink(text: string): boolean {
  const trimmed = text.trim();
  const [only] = findLinks(trimmed);
  return !!only && only.start === 0 && only.end === trimmed.length;
}

/** "https://www.printables.com/model/123-hook" → "printables.com/model/123-hook" */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

/**
 * The readable part of a link, for a card that is only a link: the words of its last path part that has some
 * ("ikea.com/se/en/p/skadis-pegboard-white-20320802" → "Skadis pegboard white"), numbers and the file extension left
 * out, and its site ("ikea.com"). Takes a full or a shortened address; undefined when no part has words.
 */
export function linkWords(link: string): { words: string; site: string } | undefined {
  const [site = "", ...path] = shortUrl(link.trim()).split(/[?#]/)[0]?.split("/") ?? [];
  for (const part of path.reverse()) {
    let decoded = part;
    try {
      decoded = decodeURIComponent(part);
    } catch {}
    const tokens = decoded.replace(/\.[a-z0-9]{2,5}$/i, "").split(/[-_+.:\s]+/);
    const words = tokens.filter((word) => /\p{L}/u.test(word) && !/\d{3,}/.test(word));
    // An id with a short prefix ("thing:12345") is not a name.
    const idOnly = words.length === 1 && tokens.length > 1 && (words[0]?.length ?? 0) <= 5;
    if (words.length && words.join("").length > 2 && !idOnly) {
      const text = words.slice(0, 8).join(" ").toLowerCase();
      return { words: text.charAt(0).toUpperCase() + text.slice(1), site };
    }
  }
  return undefined;
}
