import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { AttemptResponse, Item, ItemResponse, SearchResponse } from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

/** Questions as the two of them type them (audit table in the pull request). */
let cookie: string;
let samCookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  await addUser("sam", "battery staple", "Sam Okafor", "sea");
  cookie = await signIn("alex", "correct horse");
  samCookie = await signIn("sam", "battery staple");
});

const DAY = 86_400_000;

async function createItem(body: Record<string, unknown> = {}, as = cookie): Promise<Item> {
  const response = await request("/api/items", {
    method: "POST",
    cookie: as,
    json: { id: crypto.randomUUID(), ...body },
  });
  expect(response.status).toBe(201);
  return (await response.json<ItemResponse>()).item;
}

async function logAttempt(itemId: string, body: Record<string, unknown> = {}, as = cookie) {
  const response = await request(`/api/items/${itemId}/attempts`, {
    method: "POST",
    cookie: as,
    json: { id: crypto.randomUUID(), settings: {}, ...body },
  });
  expect(response.status).toBe(201);
  return (await response.json<AttemptResponse>()).attempt;
}

async function search(q: string, extra: Record<string, string> = {}, as = cookie): Promise<SearchResponse> {
  const response = await request(`/api/search?${new URLSearchParams({ q, ...extra })}`, { cookie: as });
  expect(response.status).toBe(200);
  return response.json<SearchResponse>();
}

const ids = (hits: Array<{ attempt: { id: string } }>) => hits.map((hit) => hit.attempt.id);
const petg = (more: Record<string, unknown> = {}) => ({
  filaments: [{ type: "PETG", brand: "Bambu", colorName: "Blue" }],
  bedType: "Textured PEI Plate",
  ...more,
});

describe("settings as words", () => {
  it("finds temperatures, nozzle and layer height, and puts what worked first", async () => {
    const box = await createItem({ title: "Filament box", stage: "building" });
    const failed = await logAttempt(box.id, {
      outcome: "failed",
      failureTags: ["warping"],
      settings: petg({ bedTemperature: 70, nozzleTemperature: 250, nozzleDiameter: 0.4, layerHeight: 0.2 }),
    });
    const worked = await logAttempt(box.id, {
      outcome: "success",
      settings: petg({ bedTemperature: 75, nozzleTemperature: 250, nozzleDiameter: 0.4, layerHeight: 0.2 }),
    });
    const hot = await search("PETG bed temp");
    // Both used PETG and a bed temperature; the one that worked leads.
    expect(ids(hot.attempts)).toEqual([worked.id, failed.id]);
    expect(ids((await search("bed temperature 70")).attempts)).toEqual([failed.id]);
    expect(ids((await search("0.4 nozzle")).attempts).sort()).toEqual([failed.id, worked.id].sort());
    expect(ids((await search("0,4 nozzle")).attempts)).toHaveLength(2);
    expect(ids((await search("nozzle 0.6")).attempts)).toEqual([]);
    expect(ids((await search("layer height 0.2")).attempts)).toHaveLength(2);
    expect(ids((await search("250")).attempts)).toHaveLength(2);
  });

  it("follows an edited setting", async () => {
    const box = await createItem({ title: "Filament box", stage: "building" });
    const attempt = await logAttempt(box.id, { outcome: "success", settings: petg({ bedTemperature: 70 }) });
    expect(ids((await search("bed 70")).attempts)).toEqual([attempt.id]);
    const patch = await request(`/api/attempts/${attempt.id}`, {
      method: "PATCH",
      cookie,
      json: { settingsMerge: { set: { bedTemperature: 80 } } },
    });
    expect(patch.status).toBe(200);
    expect(ids((await search("bed 70")).attempts)).toEqual([]);
    expect(ids((await search("bed 80")).attempts)).toEqual([attempt.id]);
  });
});

describe("questions in words", () => {
  it("ignores filler and prefers what worked: 'what worked for the paddle steamer'", async () => {
    const boat = await createItem({ title: "Paddle steamer", stage: "building" });
    const failed = await logAttempt(boat.id, { outcome: "failed", failureTags: ["warping"], settings: petg() });
    const partly = await logAttempt(boat.id, { outcome: "partial", settings: petg() });
    const found = await search("what worked for the paddle steamer");
    expect(found.builds.map((hit) => hit.item.id)).toEqual([boat.id]);
    // Nothing worked yet, but the question still finds the build's attempts, the better ones first.
    expect(ids(found.attempts)).toEqual([partly.id, failed.id]);
    expect(found.intent).toBe("worked");
    expect(found.terms?.map((term) => term.text)).toEqual(["paddle", "steamer"]);
  });

  it("answers 'what worked' alone with the attempts that worked", async () => {
    const box = await createItem({ title: "Box", stage: "building" });
    await logAttempt(box.id, { outcome: "failed" });
    const worked = await logAttempt(box.id, { outcome: "success" });
    expect(ids((await search("what worked")).attempts)).toEqual([worked.id]);
    expect(ids((await search("vad fungerade")).attempts)).toEqual([worked.id]);
  });

  it("reads time phrases: 'spaghetti last week'", async () => {
    const box = await createItem({ title: "Box", stage: "building" });
    const lastWeek = Date.now() - 7 * DAY;
    const old = await logAttempt(box.id, {
      outcome: "failed",
      failureTags: ["spaghetti"],
      printedAt: Date.now() - 40 * DAY,
    });
    const recent = await logAttempt(box.id, { outcome: "failed", failureTags: ["spaghetti"], printedAt: lastWeek });
    const found = await search("spaghetti last week");
    expect(ids(found.attempts)).toEqual([recent.id]);
    expect(found.when?.label).toBe("last week");
    expect(found.when?.weekMonday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ids((await search("spaghetti")).attempts).sort()).toEqual([old.id, recent.id].sort());
    // Time alone lists what was printed in it.
    expect(ids((await search("last week")).attempts)).toEqual([recent.id]);
  });

  it("reads a first name as the person: 'Sam's idea about the coffee clips'", async () => {
    const mine = await createItem({ title: "Coffee clips", note: "For the desk" });
    const sams = await createItem({ title: "Coffee clips, round", note: "Thinner" }, samCookie);
    const found = await search("Sam's idea about the coffee clips");
    expect(found.ideas.map((hit) => hit.item.id)).toEqual([sams.id]);
    // Without a match for the person the name is just a word again.
    const titled = await createItem({ title: "Sam stand" });
    expect(
      (await search("sam stand")).builds.concat((await search("sam stand")).ideas).map((hit) => hit.item.id),
    ).toContain(titled.id);
    expect(mine.id).not.toBe(sams.id);
  });

  it("finds what a person said in a thread by their name", async () => {
    const clips = await createItem({ title: "Coffee clips" });
    const response = await request(`/api/items/${clips.id}/comments`, {
      method: "POST",
      cookie: samCookie,
      json: { id: crypto.randomUUID(), body: "Try 0.6 nozzle for chunkier clips" },
    });
    expect(response.status).toBeLessThan(300);
    const found = await search("what Sam said about chunkier");
    expect(found.ideas[0]?.comment?.authorId).toBeTruthy();
  });
});

describe("words people type", () => {
  it("finds a Swedish word by its English twin and the other way round", async () => {
    const box = await createItem({ title: "Box", stage: "building" });
    const attempt = await logAttempt(box.id, { outcome: "failed", failureTags: ["warping"], settings: petg() });
    expect(ids((await search("skevhet")).attempts)).toEqual([attempt.id]);
    expect(ids((await search("blå petg")).attempts)).toEqual([attempt.id]);
    expect(ids((await search("platta")).attempts)).toEqual([attempt.id]);
  });

  it("mends a typo when nothing matched, and says so", async () => {
    const box = await createItem({ title: "Box", stage: "building" });
    const attempt = await logAttempt(box.id, { outcome: "failed", failureTags: ["warping"], settings: petg() });
    const found = await search("wraping petg");
    expect(ids(found.attempts)).toEqual([attempt.id]);
    expect(found.corrected).toBe("warping petg");
    expect(found.terms?.map((term) => term.text)).toEqual(["warping", "petg"]);
    // A word that is known, or the start of one, is left alone.
    expect((await search("warpin")).corrected).toBeNull();
    // Too far gone: nothing.
    expect(ids((await search("qzxv")).attempts)).toEqual([]);
  });

  it("finds a word's start while it is being typed", async () => {
    const box = await createItem({ title: "Tugboat hull", stage: "building" });
    expect((await search("tugb")).builds.map((hit) => hit.item.id)).toEqual([box.id]);
    expect((await search("tu")).builds.map((hit) => hit.item.id)).toEqual([box.id]);
  });
});

describe("the failure coach's ideas", () => {
  it("finds the attempt by what was suggested, and forgets a dismissed suggestion", async () => {
    const box = await createItem({ title: "Hook", stage: "building" });
    const attempt = await logAttempt(box.id, { outcome: "failed", note: "Came loose" });
    const suggestions = [
      { id: "a", title: "Dry the filament first", why: "Wet filament strings", settings: {}, note: null },
      { id: "b", title: "Slow the outer wall", why: "Cleaner corners", settings: {}, note: null },
    ];
    await env.DB.prepare("UPDATE coach_runs SET status = 'done', suggestions = ? WHERE attempt_id = ?")
      .bind(JSON.stringify(suggestions), attempt.id)
      .run();
    const found = await search("dry filament");
    expect(ids(found.attempts)).toEqual([attempt.id]);
    expect(found.attempts[0]?.coachIdea).toBe("Dry the filament first");
    await env.DB.prepare("UPDATE coach_runs SET dismissed = ? WHERE attempt_id = ?")
      .bind(JSON.stringify(["a"]), attempt.id)
      .run();
    expect(ids((await search("dry filament")).attempts)).toEqual([]);
    expect(ids((await search("outer wall")).attempts)).toEqual([attempt.id]);
  });
});

describe("spools", () => {
  it("finds a spool by its colour, brand or finish, with the attempts on that filament", async () => {
    const response = await request("/api/spools", {
      method: "POST",
      cookie,
      json: { id: crypto.randomUUID(), material: "PLA", brand: "Polymaker", colorName: "Terracotta", finish: "silk" },
    });
    expect(response.status).toBe(201);
    for (const q of ["terracotta", "silk PLA", "polymaker", "terra"]) {
      expect((await search(q)).spools.map((spool) => spool.colorName)).toEqual(["Terracotta"]);
    }
    expect((await search("blue")).spools).toEqual([]);
  });
});
