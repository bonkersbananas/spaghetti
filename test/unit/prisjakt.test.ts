import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatKr, prisjaktProduct, readProductPage } from "../../src/shared/prisjakt.ts";
import { robotsAllows } from "../../src/shared/robots.ts";

const page = readFileSync(new URL("../fixtures/pages/prisjakt-product.html", import.meta.url), "utf8");

describe("prisjaktProduct", () => {
  it("knows a product page on prisjakt.nu and nothing else", () => {
    expect(prisjaktProduct("https://www.prisjakt.nu/produkt.php?p=15633708&utm=x")).toEqual({
      id: "15633708",
      url: "https://www.prisjakt.nu/produkt.php?p=15633708",
    });
    expect(prisjaktProduct("http://prisjakt.nu/product.php?p=1")?.id).toBe("1");
    for (const no of [
      "https://www.prisjakt.nu/search?search=pla",
      "https://www.prisjakt.nu/c/3d-skrivare",
      "https://www.prisjakt.no/produkt.php?p=1",
      "https://evil.test/produkt.php?p=1",
      "https://www.prisjakt.nu/produkt.php?p=abc",
      "https://www.prisjakt.nu.evil.test/produkt.php?p=1",
      "javascript:alert(1)",
      "nope",
    ]) {
      expect(prisjaktProduct(no)).toBeNull();
    }
  });
});

describe("readProductPage", () => {
  it("reads the picture, the lowest price and the cheapest offers, in stock first, one per shop", () => {
    const facts = readProductPage(page);
    expect(facts).toMatchObject({
      name: "Bambu Lab P2S Combo",
      image: "https://cdn.pji.nu/product/standard/800/15633708.jpg",
      low: 7699,
      high: 11439,
      count: 6,
    });
    expect(facts?.offers).toEqual([
      { shop: "3D Prima", price: 7699, inStock: true },
      { shop: "Webhallen", price: 7980, inStock: true },
      { shop: "Kjell & Company", price: 8049, inStock: true },
    ]);
  });

  it("keeps the lowest price alone when the offers' data is gone", () => {
    const bare = page.replace(/<script>self[\s\S]*?<\/script>/, "");
    expect(readProductPage(bare)).toMatchObject({ low: 7699, offers: [] });
  });

  it("gives nothing for a page without a price, or another currency", () => {
    expect(readProductPage("<html><body>Not found</body></html>")).toBeNull();
    expect(readProductPage(page.replace(/"priceCurrency":\s*"SEK"/, '"priceCurrency":"NOK"'))).toBeNull();
    expect(readProductPage(page.replace(/"lowPrice":\s*7699/, '"lowPrice":"soon"'))).toBeNull();
  });
});

it("formats kronor", () => {
  expect(formatKr(189)).toBe("189 kr");
  expect(formatKr(7699)).toBe("7 699 kr");
});

describe("robotsAllows", () => {
  const txt = `User-agent: *\nDisallow: /search?*\nDisallow: /go-to-shop\nAllow: /go-to-shop/open\nDisallow: /private$\n\nUser-agent: BadBot\nDisallow: /\n`;
  it("follows the rules for everyone, longest match wins", () => {
    expect(robotsAllows(txt, "/produkt.php?p=1", "SpaghettiPriceCheck")).toBe(true);
    expect(robotsAllows(txt, "/search?search=x", "SpaghettiPriceCheck")).toBe(false);
    expect(robotsAllows(txt, "/go-to-shop/1", "SpaghettiPriceCheck")).toBe(false);
    expect(robotsAllows(txt, "/go-to-shop/open", "SpaghettiPriceCheck")).toBe(true);
    expect(robotsAllows(txt, "/private", "SpaghettiPriceCheck")).toBe(false);
    expect(robotsAllows(txt, "/private/ok", "SpaghettiPriceCheck")).toBe(true);
  });
  it("uses a group that names us over *, and treats an empty file as allowed", () => {
    expect(robotsAllows(txt, "/x", "BadBot")).toBe(false);
    expect(
      robotsAllows(
        "User-agent: *\nDisallow: /\n\nUser-agent: SpaghettiPriceCheck\nAllow: /\n",
        "/x",
        "SpaghettiPriceCheck/1.0",
      ),
    ).toBe(true);
    expect(robotsAllows("", "/x", "SpaghettiPriceCheck")).toBe(true);
  });
});
