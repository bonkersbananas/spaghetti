import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem, ShoppingItemResponse } from "../../src/shared/api.ts";
import { SUGGESTIONS_PER_DAY } from "../../src/shared/prisjakt.ts";
import { app } from "../../src/worker/app.ts";
import { lookupShopping, refreshPrices } from "../../src/worker/shopping/lookup.ts";
import { suggestPage } from "../../src/worker/shopping/suggest.ts";
import productPage from "../fixtures/pages/prisjakt-product.html?raw";
import { addUser, ORIGIN, request, resetDb, signIn } from "./helpers.ts";

const PRODUCT = "https://www.prisjakt.nu/produkt.php?p=15633708";
const PRODUCT_PICTURE = "https://cdn.pji.nu/product/standard/800/15633708.jpg";
const SHOP = "https://www.kjell.com/se/produkter/pla-basic";

const jpeg = () =>
  new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0xb0, 0x06, 0x40, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ]);
const png = () =>
  new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 0x20, 0, 0, 2, 0x58,
    8, 6, 0, 0, 0,
  ]);
const gif = () => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0]);

type Search = { results?: string[]; answer?: unknown; stopReason?: string; status?: number };
let searches: Array<Record<string, unknown>> = [];
let searching: Search = {};
const found = (n = 1) => `https://www.prisjakt.nu/produkt.php?p=${n}`;

interface Web {
  /** Prisjakt's product page. */
  product?: { status?: number; body?: string };
  /** The shop's robots.txt (a status for a failed one, or where it redirects) and page. */
  robots?: string | number | { redirect: string };
  shopPage?: string;
  shopImage?: "jpeg" | "png" | "gif";
}

let asked: string[] = [];
function stubWeb(web: Web = {}) {
  asked = [];
  searches = [];
  searching = {};
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    asked.push(url.href);
    if (url.hostname === "cloudflare-dns.com") {
      // Bambu Lab's EU store sends its robots.txt to a name with no DNS at all.
      if (url.searchParams.get("name") === "www.kjell.combots.txt") return Response.json({ Status: 3 });
      return Response.json({
        Status: 0,
        Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "93.184.216.34" }] : [],
      });
    }
    if (url.hostname === "api.anthropic.com") {
      searches.push(JSON.parse(String(init?.body)));
      if (searching.status) {
        return Response.json(
          { type: "error", error: { type: "api_error", message: "no" } },
          { status: searching.status },
        );
      }
      const results = searching.results ?? [found(7)];
      return Response.json({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content:
          searching.stopReason === "refusal"
            ? []
            : [
                {
                  type: "web_search_tool_result",
                  tool_use_id: "t",
                  content: results.map((u) => ({
                    type: "web_search_result",
                    url: u,
                    title: "PLA Basic",
                    encrypted_content: "x",
                  })),
                },
                { type: "text", text: JSON.stringify(searching.answer ?? { url: found(7), title: "PLA Basic" }) },
              ],
        stop_reason: searching.stopReason ?? "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    }
    const html = { "Content-Type": "text/html" };
    if (url.href === PRODUCT) {
      return new Response(web.product?.body ?? productPage, { status: web.product?.status ?? 200, headers: html });
    }
    if (url.href === PRODUCT_PICTURE) return new Response(jpeg(), { headers: { "Content-Type": "image/jpeg" } });
    if (url.href === "https://www.kjell.com/robots.txt") {
      const robots = web.robots ?? "User-agent: *\nDisallow: /search";
      if (typeof robots === "object")
        return new Response(null, { status: 302, headers: { Location: robots.redirect } });
      return typeof robots === "number" ? new Response("", { status: robots }) : new Response(robots);
    }
    if (url.href === SHOP) {
      return new Response(
        web.shopPage ?? `<html><head><meta property="og:image" content="/img/pla.jpg"></head></html>`,
        { headers: html },
      );
    }
    if (url.href === "https://www.kjell.com/img/pla.jpg") {
      const kind = web.shopImage ?? "jpeg";
      return new Response({ jpeg, png, gif }[kind](), { headers: { "Content-Type": `image/${kind}` } });
    }
    if (url.href === "https://www.kjell.com.example/robots.txt") return new Response("User-agent: *\nDisallow: /");
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

  it("reads the page when robots.txt isn't there: a 4xx, or a redirect to a name that doesn't exist", async () => {
    for (const robots of [404, 403, { redirect: "https://www.kjell.combots.txt/" }] as const) {
      stubWeb({ robots });
      const added = await add({ name: "PLA Basic", link: SHOP });
      await settled(added.id, (item) => item.picture?.source === "shop");
    }
  });

  it("reads nothing when robots.txt disallows the page, or can't be read", async () => {
    for (const robots of [
      "User-agent: *\nDisallow: /se/",
      "User-agent: SpaghettiPriceCheck\nDisallow: /",
      503,
      { redirect: "https://www.kjell.com.example/robots.txt" },
    ] as const) {
      stubWeb({ robots });
      const added = await add({ name: "PLA Basic", link: SHOP });
      await settled(added.id, () => asked.some((url) => url.endsWith("/robots.txt")));
      await vi.waitFor(() => expect(asked.length).toBeGreaterThan(0));
      expect((await get(added.id)).picture).toBeNull();
      expect(asked).not.toContain(SHOP);
    }
  });

  it("keeps a PNG picture as a PNG", async () => {
    stubWeb({ shopImage: "png" });
    const added = await add({ name: "Liquid glue", link: SHOP });
    await settled(added.id, (item) => item.picture?.source === "shop");
    const picture = await request((await get(added.id)).picture?.url ?? "", { cookie });
    expect(picture.headers.get("content-type")).toBe("image/png");
  });

  it("keeps no picture that isn't a JPEG, PNG or WebP, and doesn't ask again for the same link", async () => {
    stubWeb({ shopImage: "gif" });
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

  it("goes back to the shop's picture when the Prisjakt link is removed", async () => {
    const added = await add({ name: "PLA Basic", link: SHOP });
    await settled(added.id, (item) => item.picture?.source === "shop");
    await patch(added.id, { priceLink: PRODUCT });
    await settled(added.id, (item) => item.picture?.source === "prisjakt");
    await patch(added.id, { priceLink: null });
    expect((await get(added.id)).picture).toBeNull();
    await settled(added.id, (item) => item.picture?.source === "shop");
  });
});

describe("the daily refresh", () => {
  it("keeps the picture it has, so its address stays the same", async () => {
    const added = await add({ name: "Bambu P2S", priceLink: PRODUCT });
    await settled(added.id, (item) => !!item.prices && !!item.picture);
    const before = await get(added.id);
    await setTried(added.id, Date.now() - 25 * 3600_000);
    stubWeb();
    await refreshPrices(env);
    expect(asked).not.toContain(PRODUCT_PICTURE);
    const after = await get(added.id);
    expect(after.picture?.url).toBe(before.picture?.url);
    expect(after.prices?.checkedAt).toBeGreaterThanOrEqual(before.prices?.checkedAt ?? 0);
  });
});

describe("suggesting a Prisjakt page", () => {
  /** A thing with a name and nothing else, once the background search has finished. */
  async function named(name = "PLA Basic black 1 kg Bambu") {
    const added = await add({ name });
    await settled(added.id, (item) => item.suggestState !== "searching" && item.suggestState !== null);
    return added.id;
  }

  it("suggests the one page the search returned, and uses nothing until a person says yes", async () => {
    const id = await named();
    const item = await get(id);
    expect(item).toMatchObject({
      suggestState: "found",
      suggestion: { url: found(7), title: "PLA Basic" },
      priceLink: null,
    });
    // Claude sees the name, searches only prisjakt.nu with the search tool, and fetches nothing.
    expect(searches).toHaveLength(1);
    const asked = searches[0] as { tools: Array<Record<string, unknown>>; messages: Array<{ content: string }> };
    expect(asked.tools).toEqual([
      expect.objectContaining({ type: "web_search_20250305", allowed_domains: ["prisjakt.nu"] }),
    ]);
    expect(asked.messages[0]?.content).toContain("PLA Basic black 1 kg Bambu");
    // No Prisjakt page was read, and the thing has no prices.
    expect(asked.tools.some((tool) => String(tool.type).includes("fetch"))).toBe(false);
    expect(item.prices).toBeNull();
    expect(item.pricesTriedAt).toBeNull();

    // "Use it" is a plain change of the Prisjakt link: now the page is read, and the suggestion goes.
    stubWeb();
    const used = await patch(id, { priceLink: item.suggestion?.url });
    expect((await used.json<ShoppingItemResponse>()).shoppingItem.suggestion).toBeNull();
  });

  it("asks once per name, and again when asked", async () => {
    const id = await named();
    expect(await suggestPage(env, id)).toBe(false);
    expect(searches).toHaveLength(1);
    expect((await request(`/api/shopping-items/${id}/suggest`, { method: "POST", cookie })).status).toBe(200);
    expect(searches).toHaveLength(2);
  });

  it("remembers 'not this one'", async () => {
    const id = await named();
    const dismissed = await request(`/api/shopping-items/${id}/suggestion/dismiss`, { method: "POST", cookie });
    expect((await dismissed.json<ShoppingItemResponse>()).shoppingItem.suggestion).toBeNull();
    // Asked again, the same page comes back: it isn't offered a second time.
    await request(`/api/shopping-items/${id}/suggest`, { method: "POST", cookie });
    const item = await get(id);
    expect(item.suggestion).toBeNull();
    expect(item.suggestState).toBe("none");
    expect((searches[1] as { messages: Array<{ content: string }> }).messages[0]?.content).toContain(found(7));
  });

  it("keeps nothing when nothing matches, the answer isn't a search result, or it isn't a product page", async () => {
    for (const search of [
      { answer: { url: null, title: null } },
      { answer: { url: found(999), title: "Made up" } },
      {
        results: ["https://www.prisjakt.nu/c/3d-skrivare"],
        answer: { url: "https://www.prisjakt.nu/c/3d-skrivare", title: "x" },
      },
      { results: [found(7)], answer: { url: "https://evil.test/produkt.php?p=7", title: "x" } },
    ] satisfies Search[]) {
      searching = search;
      const id = await named();
      expect(await get(id)).toMatchObject({ suggestion: null, suggestState: "none" });
    }
  });

  it("is quiet about a refusal and an API error", async () => {
    for (const search of [{ stopReason: "refusal" }, { status: 500 }] satisfies Search[]) {
      searching = search;
      const id = await named();
      expect(await get(id)).toMatchObject({ suggestion: null, suggestState: "none" });
    }
  });

  it("stops at the day's cap", async () => {
    for (let n = 0; n < SUGGESTIONS_PER_DAY; n++) {
      await env.DB.prepare("INSERT INTO shopping_searches (id, item_id, at, outcome) VALUES (?, 'x', ?, 'none')")
        .bind(crypto.randomUUID(), Date.now())
        .run();
    }
    const added = await add({ name: "PLA Basic black" });
    await vi.waitFor(async () => expect((await get(added.id)).suggestState).toBe("none"));
    expect(searches).toHaveLength(0);
    // Not marked as searched: once there is room again (the next day), the same name is searched without being forced.
    await env.DB.prepare("DELETE FROM shopping_searches").run();
    expect(await suggestPage(env, added.id)).toBe(true);
    expect(searches).toHaveLength(1);
  });

  it("doesn't search for a thing that has a Prisjakt link, a link only, or a name too short to say anything", async () => {
    await add({ name: "PLA Basic", priceLink: PRODUCT });
    await add({ link: SHOP });
    await add({ name: "PL" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(searches).toHaveLength(0);
  });

  it("searches once a thing added with only a link gets its name, but not on every rename", async () => {
    const added = await add({ link: SHOP });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(searches).toHaveLength(0);
    // The app names it from the page's title right after the add.
    await patch(added.id, { name: "Liquid Glue for Build Plate" });
    await settled(added.id, (item) => item.suggestState === "found");
    expect(searches).toHaveLength(1);
    await patch(added.id, { name: "Liquid glue" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(searches).toHaveLength(1);
  });

  it("is hidden without the key", async () => {
    const bare = { ...env, ANTHROPIC_API_KEY: undefined } as unknown as Env;
    const features = await app.fetch(new Request(`${ORIGIN}/api/features`, { headers: { Cookie: cookie } }), bare);
    expect((await features.json<{ priceSuggestions: boolean }>()).priceSuggestions).toBe(false);
    expect(
      (await (await request("/api/features", { cookie })).json<{ priceSuggestions: boolean }>()).priceSuggestions,
    ).toBe(true);
    const added = await add({ name: "PLA Basic black" });
    await vi.waitFor(async () => expect((await get(added.id)).suggestState).not.toBeNull());
    const ask = await app.fetch(
      new Request(`${ORIGIN}/api/shopping-items/${added.id}/suggest`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: ORIGIN },
      }),
      bare,
    );
    expect(ask.status).toBe(404);
    expect(await suggestPage(bare, added.id, { force: true })).toBe(false);
  });
});
