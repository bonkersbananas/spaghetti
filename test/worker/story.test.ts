import { beforeEach, describe, expect, it } from "vitest";
import type { AttemptResponse } from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  await addUser("sam", "battery staple", "Sam Lund", "basil");
  cookie = await signIn("alex", "correct horse");
});

const uuid = () => crypto.randomUUID();

async function build() {
  const id = uuid();
  const created = await request("/api/items", {
    method: "POST",
    cookie,
    json: { id, title: "Bath tugboat", note: "Print the hull in two halves", stage: "building" },
  });
  expect(created.status).toBe(201);
  const first = uuid();
  await request(`/api/items/${id}/attempts`, {
    method: "POST",
    cookie,
    json: {
      id: first,
      outcome: "failed",
      note: "Let go of the bed at 40%",
      failureTags: ["bed-adhesion"],
      settings: {
        filaments: [{ type: "PLA", brand: "Bambu", colorName: "Sunflower yellow", amsSlot: "A2" }],
        bedTemperature: 55,
        layerHeight: 0.2,
        failedAtPercent: 40,
      },
    },
  });
  const second = await request(`/api/items/${id}/attempts`, {
    method: "POST",
    cookie,
    json: {
      id: uuid(),
      outcome: "success",
      note: "Brim and a hotter bed",
      successNotes: ["great-first-layer"],
      settings: { bedTemperature: 65, brim: true, layerHeight: 0.2, actualMinutes: 145, weightGrams: 38 },
    },
  });
  expect((await second.json<AttemptResponse>()).attempt.changes.length).toBeGreaterThan(0);
  return id;
}

describe("GET /api/builds/:id/story.md", () => {
  it("is a whole build as one markdown document", async () => {
    const id = await build();
    const response = await request(`/api/builds/${id}/story.md`, { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    const story = await response.text();
    expect(story).toContain("# Bath tugboat");
    expect(story).toContain("A build (building)");
    expect(story).toContain("by Alex Rivera");
    expect(story).toContain("## Notes\n\nPrint the hull in two halves");
    expect(story).toContain("## Attempts (2)");
    expect(story).toContain("### Attempt 1: Spaghetti");
    expect(story).toContain("Let go of the bed at 40%");
    expect(story).toContain("filament Bambu PLA (Sunflower yellow), slot A2");
    expect(story).toContain("Went wrong: Bed adhesion.");
    expect(story).toContain("failed at 40%");
    expect(story).toContain("### Attempt 2: Worked");
    expect(story).toMatch(/Changed since attempt 1: .*bed 55 → 65 °C/);
    expect(story).toContain("Went well: Great first layer.");
    expect(story).toContain("took 2 h 25 min, 38 g of filament");
    expect(story).toMatch(/## What worked\n\nThe latest attempt that worked is attempt 2: .*bed 65 °C/);
    expect(story).toContain(`_id: ${id}_`);
  });

  it("says who and how: the owner via the agent", async () => {
    const id = uuid();
    const made = await (
      await request("/api/agents", {
        method: "POST",
        cookie,
        json: { name: "Claude for Alex", scopes: ["read", "capture"] },
      })
    ).json<{ token: string }>();
    await request("/api/items", {
      method: "POST",
      headers: { Authorization: `Bearer ${made.token}` },
      json: { id, note: "A hook" },
    });
    const story = await (
      await request(`/api/builds/${id}/story.md`, { headers: { Authorization: `Bearer ${made.token}` } })
    ).text();
    expect(story).toContain("# Untitled");
    expect(story).toContain("An idea");
    expect(story).toContain("by Alex Rivera via Claude for Alex");
    expect(story).toContain("_None yet._");
    expect(story).toContain("_Nothing has worked yet._");
  });

  it("needs a session or a token with read, and 404s for what isn't there", async () => {
    const id = await build();
    expect((await request(`/api/builds/${id}/story.md`)).status).toBe(401);
    const noRead = await (
      await request("/api/agents", { method: "POST", cookie, json: { name: "Capture only", scopes: ["capture"] } })
    ).json<{ token: string }>();
    const refused = await request(`/api/builds/${id}/story.md`, {
      headers: { Authorization: `Bearer ${noRead.token}` },
    });
    expect(refused.status).toBe(403);
    expect((await request(`/api/builds/${uuid()}/story.md`, { cookie })).status).toBe(404);
    // Deleted: gone.
    await request(`/api/items/${id}`, { method: "DELETE", cookie });
    expect((await request(`/api/builds/${id}/story.md`, { cookie })).status).toBe(404);
  });
});
