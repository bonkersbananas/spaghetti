import { beforeEach, describe, expect, it } from "vitest";
import type { AttemptResponse, InsightsResponse, ItemResponse } from "../../src/shared/api.ts";
import type { AttemptSettings, Outcome } from "../../src/shared/attempts.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

async function build(title: string) {
  const response = await request("/api/items", {
    method: "POST",
    cookie,
    json: { id: crypto.randomUUID(), title, stage: "building" },
  });
  return (await response.json<ItemResponse>()).item.id;
}

async function attempt(itemId: string, outcome: Outcome, settings: AttemptSettings, failureTags: string[] = []) {
  const response = await request(`/api/items/${itemId}/attempts`, {
    method: "POST",
    cookie,
    json: { id: crypto.randomUUID(), outcome, settings, failureTags },
  });
  expect(response.status).toBe(201);
  return (await response.json<AttemptResponse>()).attempt;
}

describe("GET /api/insights", () => {
  it("needs a signed-in person", async () => {
    expect((await request("/api/insights")).status).toBe(401);
  });

  it("is an empty year with nothing printed", async () => {
    const response = await request("/api/insights?year=2026", { cookie });
    const { insights } = await response.json<InsightsResponse>();
    expect(insights).toMatchObject({ year: 2026, prints: 0, failures: [], longestBuilds: [], made: [], madeTotal: 0 });
    expect(insights.months).toHaveLength(12);
  });

  it("counts this year's attempts and says what fixed a failure", async () => {
    const item = await build("Tugboat");
    await attempt(item, "failed", { bedTemperature: 55, filaments: [{ type: "PLA" }], bedType: "Textured PEI Plate" }, [
      "warping",
    ]);
    await attempt(item, "success", { bedTemperature: 65, filaments: [{ type: "PLA" }], bedType: "Textured PEI Plate" });
    const year = new Date().getUTCFullYear();
    const { insights } = await (await request(`/api/insights?year=${year}`, { cookie })).json<InsightsResponse>();
    expect(insights.prints).toBe(2);
    expect(insights.outcomes).toEqual({ success: 1, partial: 0, failed: 1 });
    expect(insights.byMaterial).toEqual([{ label: "PLA", total: 2, worked: 1, percent: 50 }]);
    expect(insights.byPlate[0]?.label).toBe("Textured PEI");
    expect(insights.failures).toEqual([
      { slug: "warping", label: "Warping", count: 1, fixes: [{ phrase: "a warmer bed", count: 1 }] },
    ]);
  });

  it("refuses a year that makes no sense", async () => {
    expect((await request("/api/insights?year=abc", { cookie })).status).toBe(400);
  });
});
