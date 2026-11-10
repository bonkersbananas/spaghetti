import { describe, expect, it } from "vitest";
import { captureNote, captureTitle } from "../../src/shared/capture.ts";
import { bookmarklet, recipesAsText, shortcutRecipes } from "../../src/shared/shortcut.ts";

describe("what a share becomes", () => {
  it("puts the link after the text, once", () => {
    expect(captureNote("Nice", "https://a.example")).toBe("Nice\nhttps://a.example");
    expect(captureNote("Look https://a.example", "https://a.example")).toBe("Look https://a.example");
    expect(captureNote(null, "https://a.example")).toBe("https://a.example");
    expect(captureNote("  ", undefined)).toBe("");
  });

  it("drops a title that repeats the text or link", () => {
    expect(captureTitle("Benchy", "x", "y")).toBe("Benchy");
    expect(captureTitle("https://a.example", "", "https://a.example")).toBeNull();
    expect(captureTitle("  ", "x", "y")).toBeNull();
  });
});

describe("the iPhone Shortcut and the bookmarklet", () => {
  it("fills in the address and the token, in both shortcuts", () => {
    const text = recipesAsText(shortcutRecipes("https://spaghetti.day", "spg_abc"));
    expect(text).toContain("Share to Spaghetti");
    expect(text).toContain("Share photo to Spaghetti");
    expect(text.match(/https:\/\/spaghetti\.day\/api\/capture/g)).toHaveLength(2);
    expect(text.match(/Bearer spg_abc/g)).toHaveLength(2);
  });

  it("is one javascript: line that opens the share route and holds no token", () => {
    const code = bookmarklet("https://spaghetti.day");
    expect(code.startsWith("javascript:")).toBe(true);
    expect(code).toContain("https://spaghetti.day");
    expect(code).toContain("/share");
    expect(code).not.toContain("spg_");
    expect(code).not.toMatch(/\n/);
    expect(() => new Function(code.slice("javascript:".length))).not.toThrow();
  });
});
