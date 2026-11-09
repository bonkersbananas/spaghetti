import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

// Phase 2 stores photos in R2; the binding is declared now.
it("has a working PHOTOS bucket", async () => {
  await env.PHOTOS.put("hello.txt", "al dente");
  const object = await env.PHOTOS.get("hello.txt");
  expect(await object?.text()).toBe("al dente");
});

it("has the migrated D1 schema", async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'sessions') ORDER BY name",
  ).all<{ name: string }>();
  expect(results.map((r) => r.name)).toEqual(["sessions", "users"]);
});
