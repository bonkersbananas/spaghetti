import { describe, expect, it } from "vitest";
import {
  isPriceLink,
  parseEntry,
  priceSearchUrl,
  shoppingName,
  splitShopping,
  tidyPageTitle,
} from "../../src/shared/shopping.ts";

const glue =
  "https://eu.store.bambulab.com/products/liquid-glue-for-build-plate?srsltid=AYCX9vJffNKED2ejBV4IpzobOSK_sp7XT27L6cfZPeRwwux58bODnyav";

describe("parseEntry", () => {
  it("keeps words as the name", () => {
    expect(parseEntry("  PLA Basic, black ×2 ")).toEqual({ name: "PLA Basic, black ×2", link: null, priceLink: null });
  });

  it("takes a pasted shop link as the link, with no name", () => {
    expect(parseEntry(glue)).toEqual({ name: "", link: glue, priceLink: null });
  });

  it("splits words and links, and knows Prisjakt", () => {
    const prisjakt = "https://www.prisjakt.nu/produkt.php?p=5501234";
    expect(parseEntry(`Liquid glue - ${glue} ${prisjakt}`)).toEqual({
      name: "Liquid glue",
      link: glue,
      priceLink: prisjakt,
    });
    expect(parseEntry(prisjakt)).toEqual({ name: "", link: null, priceLink: prisjakt });
  });
});

describe("links", () => {
  it("tells Prisjakt's sites from shops", () => {
    expect(isPriceLink("https://www.prisjakt.nu/produkt.php?p=1")).toBe(true);
    expect(isPriceLink("https://prisjakt.no/product.php?p=1")).toBe(true);
    expect(isPriceLink("https://pricespy.co.uk/x")).toBe(true);
    expect(isPriceLink(glue)).toBe(false);
    expect(isPriceLink("https://notprisjakt.nu.example.com/")).toBe(false);
    expect(isPriceLink("not a link")).toBe(false);
  });

  it("searches Prisjakt for a name", () => {
    expect(priceSearchUrl(" Liquid glue & co ")).toBe("https://www.prisjakt.nu/search?search=Liquid%20glue%20%26%20co");
  });
});

describe("tidyPageTitle", () => {
  it("drops the shop's name after the title", () => {
    expect(tidyPageTitle("Liquid Glue for Build Plate | Bambu Lab EU", "eu.store.bambulab.com")).toBe(
      "Liquid Glue for Build Plate",
    );
    expect(tidyPageTitle("PLA Basic – Official Store", "example.com")).toBe("PLA Basic");
  });

  it("keeps a dash that is part of the name", () => {
    expect(tidyPageTitle("Hardened Steel Nozzle - 0.4 mm", "eu.store.bambulab.com")).toBe(
      "Hardened Steel Nozzle - 0.4 mm",
    );
    expect(tidyPageTitle("Liquid glue", "eu.store.bambulab.com")).toBe("Liquid glue");
  });
});

describe("the list", () => {
  it("shows what's to buy in order, then what was bought, latest first", () => {
    const items = [
      { id: "a", position: 2, boughtAt: null },
      { id: "b", position: 1, boughtAt: 100 },
      { id: "c", position: -1, boughtAt: null },
      { id: "d", position: 0, boughtAt: 300 },
    ];
    const { toBuy, bought } = splitShopping(items);
    expect(toBuy.map((item) => item.id)).toEqual(["c", "a"]);
    expect(bought.map((item) => item.id)).toEqual(["d", "b"]);
  });

  it("names a thing by its name, its page or its address", () => {
    expect(shoppingName({ name: " Glue ", link: glue }, "Page")).toBe("Glue");
    expect(shoppingName({ name: "", link: glue }, "Liquid Glue")).toBe("Liquid Glue");
    expect(shoppingName({ name: "", link: "https://www.example.com/glue/" })).toBe("example.com/glue");
  });
});
