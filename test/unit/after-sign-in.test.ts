import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { afterSignIn } from "../../src/client/lib/after-sign-in.ts";

// Where signing in goes on to: the page that asked for it, only when it is one of the app's own pages.

const routes = /^\/(today|journal|ideas(\/[^/]+)?|builds\/[^/]+|search|authorize|sign-in|link|join)?$/;
const knows = (pathname: string) => routes.test(pathname);

beforeAll(() => vi.stubGlobal("window", { location: { origin: "https://spaghetti.day" } }));
afterAll(() => vi.unstubAllGlobals());

describe("afterSignIn", () => {
  it("goes on to the app's own page, with its search and hash", () => {
    expect(afterSignIn("/ideas/abc", knows)).toBe("/ideas/abc");
    expect(afterSignIn("/journal?outcome=failures", knows)).toBe("/journal?outcome=failures");
    expect(afterSignIn("/search?q=silk%20pla#top", knows)).toBe("/search?q=silk%20pla#top");
    expect(afterSignIn("/authorize?client_id=x&state=y", knows)).toBe("/authorize?client_id=x&state=y");
  });

  it("goes home without a target", () => {
    expect(afterSignIn(undefined, knows)).toBe("/today");
    expect(afterSignIn("", knows)).toBe("/today");
  });

  it.each([
    "https://evil.example/ideas/abc",
    "//evil.example/ideas/abc",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "javascript:alert(1)",
    "ideas/abc",
    " /ideas/abc",
  ])("never leaves the site: %j", (target) => {
    expect(afterSignIn(target, knows)).toBe("/today");
  });

  it("goes home rather than to a page the app doesn't have, or back to signing in", () => {
    expect(afterSignIn("/api/items", knows)).toBe("/today");
    expect(afterSignIn("/nothing/here", knows)).toBe("/today");
    expect(afterSignIn("/sign-in?redirect=/ideas/abc", knows)).toBe("/today");
    expect(afterSignIn("/link", knows)).toBe("/today");
  });
});
