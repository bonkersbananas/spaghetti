import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem, ShoppingItemResponse } from "../../src/shared/api.ts";
import { lookupShopping, refreshPrices } from "../../src/worker/shopping/lookup.ts";
import productPage from "../fixtures/pages/prisjakt-product.html?raw";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

const PRODUCT = "https://www.prisjakt.nu/produkt.php?p=15633708";
const PRODUCT_PICTURE = "https://cdn.pji.nu/product/standard/800/15633708.jpg";
const SHOP = "https://www.kjell.com/se/produkter/pla-basic";

const jpeg = () =>
  new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0xb0, 0x06, 0x40, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ]);
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

interface Web {
  /** Prisjakt's product page. */
  product?: { status?: number; body?: string };
  /** The shop's robots.txt (a status for a failed one) and page. */
  robots?: string | number;
  shopPage?: string;
  shopImage?: "jpeg" | "png";
}

let asked: string[] = [];
function stubWeb(web: Web = {}) {
  asked = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    asked.push(url.href);
    if (url.hostname === "cloudflare-dns.com") {
      return Response.json({
        Status: 0,
        Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "93.184.216.34" }] : [],
      });
    }
    const html = { "Content-Type": "text/html" };
    if (url.href === PRODUCT) {
      return new Response(web.product?.body ?? productPage, { status: web.product?.status ?? 200, headers: html });
    }
    if (url.href === PRODUCT_PICTURE) return new Response(jpeg(), { headers: { "Content-Type": "image/jpeg" } });
    if (url.href === "https://www.kjell.com/robots.txt") {
      const robots = web.robots ?? "User-agent: *\nDisallow: /search";
      return typeof robots === "number" ? new Response("", { status: robots }) : new Response(robots);
    }
    if (url.href === SHOP) {
      return new Response(
        web.shopPage ?? `<html><head><meta property="og:image" content="/img/pla.jpg"></head></html>`,
        { headers: html },
      );
    }
    if (url.href === "https://www.kjell.com/img/pla.jpg") {
      return new Response(web.shopImage === "png" ? png() : jpeg(), {
        headers: { "Content-Type": web.shopImage === "png" ? "image/png" : "image/jpeg" },
      });
    }
    return new Response("nope", { status: 404 });
  });
}

let cookie: string;
beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
  stubWeb();
});
afterEach(() => vi.restoreAllMocks());

async function add(json: Record<string, unknown>): Promise<ShoppingItem> {
  const response = await request("/api/shopping-items", {
    method: "POST",
    cookie,
    json: { id: crypto.randomUUID(), ...json },
  });
  expect(response.status).toBe(201);
  return (await response.json<ShoppingItemResponse>()).shoppingItem;
}
const get = async (id: string): Promise<ShoppingItem> =>
  (
    await (await request("/api/shopping-items", { cookie })).json<{ shoppingItems: ShoppingItem[] }>()
  ).shoppingItems.find((item) => item.id === id) as ShoppingItem;
/** The add returns at once; the lookup finishes in the background. */
const settled = (id: string, ready: (item: ShoppingItem) => boolean) =>
  vi.waitFor(async () => expect(ready(await get(id))).toBe(true), { timeout: 4000 });
const patch = (id: string, json: unknown) => request(`/api/shopping-items/${id}`, { method: "PATCH", cookie, json });
const setTried = (id: string, at: number | null) =>
  env.DB.prepare("UPDATE shopping_items SET prices_tried_at = ? WHERE id = ?").bind(at, id).run();

describe("prices from a Prisjakt product page", () => {
  it("fills in the picture and the cheapest offers in the background, and keeps them as found at a time", async () => {
    const added = await add({ name: "Bambu P2S", priceLink: PRODUCT });
    // The add itself didn't wait for the page.
    expect(added.prices).toBeNull();
    await settled(added.id, (item) => !!item.prices);
    const item = await get(added.id);
    expect(item.prices).toMatchObject({
      lowest: 7699,
      highest: 11439,
      count: 6,
      offers: [
        { shop: "3D Prima", price: 7699, inStock: true },
        { shop: "Webhallen", price: 7980, inStock: true },
        { shop: "Kjell & Company", price: 8049, inStock: true },
      ],
    });
    expect(Date.now() - (item.prices?.checkedAt ?? 0)).toBeLessThan(10_000);
    expect(item.picture?.source).toBe("prisjakt");
    const picture = await request(item.picture?.url ?? "/nope", { cookie });
    expect(picture.status).toBe(200);
    expect(picture.headers.get("Content-Type")).toBe("image/jpeg");
    // Only the product page and its picture: never the search or the go-to-shop clickouts.
    expect(asked.filter((url) => !url.includes("cloudflare-dns"))).toEqual([PRODUCT, PRODUCT_PICTURE]);
  });

  it("needs a session for the picture and for checking again", async () => {
    const added = await add({ name: "Bambu P2S", priceLink: PRODUCT });
    expect((await request(`/api/shopping-items/${added.id}/picture`)).status).toBe(401);
    expect((await request(`/api/shopping-items/${added.id}/check-prices`, { method: "POST" })).status).toBe(401);
  });

  it("reads only product pages on prisjakt.nu", async () => {
    const added = await add({ name: "PLA", priceLink: "https://www.prisjakt.nu/search?search=pla" });
    await settled(added.id, (item) => item.pricesTriedAt !== null);
    expect((await get(added.id)).prices).toBeNull();
    expect(asked.filter((url) => url.includes("prisjakt"))).toEqual([]);
  });

  it("fails quietly when the page's data changed or the page is gone, and keeps what it knew", async () => {
    const added = await add({ name: "Bambu P2S", priceLink: PRODUCT });
    await settled(added.id, (item) => !!item.prices);
    const before = (await get(added.id)).prices;

    stubWeb({ product: { body: "<html><body>New layout</body></html>" } });
    await setTried(added.id, 0);
    expect((await request(`/api/shopping-items/${added.id}/check-prices`, { method: "POST", cookie })).status).toBe(
      200,
    );
    let item = await get(added.id);
    expect(item.prices).toEqual(before);
    expect(item.pricesTriedAt).toBeGreaterThan(Date.now() - 10_000);

    stubWeb({ product: { status: 404 } });
    await setTried(added.id, 0);
    await request(`/api/shopping-items/${added.id}/check-prices`, { method: "POST", cookie });
    item = await get(added.id);
    expect(item.prices).toEqual(before);
  });

  it("checks again on request, but not twice within a moment", async () => {
    const added = await add({ name: "Bambu P2S", priceLink: PRODUCT });
    await settled(added.id, (item) => !!item.prices);
    stubWeb();
    await request(`/api/shopping-items/${added.id}/check-prices`, { method: "POST", cookie });
    expect(asked).toEqual([]);
    await setTried(added.id, Date.now() - 60_000);
    await request(`/api/shopping-items/${added.id}/check-prices`, { method: "POST", cookie });
    expect(asked.filter((url) => url === PRODUCT)).toHaveLength(1);
  });

  it("forgets the old prices and picture when the page is changed or cleared", async () => {
    const added = await add({ name: "Bambu P2S", priceLink: PRODUCT });
    await settled(added.id, (item) => !!item.prices && !!item.picture);
    stubWeb({ product: { status: 404 } });
    const changed = await patch(added.id, { priceLink: "https://www.prisjakt.nu/produkt.php?p=999" });
    const body = (await changed.json<ShoppingItemResponse>()).shoppingItem;
    expect(body.prices).toBeNull();
    expect(body.picture).toBeNull();
    await patch(added.id, { priceLink: null });
    const item = await get(added.id);
    expect(item.prices).toBeNull();
    expect(item.picture).toBeNull();
    expect((await request(`/api/shopping-items/${added.id}/picture`, { cookie })).status).toBe(404);
  });

  it("refreshes what is still to buy once a day, and leaves bought things alone", async () => {
    const wanted = await add({ name: "Bambu P2S", priceLink: PRODUCT });
    const got = await add({ name: "Bambu P2S again", priceLink: PRODUCT });
    await settled(wanted.id, (item) => !!item.prices);
    await settled(got.id, (item) => !!item.prices);
    await patch(got.id, { bought: true });
    stubWeb();
    // Looked at a moment ago: nothing to do.
    expect(await refreshPrices(env)).toBe(0);
    await setTried(wanted.id, Date.now() - 25 * 3600_000);
    await setTried(got.id, Date.now() - 25 * 3600_000);
    expect(await refreshPrices(env)).toBe(1);
    expect(asked.filter((url) => url === PRODUCT)).toHaveLength(1);
    expect((await get(wanted.id)).pricesTriedAt).toBeGreaterThan(Date.now() - 10_000);
    expect(await refreshPrices(env)).toBe(0);
  });

  it("does nothing for a thing with no Prisjakt link", async () => {
    const added = await add({ name: "Glue" });
    expect(await lookupShopping(env, added.id)).toBe(true);
    expect(asked).toEqual([]);
    expect(await refreshPrices(env)).toBe(0);
  });
});

describe("a shop link's picture", () => {
  it("takes the page's og:image when the shop's robots.txt allows it", async () => {
    const added = await add({ name: "PLA Basic", link: SHOP });
    await settled(added.id, (item) => !!item.picture);
    expect((await get(added.id)).picture?.source).toBe("shop");
    expect(asked).toContain("https://www.kjell.com/robots.txt");
    expect((await request((await get(added.id)).picture?.url ?? "", { cookie })).status).toBe(200);
  });

  it("reads nothing when robots.txt disallows the page, or can't be read", async () => {
    for (const robots of [
      "User-agent: *\nDisallow: /se/",
      "User-agent: SpaghettiPriceCheck\nDisallow: /",
      503,
    ] as const) {
      stubWeb({ robots });
      const added = await add({ name: "PLA Basic", link: SHOP });
      await settled(added.id, () => asked.some((url) => url.endsWith("/robots.txt")));
      await vi.waitFor(() => expect(asked.length).toBeGreaterThan(0));
      expect((await get(added.id)).picture).toBeNull();
      expect(asked).not.toContain(SHOP);
    }
  });

  it("keeps no picture that isn't a JPEG or WebP, and doesn't ask again for the same link", async () => {
    stubWeb({ shopImage: "png" });
    const added = await add({ name: "PLA Basic", link: SHOP });
    await settled(added.id, () => asked.includes("https://www.kjell.com/img/pla.jpg"));
    await vi.waitFor(async () => expect(await lookupShopping(env, added.id)).toBe(true));
    expect((await get(added.id)).picture).toBeNull();
    stubWeb();
    await lookupShopping(env, added.id);
    expect(asked).toEqual([]);
  });

  it("asks a new shop link for its picture and drops the old one's", async () => {
    const added = await add({ name: "PLA Basic", link: SHOP });
    await settled(added.id, (item) => !!item.picture);
    const changed = await patch(added.id, { link: "https://example.test/other" });
    expect((await changed.json<ShoppingItemResponse>()).shoppingItem.picture).toBeNull();
  });

  it("prefers the Prisjakt picture over the shop's", async () => {
    const added = await add({ name: "Bambu P2S", link: SHOP, priceLink: PRODUCT });
    await settled(added.id, (item) => item.picture?.source === "prisjakt");
    expect(asked).not.toContain(SHOP);
  });
});
