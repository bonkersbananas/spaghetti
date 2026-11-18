import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  extractMakerWorldDesign,
  extractModelPage,
  extractPrintablesPrint,
  isSiteTitle,
  printablesApiId,
  printablesApiUrl,
  printablesId,
  printablesTitleFromLink,
  WEB_FETCH_MAX_URL,
} from "../../src/shared/model-page.ts";

const page = (name: string) => readFileSync(new URL(`../fixtures/pages/${name}`, import.meta.url), "utf8");

describe("reading a model page", () => {
  it("takes MakerWorld's design from its Next.js data", () => {
    const facts = extractModelPage("makerworld", page("makerworld.html"));
    expect(facts?.title).toBe("Fluffy Tail Cute Flexi Red Panda - Toy / Keychain");
    expect(facts?.designer).toBe("Fluffy Tails");
    expect(facts?.license).toBe("Standard Digital File License");
    // Real photos first, all from MakerWorld's own picture host.
    expect(facts?.imageUrls[0]).toBe(
      "https://makerworld.bblmw.com/makerworld/model/US31fd0db42998df/design/d7a53ca89661105c.jpg",
    );
    expect(facts?.imageUrls.every((url) => url.startsWith("https://makerworld.bblmw.com/"))).toBe(true);
    expect(facts?.description).toContain("Category: Other Toys & Games, Toys & Games");
    expect(facts?.description).not.toContain("<");
    expect(facts?.profiles[0]).toMatch(/material PLA.*450 g.*needs an AMS.*A1.*0\.4 mm nozzle/);
  });

  it("takes Thingiverse's title, designer, license and the picture inside the resize wrapper", () => {
    const facts = extractModelPage("thingiverse", page("thingiverse.html"));
    expect(facts?.title).toBe("#3DBenchy - The jolly 3D printing torture-test by CreativeTools.se");
    expect(facts?.designer).toBe("CreativeTools");
    expect(facts?.license).toBe("https://creativecommons.org/publicdomain/zero/1.0/");
    expect(facts?.imageUrls[0]).toBe(
      "https://cdn.thingiverse.com/assets/ee/dc/9a/fb/74/1_3D-printed_3DBenchy_by_Creative-Tools.com.JPG",
    );
    expect(facts?.description).toContain("3DBenchy");
  });

  it("finds nothing in a challenge page or in a page without a design", () => {
    expect(extractModelPage("printables", page("printables-challenge.html"))).toBeNull();
    expect(extractModelPage("makerworld", "<html><body>hello</body></html>")).toBeNull();
    expect(extractModelPage("makerworld", '<script id="__NEXT_DATA__">{broken</script>')).toBeNull();
  });

  it("finds no model in a site's soft 'not found' (real pages for numbers that don't exist, 200 OK)", () => {
    // Thingiverse answers thing:99999999 with its home page's title and picture.
    expect(extractModelPage("thingiverse", page("thingiverse-missing.html"))).toBeNull();
    // MakerWorld answers a model number that isn't there with a design of status -1 and the site's description.
    expect(extractModelPage("makerworld", page("makerworld-missing.html"))).toBeNull();
  });

  it("tells a site's own title from a model's", () => {
    for (const title of [
      "Thingiverse - The community for Open Hardware",
      "MakerWorld",
      "MakerWorld: Download Free 3D Print Models",
      "Just a moment...",
      "Attention Required! | Cloudflare",
      "Page not found",
      "404 - Not found",
      "Error 404",
    ]) {
      expect(isSiteTitle(title), title).toBe(true);
    }
    for (const title of ["Thingiverse logo keychain", "Cute Mini Octopus", "404 error sign for the office door"]) {
      expect(isSiteTitle(title), title).toBe(false);
    }
  });

  it("takes MakerWorld's design from its API, in English", () => {
    const json: unknown = JSON.parse(page("makerworld-design.json"));
    const facts = extractMakerWorldDesign(json, "2051796");
    expect(facts?.title).toBe("Sweeper Mop Storage Box Rag Storage Box");
    expect(facts?.designer).toBe("user_2210284563");
    expect(facts?.description).toContain("A storage box for universal sweeper mops");
    expect(facts?.description).toContain("Tags: Storage, Robot Vacuum, Home");
    expect(facts?.imageUrls).toContain(
      "https://makerworld.bblmw.com/makerworld/model/DSM00000002051796/design/2025-11-28_22b6e31c957f9.jpg",
    );
    // Another model's answer, or an error, is not this model.
    expect(extractMakerWorldDesign(json, "2051797")).toBeNull();
    expect(extractMakerWorldDesign({ code: 404, error: "The server cannot find the requested resource." })).toBeNull();
  });

  it("takes a Printables model from its GraphQL API (real answers, November 2026)", () => {
    const facts = extractPrintablesPrint(JSON.parse(page("printables-print.json")), "1577248");
    expect(facts).not.toBe("missing");
    if (!facts || facts === "missing") return;
    expect(facts.title).toBe("Carrying handle for IKEA Antilop high chair legs.");
    expect(facts.designer).toBe("DaBloch");
    expect(facts.license).toBe("CC BY-NC-SA");
    expect(facts.description).toContain("Can be printed upright without support.");
    expect(facts.description).toContain("Category: Household / Kitchen");
    expect(facts.description).toContain("Tags: leg, ikea, holder");
    expect(facts.description).not.toContain("<p>");
    expect(facts.imageUrls).toHaveLength(5);
    expect(facts.imageUrls[0]).toMatch(/^https:\/\/media\.printables\.com\/media\/prints\/[^/]+\/images\/.+\.jpg$/);
    // This one states no print settings, so there's no profile line.
    expect(facts.profiles).toEqual([]);

    const benchy = extractPrintablesPrint(JSON.parse(page("printables-benchy.json")), "3161");
    if (!benchy || benchy === "missing") throw new Error("no Benchy");
    expect(benchy.license).toBe("CC0");
    expect(benchy.designer).toBe("Prusa Research");
    expect(benchy.profiles).toEqual([
      "material PLA; 29 g of filament; about 2 h 28 min; layer heights 0.15, 0.28, 0.25 mm; 0.4 mm nozzle; printed on Prusa MK3/S/S+",
    ]);
  });

  it("tells a Printables model that isn't there from an answer it can't read", () => {
    // What the API answers for a number that doesn't exist (and for a removed or private model).
    expect(extractPrintablesPrint({ data: { print: null } }, "999999999")).toBe("missing");
    // Another model's answer, an error, or not the API at all.
    expect(extractPrintablesPrint(JSON.parse(page("printables-print.json")), "1577249")).toBeNull();
    expect(extractPrintablesPrint({ errors: [{ message: "Cannot query field" }], data: null }, "1")).toBeNull();
    expect(extractPrintablesPrint({ detail: "Request was throttled." }, "1")).toBeNull();
    expect(extractPrintablesPrint("Request was throttled.", "1")).toBeNull();
    // The short GET address asks for no id: the answer is taken for the model its address names.
    const { id: _, ...withoutId } = JSON.parse(page("printables-print.json")).data.print;
    const short = extractPrintablesPrint({ data: { print: withoutId } }, "1577248");
    expect(short !== "missing" && short?.title).toBe("Carrying handle for IKEA Antilop high chair legs.");
  });

  it("finds a Printables model's number in its page's address, and makes the API's GET address", () => {
    expect(printablesId("https://www.printables.com/model/1577248-carrying-handle-for-ikea-antilop")).toBe("1577248");
    expect(printablesId("https://www.printables.com/de/model/1577248-griff/files")).toBe("1577248");
    expect(printablesId("https://printables.com/model/3161")).toBe("3161");
    expect(printablesId("https://www.printables.com/@DaBloch_258351/models")).toBeNull();
    expect(printablesId("https://makerworld.com/model/1577248")).toBeNull();
    const url = new URL(printablesApiUrl("1577248"));
    expect(url.origin + url.pathname).toBe("https://api.printables.com/graphql/");
    expect(url.searchParams.get("query")).toMatch(/^\{print\(id:1577248\)\{name,.*images\{filePath\}.*\}\}$/);
    expect(printablesApiId(url.href)).toBe("1577248");
    expect(printablesApiId(url.searchParams.get("query") ?? "")).toBeNull();
    expect(printablesApiId('https://api.printables.com/graphql/?query={print(id:"3161"){name}}')).toBe("3161");
    expect(printablesApiId("https://www.printables.com/model/3161")).toBeNull();
  });

  it("keeps the API's GET address within web fetch's 250 characters, even escaped further", () => {
    // Production, Nov 16: the first address (a full query and variables, ~430 characters) came back url_too_long.
    for (const id of ["3161", "1577248", "999999999999"]) {
      const url = printablesApiUrl(id);
      expect(url.length, id).toBeLessThanOrEqual(WEB_FETCH_MAX_URL - 20);
      // A fetcher that escapes every comma and colon too still stays within it.
      expect(url.replace(/[,:()]/g, "%2C").length, id).toBeLessThanOrEqual(WEB_FETCH_MAX_URL);
    }
  });

  it("survives character references that aren't characters", () => {
    const html =
      '<meta property="og:title" content="Hook &#x110000; &#99999999; &#xZZ; &amp; &#65;"><meta property="og:description" content="x">';
    expect(extractModelPage("printables", html)?.title).toBe("Hook &#x110000; &#99999999; &#xZZ; & A");
  });
});

describe("printablesTitleFromLink", () => {
  const base = "https://www.printables.com/model/1577248-";
  it("spaces the slug's words, capitalises the first and keeps brand words as people write them", () => {
    expect(printablesTitleFromLink(`${base}carrying-handle-for-ikea-antilop-high-chair`)).toBe(
      "Carrying handle for IKEA antilop high chair",
    );
    expect(printablesTitleFromLink(`${base}usb-c-led-holder`)).toBe("USB c LED holder");
  });
  it("takes a locale prefix, a query, a hash and a trailing path", () => {
    expect(printablesTitleFromLink("https://www.printables.com/de/model/12-spool-holder?lang=en#files")).toBe(
      "Spool holder",
    );
    expect(printablesTitleFromLink("https://printables.com/model/12-spool-holder/files#preview.eSga8")).toBe(
      "Spool holder",
    );
  });
  it("doesn't take a word for an object property", () => {
    expect(printablesTitleFromLink(`${base}constructor-kit`)).toBe("Constructor kit");
    expect(printablesTitleFromLink(`${base}the-toString-box`)).toBe("The toString box");
  });
  it("has no name without a slug, for another site or for a bare number", () => {
    expect(printablesTitleFromLink("https://www.printables.com/model/1577248")).toBeNull();
    expect(printablesTitleFromLink("https://www.printables.com/model/1577248/files")).toBeNull();
    expect(printablesTitleFromLink("https://makerworld.com/en/models/1-cable-comb")).toBeNull();
    expect(printablesTitleFromLink("not a link")).toBeNull();
  });
  it("copes with odd characters and long slugs", () => {
    expect(printablesTitleFromLink("https://www.printables.com/model/5-caf%C3%A9-h%C3%A5ll-_--ok")).toBe(
      "Café håll ok",
    );
    expect(printablesTitleFromLink("https://www.printables.com/model/5-50%-off")).toBe("50 off");
    expect(printablesTitleFromLink("https://www.printables.com/model/5---")).toBeNull();
    const long = printablesTitleFromLink(`${base}${"word-".repeat(30)}end`);
    expect(long?.length).toBeLessThanOrEqual(60);
    expect(long?.endsWith(" ")).toBe(false);
  });
});
