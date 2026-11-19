import { findLinks, shortUrl } from "@shared/links";
import { cleanModelUrl } from "@shared/model-mark";

/** Links read better short on a card: printables.com/model/123, a model page without ?from=search and the like. */
export function shortenLinks(text: string): string {
  let result = text;
  for (const { url } of findLinks(text).reverse()) result = result.replace(url, shortUrl(cleanModelUrl(url)));
  return result;
}
