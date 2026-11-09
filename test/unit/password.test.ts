import { describe, expect, it } from "vitest";
import { hashPassword, PBKDF2_ITERATIONS, verifyPassword } from "../../src/shared/password.ts";

// The same module hashes in Node (pnpm user:add) and verifies in the Worker.
describe("password hashing in Node", () => {
  it("round-trips", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).toMatch(
      new RegExp(`^pbkdf2-sha256\\$${PBKDF2_ITERATIONS}\\$[A-Za-z0-9+/=]{24}\\$[A-Za-z0-9+/=]{44}$`),
    );
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("correct horsE", hash)).toBe(false);
  });

  it("salts each hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects malformed hashes and iteration counts the Worker can't run", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$10$abc$def")).toBe(false);
    const hash = await hashPassword("x");
    expect(await verifyPassword("x", hash.replace(`$${PBKDF2_ITERATIONS}$`, "$100001$"))).toBe(false);
  });
});
