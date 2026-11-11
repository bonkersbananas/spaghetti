/**
 * The shopping list's pure rules: what's still to buy and what was bought, links to a shop and to Prisjakt.
 * The Worker validates with these limits and the client shows the same order.
 */
import { shortUrl } from "./links.ts";

export const SHOPPING_NAME_MAX = 120;
export const SHOPPING_LINK_MAX = 2000;
/** More than anyone keeps on a list; a runaway agent stops here. */
export const SHOPPING_ITEMS_MAX = 300;

/** Prisjakt's sites (Sweden first, where the printer lives) and its English and Finnish names. */
const PRICE_HOSTS = ["prisjakt.nu", "prisjakt.no", "pricespy.co.uk", "pricespy.co.nz", "hintaopas.fi"];

/** True for a page on Prisjakt (any of its countries), which belongs in the price link, not the shop link. */
export function isPriceLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return PRICE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
  } catch {
    return false;
  }
}

/** Prisjakt's search for a name, for things that don't have their Prisjakt page linked yet. */
export function priceSearchUrl(name: string): string {
  return `https://www.prisjakt.nu/search?search=${encodeURIComponent(name.trim())}`;
}

/** Only http(s) addresses are kept as links. */
export function isWebLink(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * A shop's page title without the shop's name after it: "Liquid Glue for Build Plate | Bambu Lab EU Store"
 * → "Liquid Glue for Build Plate". Only a tail after " | ", " – " or " - " that names the site is dropped.
 */
export function tidyPageTitle(title: string, site?: string | null): string {
  const trimmed = title.trim();
  const parts = trimmed.split(/\s+[|–—-]\s+/);
  if (parts.length < 2) return trimmed;
  const head = parts[0]?.trim() ?? "";
  if (!head) return trimmed;
  const tail = parts.slice(1).join(" ").toLowerCase();
  const squeezed = tail.replace(/[^a-z0-9]/g, "");
  const siteWords = (site ?? "")
    .toLowerCase()
    .replace(/^www\./, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !["com", "store", "shop", "www"].includes(word));
  const looksLikeSite =
    siteWords.some((word) => squeezed.includes(word)) || /\b(store|shop|butik|webshop|official)\b/.test(tail);
  return looksLikeSite ? head : trimmed;
}

interface Listed {
  id: string;
  position: number;
  boughtAt: number | null;
}

/** What's still to buy in the order people gave it, and what was bought, the latest first. */
export function splitShopping<T extends Listed>(items: T[]): { toBuy: T[]; bought: T[] } {
  const toBuy = items
    .filter((item) => item.boughtAt === null)
    .sort((a, b) => a.position - b.position || (a.id > b.id ? 1 : -1));
  const bought = items
    .filter((item) => item.boughtAt !== null)
    .sort((a, b) => (b.boughtAt ?? 0) - (a.boughtAt ?? 0) || (a.id > b.id ? 1 : -1));
  return { toBuy, bought };
}

/** What a thing on the list is called: its name, else what its page is called, else its short address. */
export function shoppingName(item: { name: string; link: string | null }, pageTitle?: string | null): string {
  if (item.name.trim()) return item.name.trim();
  if (pageTitle?.trim()) return pageTitle.trim();
  return item.link ? shortUrl(item.link) : "Something to buy";
}
