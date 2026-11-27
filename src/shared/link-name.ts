/**
 * What a link is called, read in full: its page's title without the site's name ("Gridfinity baseplate, 4x4 |
 * MakerWorld" is "Gridfinity baseplate, 4x4"), else a Printables address's words in their own casing (decision 0071),
 * else the words in its address's last part. The Worker sends it as `Item.linkTitle` (worker/link-titles.ts), so the
 * name rule every first load reads (item-name.ts) stays small.
 */
import { tidyPageTitle } from "./capture.ts";
import { addressName } from "./item-name.ts";
import { printablesTitleFromLink } from "./model-name.ts";

export function linkName(url: string, pageTitle?: string | null): string | null {
  const page = pageTitle?.replace(/\s+/g, " ").trim();
  if (page) return tidyPageTitle(page) ?? page;
  return printablesTitleFromLink(url) ?? addressName(url);
}
