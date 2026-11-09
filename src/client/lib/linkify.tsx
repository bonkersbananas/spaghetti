import { findLinks, shortUrl } from "@shared/links";
import { Fragment, type ReactNode } from "react";

/** Plain text with its links as anchors that open in a new tab. */
export function linkify(text: string, linkClassName: string): ReactNode {
  const links = findLinks(text);
  if (!links.length) return text;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const { url, start, end } of links) {
    if (start > at) parts.push(<Fragment key={`t${at}`}>{text.slice(at, start)}</Fragment>);
    parts.push(
      <a key={`l${start}`} href={url} target="_blank" rel="noopener noreferrer" className={linkClassName}>
        {shortUrl(url)}
      </a>,
    );
    at = end;
  }
  if (at < text.length) parts.push(<Fragment key={`t${at}`}>{text.slice(at)}</Fragment>);
  return parts;
}
