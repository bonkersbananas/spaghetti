import { beforeEach, describe, expect, it } from "vitest";
import type {
  Attempt,
  AttemptResponse,
  Item,
  ItemResponse,
  Spool,
  SpoolResponse,
  SpoolsResponse,
  SpoolUsageResponse,
} from "../../src/shared/api.ts";
import type { AttemptSettings } from "../../src/shared/attempts.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

async function addSpool(body: Record<string, unknown> = {}): Promise<Spool> {
  const response = await request("/api/spools", {
    method: "POST",
    cookie,
    json: { id: crypto.randomUUID(), material: "PLA", ...body },
  });
  expect(response.status).toBe(201);
  return (await response.json<SpoolResponse>()).spool;
}

const getSpool = async (id: string) =>
  (await (await request(`/api/spools/${id}`, { cookie })).json<SpoolResponse>()).spool;

async function build(): Promise<Item> {
  const response = await request("/api/items", {
    method: "POST",
    cookie,
    json: { id: crypto.randomUUID(), stage: "building", title: "Bath tugboat" },
  });
  return (await response.json<ItemResponse>()).item;
}

async function attempt(itemId: string, settings: AttemptSettings, extra: Record<string, unknown> = {}) {
  const response = await request(`/api/items/${itemId}/attempts`, {
    method: "POST",
    cookie,
    json: { id: crypto.randomUUID(), settings, ...extra },
  });
  expect(response.status).toBe(201);
  return (await response.json<AttemptResponse>()).attempt as Attempt;
}

const finish = (id: string, outcome: string) =>
  request(`/api/attempts/${id}/finish`, { method: "POST", cookie, json: { outcome } });

describe("grams on a spool", () => {
  it("has none until it has a weight: the level stays hand-set", async () => {
    const spool = await addSpool({ remaining: "low" });
    expect(spool).toMatchObject({ netGrams: null, gramsLeft: null, remaining: "low", weighedAt: null });
  });

  it("takes a net weight when created, or later, and clears it", async () => {
    const spool = await addSpool({ netGrams: 1000 });
    expect(spool).toMatchObject({ netGrams: 1000, gramsLeft: 1000, remaining: "full" });
    const other = await addSpool({ remaining: "low" });
    const set = await request(`/api/spools/${other.id}/weight`, {
      method: "PUT",
      cookie,
      json: { netGrams: 500, tareGrams: 120 },
    });
    expect((await set.json<SpoolResponse>()).spool).toMatchObject({
      netGrams: 500,
      tareGrams: 120,
      gramsLeft: 500,
      remaining: "full",
    });
    const cleared = await request(`/api/spools/${other.id}/weight`, {
      method: "PUT",
      cookie,
      json: { netGrams: null },
    });
    expect((await cleared.json<SpoolResponse>()).spool).toMatchObject({ gramsLeft: null, remaining: "low" });
    expect(
      (await request(`/api/spools/${other.id}/weight`, { method: "PUT", cookie, json: { netGrams: 0 } })).status,
    ).toBe(400);
    expect(
      (await request(`/api/spools/${crypto.randomUUID()}/weight`, { method: "PUT", cookie, json: { netGrams: 5 } }))
        .status,
    ).toBe(404);
  });

  it("counts a finished attempt's grams off the spool, and follows edits, deletes and undo", async () => {
    const spool = await addSpool({ netGrams: 1000 });
    const item = await build();
    const made = await attempt(item.id, { filaments: [{ type: "PLA", spoolId: spool.id, grams: 66 }] });
    expect((await getSpool(spool.id)).gramsLeft).toBe(1000);

    expect((await finish(made.id, "success")).status).toBe(200);
    expect(await getSpool(spool.id)).toMatchObject({ gramsLeft: 934, gramsApproximate: false, remaining: "full" });

    // Edited: another spool takes the grams.
    const other = await addSpool({ netGrams: 250 });
    await request(`/api/attempts/${made.id}`, {
      method: "PATCH",
      cookie,
      json: { settings: { filaments: [{ type: "PLA", spoolId: other.id, grams: 66 }] } },
    });
    expect((await getSpool(spool.id)).gramsLeft).toBe(1000);
    expect(await getSpool(other.id)).toMatchObject({ gramsLeft: 184, remaining: "full" });

    // Failed at 50 %: half the grams, about.
    await request(`/api/attempts/${made.id}`, {
      method: "PATCH",
      cookie,
      json: { outcome: "failed", settings: { failedAtPercent: 50, filaments: [{ spoolId: other.id, grams: 66 }] } },
    });
    expect(await getSpool(other.id)).toMatchObject({ gramsLeft: 217, gramsApproximate: true });

    // Deleted and restored.
    expect((await request(`/api/attempts/${made.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await getSpool(other.id)).gramsLeft).toBe(250);
    await request(`/api/attempts/${made.id}/restore`, { method: "POST", cookie });
    expect((await getSpool(other.id)).gramsLeft).toBe(217);

    // A deleted build gives its grams back too.
    await request(`/api/items/${item.id}`, { method: "DELETE", cookie });
    expect((await getSpool(other.id)).gramsLeft).toBe(250);
  });

  it("restarts from a weighing, takes the empty spool off, and undoes it", async () => {
    const spool = await addSpool({ netGrams: 1000 });
    const item = await build();
    const made = await attempt(item.id, { filaments: [{ spoolId: spool.id, grams: 100 }] });
    await finish(made.id, "success");

    const id = crypto.randomUUID();
    const weigh = (body: Record<string, unknown>) =>
      request(`/api/spools/${spool.id}/weighings`, { method: "POST", cookie, json: body });
    const first = await weigh({ id, onScale: 812, tareGrams: 250 });
    expect(first.status).toBe(201);
    expect((await first.json<SpoolResponse>()).spool).toMatchObject({ gramsLeft: 562, tareGrams: 250 });
    // The attempt finished before the weighing: it doesn't come off again.
    expect((await getSpool(spool.id)).weighedAt).not.toBeNull();

    // A retry changes nothing.
    await weigh({ id, onScale: 812 });
    expect((await getSpool(spool.id)).gramsLeft).toBe(562);

    // A later attempt comes off the new baseline.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const next = await attempt(item.id, { filaments: [{ spoolId: spool.id, grams: 40 }] });
    await finish(next.id, "partial");
    expect((await getSpool(spool.id)).gramsLeft).toBe(522);

    const usage = (await (await request(`/api/spools/${spool.id}/usage`, { cookie })).json()) as SpoolUsageResponse;
    expect(usage.usage.map((entry) => [entry.title, entry.number, entry.grams, entry.counted])).toEqual([
      ["Bath tugboat", 2, 40, true],
      ["Bath tugboat", 1, 100, false],
    ]);
    expect(usage.weighings).toMatchObject([{ id, gramsLeft: 562, onScale: 812 }]);

    // Undo.
    const undone = await request(`/api/spools/${spool.id}/weighings/${id}`, { method: "DELETE", cookie });
    expect((await undone.json<SpoolResponse>()).spool).toMatchObject({ gramsLeft: 860, weighedAt: null });
  });

  it("weighs a spool that has no net weight, from grams left, and rejects nothing to weigh", async () => {
    const spool = await addSpool();
    const response = await request(`/api/spools/${spool.id}/weighings`, {
      method: "POST",
      cookie,
      json: { id: crypto.randomUUID(), gramsLeft: 90 },
    });
    expect((await response.json<SpoolResponse>()).spool).toMatchObject({ gramsLeft: 90, remaining: "low" });
    const bad = await request(`/api/spools/${spool.id}/weighings`, {
      method: "POST",
      cookie,
      json: { id: crypto.randomUUID() },
    });
    expect(bad.status).toBe(400);
  });

  it("lets grams win over a level sent by hand or by the AMS", async () => {
    const spool = await addSpool({ netGrams: 1000 });
    const patched = await request(`/api/spools/${spool.id}`, { method: "PATCH", cookie, json: { remaining: "empty" } });
    expect((await patched.json<SpoolResponse>()).spool).toMatchObject({ remaining: "full", gramsLeft: 1000 });
    const plain = await addSpool();
    const hand = await request(`/api/spools/${plain.id}`, { method: "PATCH", cookie, json: { remaining: "half" } });
    expect((await hand.json<SpoolResponse>()).spool.remaining).toBe("half");
  });

  it("puts grams in the list, and a spool's gone weighings go with it", async () => {
    const spool = await addSpool({ netGrams: 750 });
    const list = (await (await request("/api/spools", { cookie })).json<SpoolsResponse>()).spools;
    expect(list.find((s) => s.id === spool.id)?.gramsLeft).toBe(750);
  });
});
