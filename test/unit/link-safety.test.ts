import { describe, expect, it } from "vitest";
import { checkLinkUrl, isPublicAddress, readPreview } from "../../src/shared/link-safety.ts";

describe("checkLinkUrl", () => {
  it("accepts a public https link, without its fragment", () => {
    expect(checkLinkUrl("https://www.printables.com/model/1-x#files")?.href).toBe(
      "https://www.printables.com/model/1-x",
    );
    expect(checkLinkUrl("https://example.com:443/a")?.hostname).toBe("example.com");
    expect(checkLinkUrl("https://EXAMPLE.com./a")?.hostname).toBe("example.com.");
  });

  it("refuses everything that isn't one", () => {
    for (const bad of [
      "http://example.com",
      "https://10.0.0.1",
      "https://0177.0.0.1",
      "https://[2001:db8::1]/",
      "https://localhost./",
      "https://thing.localhost/",
      "https://box.home.arpa/",
      "https://nas/",
      "https://u@example.com/",
      "https://example.com:8080/",
      "javascript:alert(1)",
    ]) {
      expect([bad, checkLinkUrl(bad)]).toEqual([bad, null]);
    }
  });
});

describe("isPublicAddress", () => {
  it("is true for the open internet and false for what stays home", () => {
    for (const ip of [
      "93.184.216.34",
      "8.8.8.8",
      "172.32.0.1",
      "1.1.1.1",
      "2606:4700:4700::1111",
      "2a00:1450:4001::200e",
    ]) {
      expect([ip, isPublicAddress(ip)]).toEqual([ip, true]);
    }
    for (const ip of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.10",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "::ffff:192.168.1.1",
      "::ffff:c0a8:0101",
      "64:ff9b::7f00:1",
      "2001:db8::1",
      "garbage",
      "1.2.3",
    ]) {
      expect([ip, isPublicAddress(ip)]).toEqual([ip, false]);
    }
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
  });
});

describe("readPreview", () => {
  it("prefers og:title, in either attribute order and quote style", () => {
    expect(readPreview(`<meta property='og:title' content='One'><title>Two</title>`).title).toBe("One");
    expect(readPreview(`<meta content="One" name="og:title"><title>Two</title>`).title).toBe("One");
    expect(readPreview(`<title>Two</title>`).title).toBe("Two");
    expect(readPreview(`<meta property="og:site_name" content="Thingiverse">`).site).toBe("Thingiverse");
  });

  it("decodes entities, collapses whitespace and strips control characters", () => {
    expect(readPreview(`<title>Hook\u0000\n  &quot;Pro&quot; &#169; &#x1F35D; &unknown;</title>`).title).toBe(
      'Hook "Pro" © 🍝 &unknown;',
    );
  });

  it("finds nothing in a page without either", () => {
    expect(readPreview("<html><head></head><body><h1>Hi</h1></body></html>")).toEqual({ title: null, site: null });
    expect(readPreview("<title>   </title>").title).toBeNull();
  });
});
