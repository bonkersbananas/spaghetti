import { findLinks, shortUrl } from "@shared/links";
import { cleanModelUrl } from "@shared/model-mark";
import { Fragment, type ReactNode } from "react";

/**
 * Plain text with its links as anchors that open in a new tab, each read short: no scheme or www., and a model page
 * without the bits that only track where it was found. `textOf` may name a link in its own words (the model's title).
 */
export function linkify(text: string, linkClassName: string, textOf?: (url: string) => string | undefined): ReactNode {
  const links = findLinks(text);
  if (!links.length) return text;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const { url, start, end } of links) {
    if (start > at) parts.push(<Fragment key={`t${at}`}>{text.slice(at, start)}</Fragment>);
    const href = cleanModelUrl(url);
    parts.push(
      <a key={`l${start}`} href={href} target="_blank" rel="noopener noreferrer" className={linkClassName}>
        {textOf?.(url) ?? shortUrl(href)}
      </a>,
    );
    at = end;
  }
  if (at < text.length) parts.push(<Fragment key={`t${at}`}>{text.slice(at)}</Fragment>);
  return parts;
}
