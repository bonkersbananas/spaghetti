import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import TEMPLATE from "../../guest.html?raw";
import type { ItemHit, ItemResponse } from "../../src/shared/api.ts";
import type { ShareResponse } from "../../src/shared/shares.ts";
import { getDb } from "../../src/worker/db/index.ts";
import { guestRoute } from "../../src/worker/guest/index.tsx";
import { loadWeek } from "../../src/worker/week/load.ts";
import { weekNotebook } from "../../src/worker/week/note.ts";
import { addUser, ORIGIN, request, resetDb, signIn } from "./helpers.ts";

/**
 * The shapes real prints made once the printer bridge ran: an attempt off the bed with no outcome (the printer saw it
 * stop, nobody has said how it went), one still printing, and, from some other version of the app, an outcome this one
 * has no word for. Every place that words an attempt must meet them without throwing, and say the right thing.
 */
const uuid = () => crypto.randomUUID();
const at = (iso: string) => Date.parse(iso);
let cookie = "";
let itemId = "";
let offBed = "";
let printing = "";
let strange = "";

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
  itemId = uuid();
  await request("/api/items", { method: "POST", json: { id: itemId, title: "Lid clip", stage: "building" }, cookie });
  const attempt = async (printedAt: string, extra: Record<string, unknown> = {}) => {
    const id = uuid();
    const made = await request(`/api/items/${itemId}/attempts`, {
      method: "POST",
      json: { id, printedAt: at(printedAt), ...extra },
      cookie,
    });
    expect(made.status).toBe(201);
    return id;
  };
  await attempt("2026-01-12T10:00:00+01:00", { outcome: "partial" });
  strange = await attempt("2026-01-13T10:00:00+01:00", { outcome: "success" });
  offBed = await attempt("2026-01-14T10:00:00+01:00");
  printing = await attempt("2026-01-14T14:00:00+01:00");
  const ended = at("2026-01-14T11:00:00+01:00");
  await env.DB.prepare("UPDATE attempts SET ended_at = ? WHERE id = ?").bind(ended, offBed).run();
  // An outcome nothing in this version names (a row from elsewhere): the lookups must not throw on it.
  await env.DB.prepare("UPDATE attempts SET outcome = 'cancelled' WHERE id = ?").bind(strange).run();
});

describe("attempts with no outcome, or one the app has no word for", () => {
  it("is told in a build's story: off the bed is not printing", async () => {
    const response = await request(`/api/builds/${itemId}/story.md`, { cookie });
    expect(response.status).toBe(200);
    const story = await response.text();
    expect(story).toContain("### Attempt 1: Partly");
    expect(story).toContain("### Attempt 3: Off the bed");
    expect(story).toContain("### Attempt 4: Printing");
    expect(story).not.toContain("undefined");
  });

  it("is told on the shared page the same way", async () => {
    const shared = await request(`/api/shares/items/${itemId}`, { method: "PUT", cookie });
    const { share } = await shared.json<ShareResponse>();
    const stub = {
      ...env,
      ASSETS: { fetch: async () => new Response(TEMPLATE, { headers: { "Content-Type": "text/html" } }) },
    } as unknown as Env;
    const response = await guestRoute(new Request(`${ORIGIN}/s/${share.token}`), stub);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Off the bed");
    expect(html).toContain("Printing");
    // Off the bed is drawn neutral, like in the app: only the print on the bed gets the printing look.
    expect(html).toContain("gp-outcome--offbed");
    expect(html).toContain("gp-trail-step--offbed");
    // (The attempt with the outcome nobody knows has no end either, so it reads as printing too.)
    expect(html.match(/gp-outcome--printing/g)).toHaveLength(2);
    expect(html.match(/gp-outcome--offbed/g)).toHaveLength(1);
    expect(html).not.toContain("undefined");
  });

  it("is told in what Claude reads of the week: off the bed is not still printing", async () => {
    const monday = "2026-01-12";
    const week = await loadWeek(env, monday, at("2026-01-15T12:00:00+01:00"), getDb(env.DB));
    const notebook = await weekNotebook(getDb(env.DB), week);
    expect(notebook).toContain("Lid clip, by Alex Rivera: Partly.");
    expect(notebook).toContain("Lid clip, by Alex Rivera: off the bed, not answered yet.");
    expect(notebook).toContain("Lid clip, by Alex Rivera: still printing.");
    expect(notebook).not.toContain("undefined");
  });

  it("tells a search hit when its last attempt stopped, so agents hear off the bed, not printing", async () => {
    await env.DB.prepare("UPDATE attempts SET ended_at = ? WHERE id = ?")
      .bind(at("2026-01-14T15:00:00+01:00"), printing)
      .run();
    const found = await (await request("/api/search?q=lid", { cookie })).json<{ builds: ItemHit[] }>();
    expect(found.builds[0]).toMatchObject({ lastOutcome: null, lastEndedAt: at("2026-01-14T15:00:00+01:00") });
  });

  it("keeps every screen's data loading", async () => {
    for (const path of [
      `/api/items/${itemId}`,
      "/api/items?stage=building",
      "/api/journal",
      "/api/insights?year=2026",
      "/api/deleted",
      "/api/search?q=lid",
    ]) {
      const response = await request(path, { cookie });
      expect(response.status, path).toBe(200);
    }
    const { item } = await (await request(`/api/items/${itemId}`, { cookie })).json<ItemResponse>();
    expect(item.attempts.find((attempt) => attempt.id === offBed)).toMatchObject({ outcome: null });
    expect(item.attempts.find((attempt) => attempt.id === printing)).toMatchObject({ endedAt: null });
  });
});
