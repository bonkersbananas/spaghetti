import { describe, expect, it } from "vitest";
import { measure, pairs, readTokens } from "../../scripts/lib/contrast.ts";

// Every text and surface combination the app uses must pass WCAG AA in both themes.
// docs/design.md has the numbers (node scripts/lib/contrast.ts prints them).
describe("color contrast", () => {
  const tokens = readTokens();
  for (const theme of ["light", "dark"] as const) {
    it(`meets AA in the ${theme} theme`, () => {
      const failures = pairs
        .map((pair) => ({ pair, ratio: measure(theme, pair, tokens[theme]) }))
        .filter(({ pair, ratio }) => ratio < pair.min)
        .map(({ pair, ratio }) => `${pair.label}: ${ratio.toFixed(2)} (needs ${pair.min})`);
      expect(failures).toEqual([]);
    });
  }
});
