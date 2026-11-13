import { beforeEach, describe, expect, it } from "vitest";
import type {
  AttemptResponse,
  Item,
  ItemResponse,
  RecipeResponse,
  RecipesResponse,
  SearchResponse,
  WhatWorkedResponse,
} from "../../src/shared/api.ts";
import type { AttemptSettings, Outcome } from "../../src/shared/attempts.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;
let samCookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  await addUser("sam", "battery staple", "Sam Okafor", "sea");
  cookie = await signIn("alex", "correct horse");
  samCookie = await signIn("sam", "battery staple");
});

const uuid = () => crypto.randomUUID();

async function build(title = "Tugboat", as = cookie): Promise<Item> {
  const response = await request("/api/items", {
    method: "POST",
    cookie: as,
    json: { id: uuid(), title, stage: "building" },
  });
  return (await response.json<ItemResponse>()).item;
}

async function attempt(itemId: string, outcome: Outcome, settings: AttemptSettings, as = cookie) {
  const response = await request(`/api/items/${itemId}/attempts`, {
    method: "POST",
    cookie: as,
    json: { id: uuid(), outcome, settings },
  });
  expect(response.status).toBe(201);
  return (await response.json<AttemptResponse>()).attempt;
}

const silk: AttemptSettings = {
  filaments: [{ type: "pla", brand: "Bambu", colorName: "Gold", amsSlot: "A1", grams: 12 }],
  layerHeight: 0.16,
  nozzleTemperature: 225,
  brim: true,
  actualMinutes: 90,
  weightGrams: 12,
};

async function save(sourceAttemptId: string, name = "Silk PLA, slow outer wall", extra: Record<string, unknown> = {}) {
  const id = uuid();
  const response = await request("/api/recipes", {
    method: "POST",
    cookie,
    json: { id, name, sourceAttemptId, ...extra },
  });
  return { id, response };
}

describe("saving a recipe", () => {
  it("keeps the attempt's chosen settings, its material and a link back, without results or slots", async () => {
    const item = await build();
    const worked = await attempt(item.id, "success", silk);
    const { id, response } = await save(worked.id, "Silk PLA, slow outer wall", { note: "  Outer wall at 60 mm/s " });
    expect(response.status).toBe(201);
    const { recipe } = await response.json<RecipeResponse>();
    expect(recipe).toMatchObject({
      id,
      name: "Silk PLA, slow outer wall",
      note: "Outer wall at 60 mm/s",
      material: "PLA",
      finish: null,
      // No model Spaghetti sliced: no slicing settings of its own.
      slicing: null,
      source: { attemptId: worked.id, itemId: item.id, title: "Tugboat", number: 1 },
    });
    expect(recipe.settings).toEqual({
      filaments: [{ type: "pla", brand: "Bambu", colorName: "Gold" }],
      layerHeight: 0.16,
      nozzleTemperature: 225,
      brim: true,
    });
  });

  it("takes the finish from the spool it was printed on", async () => {
    const spoolId = uuid();
    await request("/api/spools", { method: "POST", cookie, json: { id: spoolId, material: "PLA", finish: "silk" } });
    const item = await build();
    const worked = await attempt(item.id, "success", { filaments: [{ type: "PLA", spoolId }] });
    const { response } = await save(worked.id);
    const { recipe } = await response.json<RecipeResponse>();
    expect(recipe.finish).toBe("silk");
    expect(recipe.settings.filaments).toEqual([{ type: "PLA" }]);
  });

  it("only from an attempt that worked and names its filament", async () => {
    const item = await build();
    const failed = await attempt(item.id, "failed", silk);
    const refused = await save(failed.id);
    expect(refused.response.status).toBe(422);
    expect((await refused.response.json<{ error: { code: string } }>()).error.code).toBe("not_worked");

    const bare = await attempt(item.id, "success", { layerHeight: 0.2 });
    const noMaterial = await save(bare.id);
    expect(noMaterial.response.status).toBe(422);
    expect((await noMaterial.response.json<{ error: { code: string } }>()).error.code).toBe("no_material");

    expect((await save(uuid())).response.status).toBe(404);
  });

  it("ignores settings in the request, and repeats return the same recipe", async () => {
    const item = await build();
    const worked = await attempt(item.id, "success", silk);
    const id = uuid();
    const body = { id, name: "Silk", sourceAttemptId: worked.id, settings: { layerHeight: 0.4 } };
    const first = await request("/api/recipes", { method: "POST", cookie, json: body });
    const again = await request("/api/recipes", { method: "POST", cookie, json: body });
    expect(again.status).toBe(201);
    expect((await first.json<RecipeResponse>()).recipe.settings.layerHeight).toBe(0.16);
    expect((await again.json<RecipeResponse>()).recipe.settings.layerHeight).toBe(0.16);
    const list = await (await request("/api/recipes", { cookie })).json<RecipesResponse>();
    expect(list.recipes).toHaveLength(1);
  });
});

describe("editing, deleting and finding recipes", () => {
  it("renames and annotates, never touches the settings; delete is undone by restore", async () => {
    const item = await build();
    const worked = await attempt(item.id, "success", silk);
    const { id } = await save(worked.id);
    const renamed = await request(`/api/recipes/${id}`, {
      method: "PATCH",
      cookie: samCookie,
      json: { name: "Gold silk", note: "Dry it first", settings: { layerHeight: 0.4 } },
    });
    const { recipe } = await renamed.json<RecipeResponse>();
    expect(recipe).toMatchObject({ name: "Gold silk", note: "Dry it first" });
    expect(recipe.settings.layerHeight).toBe(0.16);
    expect((await request(`/api/recipes/${id}`, { method: "PATCH", cookie, json: { name: " " } })).status).toBe(400);

    expect((await request(`/api/recipes/${id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await request(`/api/recipes/${id}`, { method: "DELETE", cookie })).status).toBe(404);
    expect((await (await request("/api/recipes", { cookie })).json<RecipesResponse>()).recipes).toEqual([]);
    expect((await request(`/api/recipes/${id}/restore`, { method: "POST", cookie })).status).toBe(200);
    expect((await (await request("/api/recipes", { cookie })).json<RecipesResponse>()).recipes).toHaveLength(1);
  });

  it("outlives its attempt: the link goes quiet, the recipe stays", async () => {
    const item = await build();
    const worked = await attempt(item.id, "success", silk);
    await save(worked.id);
    await request(`/api/attempts/${worked.id}`, { method: "DELETE", cookie });
    const list = await (await request("/api/recipes", { cookie })).json<RecipesResponse>();
    expect(list.recipes).toHaveLength(1);
    expect(list.recipes[0]?.source).toBeNull();
  });

  it("matches by material and finish", async () => {
    const item = await build();
    const spoolId = uuid();
    await request("/api/spools", { method: "POST", cookie, json: { id: spoolId, material: "PLA", finish: "silk" } });
    const silkAttempt = await attempt(item.id, "success", { filaments: [{ type: "PLA", spoolId }] });
    const plain = await attempt(item.id, "success", { filaments: [{ type: "PLA" }] });
    const petg = await attempt(item.id, "success", { filaments: [{ type: "PETG" }] });
    await save(silkAttempt.id, "Silk PLA");
    await save(plain.id, "PLA at large");
    await save(petg.id, "PETG");
    const names = async (query: string) =>
      (await (await request(`/api/recipes?${query}`, { cookie })).json<RecipesResponse>()).recipes.map((r) => r.name);
    expect(await names("material=pla")).toEqual(expect.arrayContaining(["Silk PLA", "PLA at large"]));
    expect(await names("material=PLA&finish=silk")).toEqual(["Silk PLA", "PLA at large"]);
    expect(await names("material=PLA&finish=matte")).toEqual(["PLA at large"]);
    expect(await names("material=PETG")).toEqual(["PETG"]);
  });

  it("shows up in search as its own kind, and in what-worked for the material", async () => {
    const item = await build();
    const worked = await attempt(item.id, "success", silk);
    await save(worked.id, "Silk PLA, slow outer wall", { note: "Dry it first" });
    const found = await (await request("/api/search?q=silk", { cookie })).json<SearchResponse>();
    expect(found.recipes.map((r) => r.name)).toEqual(["Silk PLA, slow outer wall"]);
    expect((await (await request("/api/search?q=dry", { cookie })).json<SearchResponse>()).recipes).toHaveLength(1);
    expect((await (await request("/api/search?q=silk%20petg", { cookie })).json<SearchResponse>()).recipes).toEqual([]);
    // An outcome or tag filter is about attempts.
    expect(
      (await (await request("/api/search?q=silk&outcome=failed", { cookie })).json<SearchResponse>()).recipes,
    ).toEqual([]);
    // A material filter alone finds the recipes for it.
    expect((await (await request("/api/search?material=PLA", { cookie })).json<SearchResponse>()).recipes).toHaveLength(
      1,
    );

    const worker = await (
      await request(`/api/what-worked?item=${item.id}&material=PLA`, { cookie })
    ).json<WhatWorkedResponse>();
    expect(worker.recipes.map((r) => r.name)).toEqual(["Silk PLA, slow outer wall"]);
    const none = await (await request(`/api/what-worked?item=${item.id}`, { cookie })).json<WhatWorkedResponse>();
    expect(none.recipes).toEqual([]);
  });
});
