import { describe, expect, it } from "vitest";
import { home } from "../../src/worker/home.ts";
import { PAGE_HEADERS } from "../../src/worker/page-headers.ts";
import { spa } from "../../src/worker/spa.ts";

// The test Worker has no static assets: a stand-in answers "/" with the app's index.html.
const env = {
  ASSETS: {
    fetch: async () => new Response("<!doctype html><title>app</title>", { headers: { "Content-Type": "text/html" } }),
  },
} as unknown as Env;
const get = (path: string) =>
  spa(new Request(`http://spaghetti.test${path}`, { headers: { "Sec-Fetch-Mode": "navigate" } }), env);

describe("app routes and missing files", () => {
  it("never lets the consent screen be framed", async () => {
    const response = await get("/authorize");
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("gives every app route and the landing page the same page headers", async () => {
    const signedOut = await home(new Request("http://spaghetti.test/"), env);
    const signedIn = await home(
      new Request("http://spaghetti.test/", { headers: { Cookie: "spaghetti_session=x" } }),
      env,
    );
    for (const response of [await get("/today"), await get("/builds/abc"), signedOut, signedIn]) {
      expect(response.status).toBe(200);
      for (const [name, value] of Object.entries(PAGE_HEADERS)) expect(response.headers.get(name)).toBe(value);
    }
  });

  it("answers a missing build file with a plain 404, not HTML", async () => {
    const response = await get("/assets/_app-gone.js");
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
  });
});
