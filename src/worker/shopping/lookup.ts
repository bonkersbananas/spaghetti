import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { checkLinkUrl } from "../../shared/link-safety.ts";
import { prisjaktProduct, readProductPage, type ShoppingPrices } from "../../shared/prisjakt.ts";
import { robotsAllows } from "../../shared/robots.ts";
import { recordChange } from "../changes.ts";
import { type Db, getDb } from "../db/index.ts";
import { type ShoppingItemRow, shoppingItems } from "../db/schema.ts";
import { readCapped, resolvesPublic } from "../link-preview.ts";
import { fromUrl, readImage } from "../mcp/image.ts";

/**
 * Reading the pages people linked on their shopping list (decision 0039): a Prisjakt product page for its picture
 * and cheapest offers, a shop page for its picture. Only a page a person linked, only within the site's
 * robots.txt, only for the two of us; nothing here searches, and no page is shown to a model.
 */

/** Our name in robots.txt and in the User-Agent. */
const AGENT = "SpaghettiPriceCheck";
const USER_AGENT = `Mozilla/5.0 (compatible; ${AGENT}/1.0)`;
const TIMEOUT_MS = 10_000;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 2;
/** An unbought thing's prices are looked at again after this long, no sooner. */
export const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
/** "Check prices again" twice in a row within this long does nothing the second time. */
const RECHECK_GAP_MS = 20_000;
/** Things read in one cron run (every 5 minutes), so the day's refresh trickles out. */
const REFRESH_PER_RUN = 3;

export const shoppingPictureKey = (id: string) => `shopping/${id}/picture`;

/** The e2e tests and screenshots point the Worker at a stand-in server, which then stands in for every site read here. */
const standInOrigin = (env: Pick<Env, "ANTHROPIC_BASE_URL">) =>
  env.ANTHROPIC_BASE_URL?.trim() ? new URL(env.ANTHROPIC_BASE_URL.trim()).origin : null;

async function robotsPermit(url: URL, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(new URL("/robots.txt", url), {
      headers: { "User-Agent": USER_AGENT },
      signal,
      redirect: "follow",
    });
    // No robots.txt means no rules; any other trouble means we don't know, so we don't read.
    if (response.status === 404 || response.status === 410) return true;
    if (!response.ok) return false;
    return robotsAllows(await readCapped(response, 512 * 1024), url.pathname + url.search, AGENT);
  } catch {
    return false;
  }
}

interface GetOptions {
  /** Check the site's robots.txt for every address read (shops; Prisjakt's product pages are allowed by theirs and checked in tests). */
  robots: boolean;
  /** Check that the name resolves to public addresses (anything a person typed in). */
  publicOnly: boolean;
  /** Hosts a redirect may go to. */
  stay?: (host: string) => boolean;
}

/** Reads a page's HTML. Never throws; null for anything but a readable page. */
async function getHtml(start: URL, options: GetOptions): Promise<string | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (options.stay && !options.stay(url.hostname)) return null;
      if (options.publicOnly && !(await resolvesPublic(url.hostname.replace(/\.$/, ""), signal))) return null;
      if (options.robots && !(await robotsPermit(url, signal))) return null;
      const response = await fetch(url, {
        redirect: "manual",
        signal,
        headers: { Accept: "text/html", "Accept-Language": "sv,en;q=0.8", "User-Agent": USER_AGENT },
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel().catch(() => undefined);
        const next = new URL(location, url);
        if (!(options.publicOnly ? checkLinkUrl(next.href) : /^https?:$/.test(next.protocol))) return null;
        url = next;
        continue;
      }
      const type = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!response.ok || !(type.startsWith("text/html") || type.startsWith("application/xhtml+xml"))) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      return await readCapped(response, MAX_PAGE_BYTES);
    }
  } catch {
    // Quiet: a page that can't be read leaves the thing as it was.
  }
  return null;
}

/** The picture a shop page names for itself (og:image, else twitter:image), as an absolute address. */
export function pageImage(html: string, base: URL): string | null {
  for (const key of ["og:image:secure_url", "og:image", "twitter:image"]) {
    for (const tag of html.slice(0, 256 * 1024).match(/<meta\b[^>]*>/gi) ?? []) {
      const name = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
      const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (name === key && content) {
        try {
          return new URL(content.replace(/&amp;/g, "&"), base).href;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function putPicture(env: Env, id: string, bytes: Uint8Array) {
  const image = readImage(bytes);
  await env.PHOTOS.put(shoppingPictureKey(id), image.bytes, { httpMetadata: { contentType: image.contentType } });
}

/** Downloads a picture and keeps it in R2; false when it isn't a JPEG or WebP, or can't be had. */
async function storePicture(env: Env, id: string, url: string, check: { robots: boolean; standIn: boolean }) {
  try {
    const parsed = new URL(url);
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    if (!check.standIn) {
      if (!(await resolvesPublic(parsed.hostname.replace(/\.$/, ""), signal))) return false;
      if (check.robots && !(await robotsPermit(parsed, signal))) return false;
    }
    await putPicture(env, id, await fromUrl(url, "manual", check.standIn));
    return true;
  } catch {
    return false;
  }
}

/** Prisjakt's pictures live on its own image host. */
const prisjaktImage = (url: string) => {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && hostname === "cdn.pji.nu";
  } catch {
    return false;
  }
};

interface Outcome {
  prices?: ShoppingPrices | null;
  picture?: { source: "prisjakt" | "shop" } | null;
  pictureTried?: string;
  triedPrices?: boolean;
}

async function lookupPrices(env: Env, row: ShoppingItemRow, standIn: string | null): Promise<Outcome> {
  if (!row.priceLink) return {};
  const product = prisjaktProduct(row.priceLink);
  // Another price site's link is kept as it is: nothing is read from it, and it isn't asked about again.
  if (!product) return { triedPrices: true };
  const address = standIn ? new URL(`/produkt.php?p=${product.id}`, standIn) : new URL(product.url);
  const html = await getHtml(address, {
    robots: false,
    publicOnly: false,
    stay: (host) => host === address.hostname || host === "www.prisjakt.nu" || host === "prisjakt.nu",
  });
  const read = html ? safeRead(html) : null;
  if (!read || read.low === null) return { triedPrices: true };
  const facts = { ...read, low: read.low };
  const outcome: Outcome = {
    triedPrices: true,
    prices: {
      checkedAt: Date.now(),
      lowest: facts.low,
      highest: facts.high,
      count: facts.count,
      offers: facts.offers,
    },
  };
  if (facts.image && (prisjaktImage(facts.image) || (standIn && facts.image.startsWith(`${standIn}/`)))) {
    if (await storePicture(env, row.id, facts.image, { robots: false, standIn: !!standIn })) {
      outcome.picture = { source: "prisjakt" };
    }
  }
  return outcome;
}

function safeRead(html: string) {
  try {
    return readProductPage(html);
  } catch {
    return null;
  }
}

async function lookupShopPicture(env: Env, row: ShoppingItemRow, standIn: string | null): Promise<Outcome> {
  if (!row.link || row.pictureTried === row.link) return {};
  const link = checkLinkUrl(row.link) ?? (standIn && row.link.startsWith(`${standIn}/`) ? new URL(row.link) : null);
  if (!link) return { pictureTried: row.link };
  const local = !!standIn && link.origin === standIn;
  const html = await getHtml(link, { robots: true, publicOnly: !local });
  const image = html ? pageImage(html, link) : null;
  if (image && (await storePicture(env, row.id, image, { robots: true, standIn: local }))) {
    return { pictureTried: row.link, picture: { source: "shop" } };
  }
  return { pictureTried: row.link };
}

/**
 * Looks at what a thing links to and keeps what it finds: a Prisjakt page's picture and cheapest offers, else its
 * shop page's picture. Never throws, never blocks an add (callers use waitUntil). `force` is "Check prices again".
 * Returns false when nothing was done because it was looked at a moment ago.
 */
export async function lookupShopping(
  env: Env,
  id: string,
  { force = false, db = getDb(env.DB) }: { force?: boolean; db?: Db } = {},
): Promise<boolean> {
  try {
    const row = await db
      .select()
      .from(shoppingItems)
      .where(and(eq(shoppingItems.id, id), isNull(shoppingItems.deletedAt)))
      .get();
    if (!row) return false;
    const now = Date.now();
    if (force && row.pricesTriedAt && now - row.pricesTriedAt.getTime() < RECHECK_GAP_MS) return false;
    const standIn = standInOrigin(env);
    const priced = await lookupPrices(env, row, standIn);
    // A Prisjakt picture is better than a shop's; the shop is only asked when there is none.
    const havePrisjakt = priced.picture?.source === "prisjakt" || (row.pictureSource === "prisjakt" && !!row.priceLink);
    const shop = havePrisjakt ? {} : await lookupShopPicture(env, row, standIn);
    const picture = priced.picture ?? shop.picture ?? null;
    const when = new Date(now);
    const changes = {
      ...(priced.triedPrices ? { pricesTriedAt: when } : {}),
      ...(priced.prices ? { prices: priced.prices } : {}),
      ...(picture ? { pictureSource: picture.source, pictureAt: when } : {}),
      ...(shop.pictureTried ? { pictureTried: shop.pictureTried } : {}),
    };
    if (!Object.keys(changes).length) return true;
    // Only if the Prisjakt link is still the one that was read.
    const written = await db
      .update(shoppingItems)
      .set(changes)
      .where(
        and(
          eq(shoppingItems.id, id),
          isNull(shoppingItems.deletedAt),
          row.priceLink ? eq(shoppingItems.priceLink, row.priceLink) : isNull(shoppingItems.priceLink),
        ),
      )
      .returning({ id: shoppingItems.id });
    if (written.length && (priced.prices || picture)) {
      await recordChange(db, {
        entity: "shopping",
        id,
        action: "updated",
        actor: { kind: "person", id: row.createdBy },
      });
    }
    return true;
  } catch (error) {
    console.error("shopping lookup failed", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * The gentle daily refresh, from the 5-minute cron: unbought things with a Prisjakt link that weren't looked at in
 * the last day, a few per run.
 */
export async function refreshPrices(env: Env, now = Date.now()): Promise<number> {
  const db = getDb(env.DB);
  const due = await db
    .select({ id: shoppingItems.id })
    .from(shoppingItems)
    .where(
      and(
        isNull(shoppingItems.deletedAt),
        isNull(shoppingItems.boughtAt),
        isNotNull(shoppingItems.priceLink),
        or(isNull(shoppingItems.pricesTriedAt), lt(shoppingItems.pricesTriedAt, new Date(now - REFRESH_AFTER_MS))),
      ),
    )
    .limit(REFRESH_PER_RUN);
  for (const { id } of due) await lookupShopping(env, id, { db });
  return due.length;
}
