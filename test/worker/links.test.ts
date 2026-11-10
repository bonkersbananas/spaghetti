import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type { LinkPreviewResponse } from "../../src/shared/api.ts";
import { FRESH_FOR } from "../../src/worker/routes/links.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await env.DB.prepare("DELETE FROM link_previews").run();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

afterEach(() => vi.restoreAllMocks());

/** Made inside the Worker's own request (a Response built in the test can't be read there). */
type Page = (url: URL) => Response | Promise<Response>;

/**
 * The web as the Worker sees it: pages by address, and a DNS-over-HTTPS answer for each name
 * (public unless `dns` says otherwise). Everything the Worker fetches is recorded.
 */
function stubWeb(pages: Record<string, Page>, dns: Record<string, string[]> = {}) {
  const asked: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    asked.push(url.href);
    if (url.hostname === "cloudflare-dns.com") {
      const name = url.searchParams.get("name") ?? "";
      const type = url.searchParams.get("type");
      const addresses = dns[name] ?? ["93.184.216.34"];
      const answers = addresses
        .filter((address) => (type === "AAAA") === address.includes(":"))
        .map((data) => ({ type: type === "AAAA" ? 28 : 1, data }));
      return Response.json({ Status: 0, Answer: answers });
    }
    const page = pages[url.href];
    if (!page) return new Response("not found", { status: 404 });
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return page(url);
  });
  /** Pages fetched, not DNS lookups. */
  return { asked, pages: () => asked.filter((href) => !href.includes("cloudflare-dns.com")) };
}

const html =
  (head: string, init: ResponseInit = {}): Page =>
  () =>
    new Response(`<!doctype html><html><head>${head}</head><body>x</body></html>`, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      ...init,
    });

const preview = (url: string, as = cookie) =>
  request(`/api/links/preview?url=${encodeURIComponent(url)}`, { cookie: as });
const body = (response: Response) => response.json<LinkPreviewResponse>();
const PAGE = "https://www.printables.com/model/42-drawer-bins";

describe("GET /api/links/preview", () => {
  it("returns a page's title and site, from og: tags first, and remembers it per address", async () => {
    const web = stubWeb({
      [PAGE]: html(
        `<title>Fallback title</title>
         <meta property="og:site_name" content="Printables">
         <meta content="Drawer bins &amp; a 42&nbsp;mm grid" property="og:title">`,
      ),
    });
    const first = await preview(PAGE);
    expect(first.status).toBe(200);
    expect(await body(first)).toEqual({ url: PAGE, title: "Drawer bins & a 42 mm grid", site: "Printables" });
    expect(web.pages()).toEqual([PAGE]);

    // The second look costs nothing: no page fetch and no DNS lookup, and the D1 row is there.
    const second = await preview(PAGE);
    expect(await body(second)).toEqual({ url: PAGE, title: "Drawer bins & a 42 mm grid", site: "Printables" });
    expect(web.asked).toHaveLength(3);
    const stored = await env.DB.prepare("SELECT url, title, site, failed FROM link_previews").all();
    expect(stored.results).toEqual([{ url: PAGE, title: "Drawer bins & a 42 mm grid", site: "Printables", failed: 0 }]);
  });

  it("falls back to <title>, trims long ones to 200 characters and ignores everything after the head", async () => {
    stubWeb({
      [PAGE]: html(`<title>  A\n   very ${"long ".repeat(80)} title  </title>`),
      "https://example.com/late": () =>
        new Response(
          `<html><head><title>Head title</title></head><body><meta property="og:title" content="Body title"></body></html>`,
          { headers: { "Content-Type": "text/html" } },
        ),
    });
    const long = await body(await preview(PAGE));
    expect(long.title).toHaveLength(200);
    expect(long.title?.startsWith("A very long long")).toBe(true);
    expect(long.site).toBeNull();
    expect((await body(await preview("https://example.com/late"))).title).toBe("Head title");
  });

  it("refuses what it must not fetch, without fetching anything", async () => {
    const web = stubWeb({});
    for (const refused of [
      "http://www.printables.com/model/1",
      "https://1.2.3.4/page",
      "https://127.0.0.1/",
      "https://2130706433/",
      "https://0x7f.1/",
      "https://192.168.1.20/admin",
      "https://[::1]/",
      "https://[fe80::1]/",
      "https://localhost/",
      "https://printer.local/",
      "https://nas.internal/files",
      "https://router/",
      "https://user:secret@www.printables.com/",
      "https://www.printables.com:8443/",
      "ftp://example.com/file",
      "not a link",
      "",
    ]) {
      const response = await preview(refused);
      expect([refused, response.status]).toEqual([refused, 400]);
    }
    expect((await request("/api/links/preview", { cookie })).status).toBe(400);
    expect(web.asked).toEqual([]);
  });

  it("won't follow a name that points into the home network, and remembers that for a day", async () => {
    const web = stubWeb({ [PAGE]: html("<title>Never read</title>") }, { "www.printables.com": ["192.168.1.30"] });
    expect(await body(await preview(PAGE))).toEqual({ url: PAGE, title: null, site: null });
    expect(web.pages()).toEqual([]);
    const row = await env.DB.prepare("SELECT failed FROM link_previews").first<{ failed: number }>();
    expect(row?.failed).toBe(1);
    // Mixed answers (one private address among public ones) are refused too.
    stubWeb({ "https://example.org/a": html("<title>x</title>") }, { "example.org": ["93.184.216.34", "10.0.0.2"] });
    expect((await body(await preview("https://example.org/a"))).title).toBeNull();
  });

  it("follows up to three redirects, checking each hop, and never to a private address", async () => {
    const hop =
      (to: string): Page =>
      () =>
        new Response(null, { status: 302, headers: { Location: to } });
    const web = stubWeb({
      "https://short.example/a": hop("https://short.example/b"),
      "https://short.example/b": hop("/c"),
      "https://short.example/c": html("<title>Landed</title>"),
      "https://evil.example/go": hop("https://192.168.1.5/router"),
      "https://evil.example/local": hop("https://printer.local/"),
      "https://evil.example/http": hop("http://short.example/c"),
      "https://loop.example/1": hop("/2"),
      "https://loop.example/2": hop("/3"),
      "https://loop.example/3": hop("/4"),
      "https://loop.example/4": hop("/5"),
      "https://loop.example/5": html("<title>Too far</title>"),
    });
    expect((await body(await preview("https://short.example/a"))).title).toBe("Landed");
    for (const url of ["https://evil.example/go", "https://evil.example/local", "https://evil.example/http"]) {
      expect((await body(await preview(url))).title).toBeNull();
    }
    expect(web.pages().some((href) => href.includes("192.168") || href.includes("printer.local"))).toBe(false);
    // Three redirects are allowed, the fourth is not.
    expect((await body(await preview("https://loop.example/1"))).title).toBeNull();
  });

  it("reads only the start of a large page, and gives up on one whose title lies past the limit", async () => {
    const filler = "<!-- padding -->".repeat(30_000);
    stubWeb({
      "https://big.example/early": () =>
        new Response(`<html><head><title>Early</title></head>${filler}`, {
          headers: { "Content-Type": "text/html" },
        }),
      "https://big.example/late": () =>
        new Response(`<html><head>${filler}<title>Late</title></head>`, {
          headers: { "Content-Type": "text/html" },
        }),
    });
    expect((await body(await preview("https://big.example/early"))).title).toBe("Early");
    expect((await body(await preview("https://big.example/late"))).title).toBeNull();
  });

  it("only reads HTML", async () => {
    stubWeb({
      "https://files.example/data.json": () =>
        new Response('{"title":"x"}', {
          headers: { "Content-Type": "application/json" },
        }),
      "https://files.example/pic.png": () =>
        new Response("<title>x</title>", { headers: { "Content-Type": "image/png" } }),
      "https://files.example/gone": () =>
        new Response("<title>x</title>", {
          status: 404,
          headers: { "Content-Type": "text/html" },
        }),
    });
    for (const url of ["data.json", "pic.png", "gone"]) {
      expect((await body(await preview(`https://files.example/${url}`))).title).toBeNull();
    }
  });

  it("gives up after three seconds", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === "cloudflare-dns.com") {
        return Response.json({ Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
      });
    });
    const started = Date.now();
    expect(await body(await preview("https://slow.example/page"))).toEqual({
      url: "https://slow.example/page",
      title: null,
      site: null,
    });
    expect(Date.now() - started).toBeLessThan(6000);
  }, 10_000);

  it("looks again after 30 days, or after a day for a failure", async () => {
    const web = stubWeb({ [PAGE]: html("<title>Fresh</title>") });
    const row = (title: string | null, failed: boolean, age: number) =>
      env.DB.prepare(
        "INSERT OR REPLACE INTO link_previews (url, title, site, failed, fetched_at) VALUES (?, ?, NULL, ?, ?)",
      )
        .bind(PAGE, title, failed ? 1 : 0, Date.now() - age)
        .run();

    await row("Old", false, FRESH_FOR.found - 60_000);
    expect((await body(await preview(PAGE))).title).toBe("Old");
    await row("Old", false, FRESH_FOR.found + 60_000);
    expect((await body(await preview(PAGE))).title).toBe("Fresh");
    expect(web.pages()).toEqual([PAGE]);

    await row(null, true, FRESH_FOR.failed - 60_000);
    expect((await body(await preview(PAGE))).title).toBeNull();
    await row(null, true, FRESH_FOR.failed + 60_000);
    expect((await body(await preview(PAGE))).title).toBe("Fresh");
  });

  it("is for signed-in people only: never a token, never nobody", async () => {
    stubWeb({ [PAGE]: html("<title>Hi</title>") });
    expect((await request(`/api/links/preview?url=${encodeURIComponent(PAGE)}`)).status).toBe(401);
    const made = await request("/api/agents", {
      method: "POST",
      json: { name: "Claude", scopes: ["read", "capture", "attempts", "printer"] },
      cookie,
    });
    const { token } = await made.json<NewTokenResponse>();
    const asAgent = await request(`/api/links/preview?url=${encodeURIComponent(PAGE)}`, {
      headers: { Authorization: `Bearer ${token}`, Origin: "http://other.test" },
    });
    expect(asAgent.status).toBe(403);
    expect((await asAgent.json<{ error: { code: string } }>()).error.code).toBe("person_only");
  });
});
