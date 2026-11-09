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
