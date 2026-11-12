/**
 * What a Prisjakt product page states (decision 0039): the product's picture, its lowest price and the cheapest
 * offers. Read from a page a person linked, never searched for. The parser is pure and fails quietly: a page whose
 * format changed gives null, not a wrong price.
 */

/** A shop's offer for the product, as found at one time. */
export interface PriceOffer {
  shop: string;
  /** Whole kronor. */
  price: number;
  inStock: boolean;
}

export interface ProductFacts {
  name: string | null;
  /** The product picture's address (on Prisjakt's image host). */
  image: string | null;
  /** The lowest, highest and number of offers the page states, in kronor. */
  low: number | null;
  high: number | null;
  count: number | null;
  /** Up to three, in stock first, each shop once, cheapest first. */
  offers: PriceOffer[];
}

export const MAX_OFFERS = 3;

/** The product page's canonical address when a link is one on prisjakt.nu (the Swedish site, prices in SEK), else null. */
export function prisjaktProduct(link: string): { id: string; url: string } | null {
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "prisjakt.nu") return null;
    if (!/^\/(produkt|product)\.php$/.test(url.pathname)) return null;
    const id = url.searchParams.get("p");
    if (!id || !/^\d{1,12}$/.test(id)) return null;
    return { id, url: `https://www.prisjakt.nu/produkt.php?p=${id}` };
  } catch {
    return null;
  }
}

const num = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

function jsonLdProduct(html: string): Record<string, unknown> | null {
  for (const match of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1] ?? "");
      for (const node of Array.isArray(data) ? data : [data]) {
        if (node && typeof node === "object" && (node as { "@type"?: unknown })["@type"] === "Product") {
          return node as Record<string, unknown>;
        }
      }
    } catch {
      // Not JSON: try the next block.
    }
  }
  return null;
}

/** The page's embedded data is JSON inside a JS string, so its quotes are escaped. */
const unescaped = (html: string) => html.replace(/\\"/g, '"');

/**
 * The offers in the page's embedded data: each has a shop id, a price in SEK and a stock status; shop names are
 * stated elsewhere in the same data, by shop id.
 */
function readOffers(html: string): PriceOffer[] {
  const data = unescaped(html);
  const names = new Map<string, string>();
  for (const m of data.matchAll(/"shopId":(\d+),"shopOfferId":"[^"]*","shopName":"([^"]{1,80})"/g)) {
    if (m[1] && m[2]) names.set(m[1], m[2]);
  }
  const best = new Map<string, PriceOffer>();
  for (const m of data.matchAll(
    /"shopId":(\d+),"shopLogoUrl":"[^"]*","shopOfferId":"[^"]*"[^]{0,700}?"price":\{"amount":(\d+(?:\.\d+)?),"currency":"SEK"\}[^]{0,900}?"stockStatus":"(\w+)"/g,
  )) {
    const shop = names.get(m[1] ?? "");
    const price = num(m[2]);
    if (!shop || price === null) continue;
    const offer = { shop, price, inStock: m[3] === "InStock" };
    const seen = best.get(shop);
    if (!seen || (offer.inStock && !seen.inStock) || (offer.inStock === seen.inStock && offer.price < seen.price)) {
      best.set(shop, offer);
    }
  }
  return [...best.values()]
    .sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.price - b.price || a.shop.localeCompare(b.shop))
    .slice(0, MAX_OFFERS);
}

/** Reads a product page, or null when it states no price at all. */
export function readProductPage(html: string): ProductFacts | null {
  const product = jsonLdProduct(html);
  const offers = product?.offers as Record<string, unknown> | undefined;
  const low = num(offers?.lowPrice);
  if (!product || low === null || offers?.priceCurrency !== "SEK") return null;
  const image = typeof product.image === "string" ? product.image : null;
  let list: PriceOffer[] = [];
  try {
    list = readOffers(html);
  } catch {
    // The embedded data is optional: the lowest price stands alone.
  }
  return {
    name: typeof product.name === "string" ? product.name.slice(0, 200) : null,
    image: image && /^https:\/\//.test(image) ? image : null,
    low,
    high: num(offers?.highPrice),
    count: num(offers?.offerCount),
    offers: list,
  };
}

/** "189 kr", "7 699 kr" (a non-breaking space between thousands). */
export function formatKr(price: number): string {
  return `${Math.round(price)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ")} kr`;
}

/** What the app keeps of a check: found at a time, never a promise. */
export interface ShoppingPrices {
  /** When the page was read, epoch ms. */
  checkedAt: number;
  lowest: number;
  highest: number | null;
  count: number | null;
  offers: PriceOffer[];
}

/** Searches for a Prisjakt page, per day for the whole workspace: a key can't run up a bill. */
export const SUGGESTIONS_PER_DAY = 20;

/** A Prisjakt page that might be the thing, found through a search engine's results and waiting for a person's yes. */
export interface PriceSuggestion {
  /** A canonical product page address (`prisjaktProduct`). */
  url: string;
  /** The title the search result gave it. */
  title: string | null;
}

/** Where the looking stands: a search is on its way, it found a page to confirm, or it found nothing. */
export type SuggestState = "searching" | "found" | "none";
