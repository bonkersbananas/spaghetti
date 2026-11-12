# Prisjakt lookup for the shopping list: feasibility (Nov 12)

Question (Carl Oscar, Nov 12): can a thing added to the shopping list get its Prisjakt page, its picture and the 1–3 cheapest offers by itself? This revisits [0034](../decisions/0034-shopping-list-links-not-prices.md).

## What was tried

Probed from the sandbox with curl, and from Cloudflare's network with a throwaway `wrangler dev --remote` Worker (killed by PID afterwards).

| Need | Result |
| --- | --- |
| Read a product page (`/produkt.php?p=<id>`) from a Worker | Works: 200 from Cloudflare's network with a plain link-card user agent (unlike Printables, which blocks Workers). About 770 kB per page. |
| Picture | Works: `og:image` and JSON-LD `Product.image` give `cdn.pji.nu/product/standard/800/<id>.jpg`. |
| Cheapest price | Works: JSON-LD `AggregateOffer` has `lowPrice`, `highPrice`, `offerCount`, `priceCurrency` (SEK). |
| 1–3 cheapest offers (shop, price, link) | Works, but not from JSON-LD: the page's embedded Next.js payload holds `offerRows` (shopId, price, stock status, shop logo, clickout URL), sorted cheapest first, and a price-history block carries `shopName` for shops. It is an internal format, so the parser must fail quietly if it changes. The clickout URL (`/go-to-shop/…`) is disallowed by robots.txt: link to the product page instead. |
| Find the product page from a free-text name or a shop link | Not possible directly: Prisjakt's search (`/search?…`) is disallowed by robots.txt (and answers 404 to a Worker). The remaining route is Claude with Anthropic's web search limited to `prisjakt.nu`, which returns a candidate page; the Worker would check the address (`prisjakt.nu/produkt.php?p=<digits>`) and read the page itself, so no price comes from Claude. **Not tested live: this sandbox has no `ANTHROPIC_API_KEY`.** |

No official API or feed for individuals was found (Prisjakt has partner and affiliate programs only).

## Robots and terms

- robots.txt allows product pages and disallows search, `/go-to-shop`, `/redirect.php` and `/extern/`.
- The terms of use (`/information/anvandarvillkor`) forbid automated collection of data from the services (crawling, scraping, indexing, "including AI models") except what robots.txt permits, forbid republishing or copying their material to the public, and forbid anything that puts unreasonable load on them.

A product page fetch is within robots.txt, and one page per thing per day, kept private for two people, is far from load. But the wording on automated collection and on AI models is broad, so this is a judgement call, not a clear yes. Nothing from a Prisjakt page should be handed to Claude; only its search finds the address.

## Cost per lookup (estimate, unverified)

Web search is billed per search (about $0.01) plus a few thousand tokens for the model: roughly 1–3 cents per match, once per thing. Refreshing prices needs no Claude call: one Worker fetch of the product page.

## Outcome

Carl Oscar chose the boundary the terms allow (Nov 12): pasted Prisjakt links read by the Worker, plus a shop page's `og:image` where its robots.txt allows. Then he allowed one step more: Claude's web search over a search engine's index (not a fetch of Prisjakt, not Prisjakt's search) may suggest one product page for a thing with no link, which a person confirms. Recorded in [0039](../decisions/0039-shopping-list-reads-the-prisjakt-pages-people-link.md). Whether the search finds the right page reliably could be tested only with a stand-in server in this sandbox (no key); how often it matches in real use is still to be seen.
