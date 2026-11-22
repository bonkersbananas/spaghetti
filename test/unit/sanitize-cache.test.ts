import { expect, test } from "vitest";
import { sanitizeCached } from "../../src/shared/sanitize-cache.ts";

test("repairs an outcome nobody has a word for and leaves the rest alone", () => {
  const item = {
    title: "Cable chain",
    attempts: [{ outcome: "mixed", note: "typed" }, { outcome: "partial" }, { outcome: null }],
  };
  const clean = sanitizeCached(item);
  expect(clean.attempts.map((a) => a.outcome)).toEqual([null, "partial", null]);
  expect(clean.attempts[0]?.note).toBe("typed");
  expect(item.attempts[0]?.outcome).toBe("mixed");
});

test("returns the same value when nothing needs repair", () => {
  const item = { attempts: [{ outcome: "success" }] };
  expect(sanitizeCached(item)).toBe(item);
});
