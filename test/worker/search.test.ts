import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  AttemptResponse,
  FacetsResponse,
  Item,
  ItemResponse,
  SearchResponse,
  WhatWorkedResponse,
} from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn, uploadPhoto } from "./helpers.ts";

let cookie: string;
let samCookie: string;
let samId: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  samId = await addUser("sam", "battery staple", "Sam Okafor", "sea");
  cookie = await signIn("alex", "correct horse");
  samCookie = await signIn("sam", "battery staple");
});

const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000;

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

async function search(params: Record<string, string>, as = cookie): Promise<SearchResponse> {
  const response = await request(`/api/search?${new URLSearchParams(params)}`, { cookie: as });
  expect(response.status).toBe(200);
  return response.json<SearchResponse>();
}

const ids = (hits: Array<{ attempt: { id: string } }>) => hits.map((hit) => hit.attempt.id);
const itemIds = (hits: Array<{ item: { id: string } }>) => hits.map((hit) => hit.item.id);

const petg = { filaments: [{ type: "PETG", brand: "Bambu", colorName: "Blue" }], bedType: "Textured PEI Plate" };
const pla = { filaments: [{ type: "PLA", brand: "Polymaker", colorName: "Terracotta" }], bedType: "Cool Plate" };

describe("signed out", () => {
  it("returns nothing to anyone signed out", async () => {
    const item = await createItem({ title: "Tugboat" });
    await logAttempt(item.id, { outcome: "failed", failureTags: ["warping"], settings: petg });
    for (const path of [
      "/api/search?q=tugboat",
      "/api/facets",
      `/api/what-worked?item=${item.id}&material=PETG`,
      "/api/journal",
      "/api/journal/summary?from=0&to=9999999999999",
    ]) {
      const response = await request(path);
      expect(response.status, path).toBe(401);
      expect(await response.text(), path).not.toContain("Tugboat");
    }
  });
});

describe("search", () => {
  it("finds an attempt by a failure tag plus a material", async () => {
    const box = await createItem({ title: "Swatch box", stage: "building" });
    const vase = await createItem({ title: "Vase", stage: "building" });
    const petgWarp = await logAttempt(box.id, { outcome: "failed", failureTags: ["warping"], settings: petg });
    const petgFine = await logAttempt(box.id, { outcome: "success", settings: petg, printedAt: minutesAgo(-0) });
    await logAttempt(vase.id, { outcome: "failed", failureTags: ["warping"], settings: pla });

    const found = await search({ q: "PETG warping" });
    expect(ids(found.attempts)).toEqual([petgWarp.id]);
    expect(ids(found.attempts)).not.toContain(petgFine.id);
    expect(found.attempts[0]).toMatchObject({ number: 1, item: { id: box.id, title: "Swatch box" } });
  });

  it("matches the start of words as you type", async () => {
    const tug = await createItem({ title: "Bath tugboat" });
    const box = await createItem({ title: "Box", stage: "building" });
    const attempt = await logAttempt(box.id, { outcome: "failed", failureTags: ["warping"], settings: petg });

    expect(itemIds((await search({ q: "tug" })).ideas)).toEqual([tug.id]);
    expect(ids((await search({ q: "war" })).attempts)).toEqual([attempt.id]);
    expect(ids((await search({ q: "pet war" })).attempts)).toEqual([attempt.id]);
    // Tag labels count too: "Bed adhesion" is stored as bed-adhesion, "Drying helped" as dried-filament-helped.
    const dried = await logAttempt(box.id, { outcome: "success", successNotes: ["dried-filament-helped"] });
    expect(ids((await search({ q: "drying" })).attempts)).toEqual([dried.id]);
  });

  it("reads PLA as a material, not the start of plate or planter", async () => {
    const planter = await createItem({ title: "Planter", stage: "building" });
    const plaAttempt = await logAttempt(planter.id, { outcome: "success", settings: pla });
    const petgAttempt = await logAttempt(planter.id, { outcome: "success", settings: petg });

    const found = await search({ q: "pla" });
    expect(ids(found.attempts)).toEqual([plaAttempt.id]);
    expect(ids(found.attempts)).not.toContain(petgAttempt.id);
    expect(found.builds).toEqual([]);
    // Typing on finds the planter.
    expect(itemIds((await search({ q: "plan" })).builds)).toEqual([planter.id]);
  });

  it("finds settings, outcomes and notes, and groups ideas, builds and attempts", async () => {
    const idea = await createItem({ note: "A spool holder for the shelf above the printer" });
    const build = await createItem({ title: "Spool holder", stage: "building" });
    const attempt = await logAttempt(build.id, {
      outcome: "failed",
      note: "Arm snapped off",
      settings: { ...petg, supportEnabled: true, supportType: "tree", brim: true },
    });

    const found = await search({ q: "spool" });
    expect(itemIds(found.ideas)).toEqual([idea.id]);
    expect(itemIds(found.builds)).toEqual([build.id]);
    // An attempt carries its build's title.
    expect(ids(found.attempts)).toEqual([attempt.id]);
    expect(found.ideas[0]?.snippet).toContain("\u{E000}spool\u{E001}");

    expect(ids((await search({ q: "tree supports" })).attempts)).toEqual([attempt.id]);
    expect(ids((await search({ q: "spaghetti snapped" })).attempts)).toEqual([attempt.id]);
    expect(ids((await search({ q: "textured" })).attempts)).toEqual([attempt.id]);
    expect(ids((await search({ q: "blue bambu" })).attempts)).toEqual([attempt.id]);
    expect(await search({ q: "nothing like this" })).toEqual({ builds: [], ideas: [], attempts: [], recipes: [] });
  });

  it("ranks a match in the title above one in a note", async () => {
    const inNote = await createItem({ title: "Desk tidy", note: "Clips, a bin, and a hook for the lamp" });
    const inTitle = await createItem({ title: "Lamp hook", note: "For the reading lamp by the bed" });
    const found = await search({ q: "hook" });
    expect(itemIds(found.ideas)).toEqual([inTitle.id, inNote.id]);
  });

  it("ignores FTS syntax people type", async () => {
    await createItem({ title: "Tugboat" });
    for (const q of ['"tug', "tug*", "NEAR(tug boat)", "tug OR", "-tug", "tug:boat", "^tug", "(", "*"]) {
      const response = await request(`/api/search?q=${encodeURIComponent(q)}`, { cookie });
      expect(response.status, q).toBe(200);
    }
  });

  it("keeps the index up to date after edits and deletes", async () => {
    const build = await createItem({ title: "Tugboat", stage: "building" });
    const attempt = await logAttempt(build.id, { outcome: "partial", note: "Corners curled", settings: petg });

    // A changed note is found by its new words, not its old ones.
    await request(`/api/attempts/${attempt.id}`, {
      method: "PATCH",
      cookie,
      json: { note: "Stern lifted", failureTags: ["layer-shift"], settings: pla },
    });
    expect(ids((await search({ q: "stern" })).attempts)).toEqual([attempt.id]);
    expect(ids((await search({ q: "curled" })).attempts)).toEqual([]);
    expect(ids((await search({ q: "shift pla" })).attempts)).toEqual([attempt.id]);
    expect(ids((await search({ q: "petg" })).attempts)).toEqual([]);

    // Renaming the build renames it in its attempts' rows.
    await request(`/api/items/${build.id}`, { method: "PATCH", cookie, json: { title: "Ferry" } });
    expect(ids((await search({ q: "ferry stern" })).attempts)).toEqual([attempt.id]);
    expect(itemIds((await search({ q: "ferry" })).builds)).toEqual([build.id]);
    expect((await search({ q: "tugboat" })).attempts).toEqual([]);

    // A deleted attempt disappears, and comes back with undo.
    await request(`/api/attempts/${attempt.id}`, { method: "DELETE", cookie });
    expect((await search({ q: "stern" })).attempts).toEqual([]);
    await request(`/api/attempts/${attempt.id}/restore`, { method: "POST", cookie });
    expect(ids((await search({ q: "stern" })).attempts)).toEqual([attempt.id]);

    // So does a deleted build, with its attempts.
    await request(`/api/items/${build.id}`, { method: "DELETE", cookie });
    expect(await search({ q: "ferry" })).toEqual({ builds: [], ideas: [], attempts: [], recipes: [] });

    // Rows removed for good leave the index too.
    await env.DB.prepare("DELETE FROM items WHERE id = ?").bind(build.id).run();
    const { results } = await env.DB.prepare("SELECT count(*) AS n FROM search").all<{ n: number }>();
    expect(results[0]?.n).toBe(0);
  });

  it("narrows by outcome, material, tag and person", async () => {
    const build = await createItem({ title: "Hook", stage: "building" });
    const failed = await logAttempt(build.id, {
      outcome: "failed",
      failureTags: ["warping"],
      settings: petg,
      printedAt: minutesAgo(30),
    });
    const partial = await logAttempt(
      build.id,
      { outcome: "partial", failureTags: ["stringing"], settings: pla, printedAt: minutesAgo(20) },
      samCookie,
    );
    const worked = await logAttempt(build.id, {
      outcome: "success",
      successNotes: ["great-first-layer"],
      settings: petg,
      printedAt: minutesAgo(10),
    });

    expect(ids((await search({ q: "hook", outcome: "failures" })).attempts).sort()).toEqual(
      [failed.id, partial.id].sort(),
    );
    expect(ids((await search({ q: "hook", outcome: "success" })).attempts)).toEqual([worked.id]);
    expect(ids((await search({ q: "hook", material: "petg" })).attempts).sort()).toEqual([failed.id, worked.id].sort());
    expect(ids((await search({ q: "hook", tag: "stringing" })).attempts)).toEqual([partial.id]);
    expect(ids((await search({ q: "hook", tag: "great-first-layer" })).attempts)).toEqual([worked.id]);
    expect(ids((await search({ q: "hook", person: samId })).attempts)).toEqual([partial.id]);
    // Attempt filters leave ideas and builds out.
    expect((await search({ q: "hook", material: "petg" })).builds).toEqual([]);
    // Filters alone list the newest attempts that pass them.
    expect(ids((await search({ outcome: "failures" })).attempts)).toEqual([partial.id, failed.id]);
    expect(await search({})).toEqual({ builds: [], ideas: [], attempts: [], recipes: [] });
  });

  it("shows an attempt's own photo, else its build's", async () => {
    const build = await createItem({ title: "Stand", stage: "building" });
    const cover = crypto.randomUUID();
    expect((await uploadPhoto(build.id, cover, cookie)).status).toBe(201);
    const withPhoto = await logAttempt(build.id, { outcome: "success", note: "stand one", printedAt: minutesAgo(5) });
    const own = crypto.randomUUID();
    expect((await uploadPhoto(build.id, own, cookie, { attemptId: withPhoto.id })).status).toBe(201);
    const without = await logAttempt(build.id, { outcome: "failed", note: "stand two" });

    const found = await search({ q: "stand" });
    const photoOf = (id: string) => found.attempts.find((hit) => hit.attempt.id === id)?.photo?.id;
    expect(photoOf(withPhoto.id)).toBe(own);
    expect(photoOf(without.id)).toBe(cover);
    expect(found.builds[0]).toMatchObject({ attempts: 2, lastOutcome: "failed", photo: { id: cover } });
  });
});

describe("facets", () => {
  it("counts materials and tags in use, most used first", async () => {
    const build = await createItem({ stage: "building" });
    await logAttempt(build.id, { outcome: "failed", failureTags: ["warping", "stringing"], settings: petg });
    // Same material, another spool: still one PETG.
    await logAttempt(build.id, {
      outcome: "failed",
      failureTags: ["warping"],
      settings: { filaments: [{ type: "petg", brand: "Polymaker", colorName: "Teal" }] },
    });
    await logAttempt(build.id, {
      outcome: "success",
      successNotes: ["nice-surface"],
      settings: { filaments: [{ type: " pla " }] },
    });
    const gone = await createItem({ stage: "building" });
    await logAttempt(gone.id, { outcome: "failed", failureTags: ["clog"], settings: { filaments: [{ type: "ABS" }] } });
    await request(`/api/items/${gone.id}`, { method: "DELETE", cookie });

    const response = await request("/api/facets", { cookie });
    const facets = await response.json<FacetsResponse>();
    expect(facets.materials).toEqual([
      { value: "PETG", count: 2 },
      { value: "PLA", count: 1 },
    ]);
    expect(facets.tags[0]).toEqual({ kind: "failure", slug: "warping", count: 2 });
    expect(facets.tags.map((tag) => tag.slug)).toEqual(["warping", "nice-surface", "stringing"]);
  });
});

describe("what worked last time", () => {
  async function whatWorked(itemId: string, materialName?: string) {
    const params = new URLSearchParams({ item: itemId, ...(materialName ? { material: materialName } : {}) });
    const response = await request(`/api/what-worked?${params}`, { cookie });
    expect(response.status).toBe(200);
    return (await response.json<WhatWorkedResponse>()).matches;
  }

  it("offers the latest attempts that worked with the material, the same build first", async () => {
    const hook = await createItem({ title: "Hook", stage: "building" });
    const box = await createItem({ title: "Box", stage: "building" });
    const vase = await createItem({ title: "Vase", stage: "building" });
    const hookWorked = await logAttempt(hook.id, {
      outcome: "success",
      settings: { ...petg, bedTemperature: 70 },
      printedAt: minutesAgo(300),
    });
    await logAttempt(hook.id, { outcome: "failed", settings: petg, printedAt: minutesAgo(200) });
    const boxWorked = await logAttempt(box.id, { outcome: "success", settings: petg, printedAt: minutesAgo(100) });
    await logAttempt(vase.id, { outcome: "success", settings: pla, printedAt: minutesAgo(50) });

    const matches = await whatWorked(hook.id, "petg");
    expect(matches.map((match) => match.attempt.id)).toEqual([hookWorked.id, boxWorked.id]);
    expect(matches[0]).toMatchObject({ sameBuild: true, number: 1, item: { title: "Hook" } });
    expect(matches[0]?.attempt.settings.bedTemperature).toBe(70);
    expect(matches[1]?.sameBuild).toBe(false);

    // Another build: the most recent first.
    expect((await whatWorked(vase.id, "PETG")).map((match) => match.attempt.id)).toEqual([boxWorked.id, hookWorked.id]);
    // No material known yet: only the build's own.
    expect((await whatWorked(hook.id)).map((match) => match.attempt.id)).toEqual([hookWorked.id]);
    // Nothing relevant: nothing offered.
    expect(await whatWorked(box.id, "TPU")).toEqual([]);
    const fresh = await createItem({ stage: "building" });
    expect(await whatWorked(fresh.id)).toEqual([]);
  });
});
