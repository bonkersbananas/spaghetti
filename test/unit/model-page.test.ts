import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractModelPage } from "../../src/shared/model-page.ts";

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

  it("survives character references that aren't characters", () => {
    const html =
      '<meta property="og:title" content="Hook &#x110000; &#99999999; &#xZZ; &amp; &#65;"><meta property="og:description" content="x">';
    expect(extractModelPage("printables", html)?.title).toBe("Hook &#x110000; &#99999999; &#xZZ; & A");
  });
});
