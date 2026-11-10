/**
 * Recipes for screenshots: three attempts that worked, saved under names, as the app does it (through the API).
 * The silk finish comes from a spool the seeded attempts don't link, so it is set in D1 afterwards.
 */
import type { APIRequestContext } from "@playwright/test";
import type { Attempt } from "../../src/shared/api.ts";
import { executeSql } from "../lib/wrangler.ts";

const BUILD = (n: number) => `5eed0000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

export const SEED_RECIPE_IDS = {
  silk: "5eed0000-0000-4000-8000-0000000d0001",
  petg: "5eed0000-0000-4000-8000-0000000d0002",
  bins: "5eed0000-0000-4000-8000-0000000d0003",
};

const specs = [
  {
    id: SEED_RECIPE_IDS.silk,
    build: BUILD(2),
    name: "Silk PLA, slow outer wall",
    note: "Dry it first. The silent profile keeps the outer wall slow and the surface glassy.",
    finish: "silk",
  },
  {
    id: SEED_RECIPE_IDS.petg,
    build: BUILD(4),
    name: "PETG, dried and 245 °C",
    note: "Dry it overnight, then 245 °C. Strings otherwise.",
    finish: null,
  },
  {
    id: SEED_RECIPE_IDS.bins,
    build: BUILD(5),
    name: "PLA bins, fast and square",
    note: "0.24 mm and a brim: six at once.",
    finish: null,
  },
];

export async function seedRecipes(alex: APIRequestContext, origin: string, stateDir: string) {
  for (const spec of specs) {
    const response = await alex.get(`/api/items/${spec.build}`);
    if (!response.ok()) throw new Error(`Seeding recipes: build ${spec.build} is missing (${response.status()})`);
    const { item } = (await response.json()) as { item: { attempts: Attempt[] } };
    const worked = [...item.attempts].reverse().find((attempt) => attempt.outcome === "success");
    if (!worked) throw new Error(`Seeding recipes: ${spec.build} has no attempt that worked`);
    const saved = await alex.post("/api/recipes", {
      headers: { Origin: origin },
      data: { id: spec.id, name: spec.name, note: spec.note, sourceAttemptId: worked.id },
    });
    if (!saved.ok()) throw new Error(`Seeding recipe "${spec.name}" failed: ${saved.status()} ${await saved.text()}`);
    if (spec.finish) {
      executeSql(`UPDATE recipes SET finish = '${spec.finish}' WHERE id = '${spec.id}';`, { persistTo: stateDir });
    }
  }
}
