import { beforeEach, describe, expect, it } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type { AttemptResponse, ItemResponse } from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;
let token: string;

const uuid = () => crypto.randomUUID();
const asBridge = (path: string, init: RequestInit & { json?: unknown } = {}) =>
  request(path, { ...init, headers: { Authorization: `Bearer ${token}`, Origin: "http://printer.test" } });

beforeEach(async () => {
  await resetDb();
  await addUser("carl", "correct horse", "Carl Oscar", "sea");
  cookie = await signIn("carl", "correct horse");
  const made = await request("/api/agents", {
    method: "POST",
    json: { name: "Printer bridge", scopes: ["read", "attempts", "printer"] },
    cookie,
  });
  token = (await made.json<NewTokenResponse>()).token;
  await asBridge("/api/printer/bridge", { method: "PUT", json: { printerState: "idle", progress: null } });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SLICED = {
  filaments: [{ type: "PLA", colorHex: "#f4f4f0", profile: "Bambu PLA Basic", grams: 7 }],
  layerHeight: 0.2,
  bedType: "Textured PEI Plate",
  nozzleTemperature: 220,
  estimatedMinutes: 40,
};

async function build(title: string) {
  const id = uuid();
  const response = await request("/api/items", { method: "POST", cookie, json: { id, title, stage: "building" } });
  expect(response.status).toBe(201);
  return id;
}

async function keepFile(itemId: string, name: string, prefill: object, plate = 1) {
  const body = new FormData();
  body.set("name", name);
  body.set("size", "4");
  body.set("plate", String(plate));
  body.set("plateCount", String(plate));
  body.set("prefill", JSON.stringify(prefill));
  body.set("file", new File([new Uint8Array([0x50, 0x4b, 3, 4])], name));
  body.set("thumb", new File([PNG], "plate_1.png", { type: "image/png" }));
  const put = await request(`/api/items/${itemId}/files/${uuid()}`, { method: "PUT", body, cookie });
  if (put.status !== 201) throw new Error(await put.text());
}

/** What bridge 0.2 does for a print: a build of its own, then the attempt in it (settings only when it read a file). */
async function bridgePrints(print: Record<string, unknown>, settings?: object) {
  const ownId = uuid();
  const attemptId = uuid();
  await asBridge("/api/items", { method: "POST", json: { id: ownId, title: String(print.name), stage: "building" } });
  const response = await asBridge(`/api/items/${ownId}/attempts`, {
    method: "POST",
    json: { id: attemptId, printedAt: Date.now(), print, ...(settings ? { settings } : {}) },
  });
  expect(response.status).toBe(201);
  return { ownId, attemptId, attempt: (await response.json<AttemptResponse>()).attempt };
}

const move = (attemptId: string, json: Record<string, unknown>) =>
  request(`/api/attempts/${attemptId}/move`, { method: "POST", cookie, json });

const attemptOf = async (id: string, attemptId: string) =>
  (await (await request(`/api/items/${id}`, { cookie })).json<ItemResponse>()).item.attempts.find(
    (one) => one.id === attemptId,
  );

describe("what a printer-made attempt gets from where it is placed", () => {
  it("takes the settings and filaments of the sliced file it matched, by name and plate", async () => {
    const id = await build("Gear");
    await keepFile(id, "gear-plate.3mf", { layerHeight: 0.28 }, 2);
    await keepFile(id, "gear-plate.3mf", SLICED, 1);
    const { attempt } = await bridgePrints({ name: "gear-plate(2)", plate: 1 });
    expect(attempt.itemId).toBe(id);
    expect(attempt.settings).toMatchObject({ layerHeight: 0.2, bedType: "Textured PEI Plate", nozzleTemperature: 220 });
    expect(attempt.settings.filaments?.[0]).toMatchObject({ type: "PLA", colorHex: "#f4f4f0" });
  });

  it("fills what is empty when a person places the print later, never what they set", async () => {
    // Filed before the build holds its file: nothing matches, and the print asks which build it is.
    const { attemptId, attempt } = await bridgePrints({ name: "gear-plate", plate: 1 });
    expect(attempt.settings).toEqual({});
    const id = await build("Gear");
    await keepFile(id, "gear-plate.3mf", SLICED);
    await request(`/api/attempts/${attemptId}`, {
      method: "PATCH",
      cookie,
      json: { settingsMerge: { set: { nozzleTemperature: 250 } } },
    });
    const moved = await move(attemptId, { targetId: id });
    expect(moved.status).toBe(200);
    expect((await attemptOf(id, attemptId))?.settings).toMatchObject({ nozzleTemperature: 250, layerHeight: 0.2 });
  });

  it("takes out what a wrong match put in when the print moves to the right build, and fills from there", async () => {
    const a = await build("Gear");
    await keepFile(a, "gear-plate.3mf", SLICED);
    const b = await build("Gears, the other one");
    await request(`/api/items/${b}/attempts`, {
      method: "POST",
      cookie,
      json: {
        id: uuid(),
        outcome: "success",
        printedAt: Date.now() - 86_400_000,
        settings: { layerHeight: 0.12, filaments: [{ type: "PETG", colorName: "black" }] },
      },
    });
    const { attemptId, attempt } = await bridgePrints({ name: "gear-plate", plate: 1 });
    expect(attempt.itemId).toBe(a);
    expect(attempt.settings).toMatchObject({ layerHeight: 0.2, nozzleTemperature: 220 });

    // Someone changes the bed temperature after the fill: that is theirs, and stays.
    await request(`/api/attempts/${attemptId}`, {
      method: "PATCH",
      cookie,
      json: { settingsMerge: { set: { bedTemperature: 70 } } },
    });
    expect((await move(attemptId, { targetId: b })).status).toBe(200);
    const after = (await attemptOf(b, attemptId))?.settings;
    expect(after).toEqual({ layerHeight: 0.12, filaments: [{ type: "PETG", colorName: "black" }], bedTemperature: 70 });
  });

  it("takes the build's latest attempt's settings when it has no sliced file", async () => {
    const id = await build("Hook");
    const earlier = uuid();
    await request(`/api/items/${id}/attempts`, {
      method: "POST",
      cookie,
      json: {
        id: earlier,
        outcome: "success",
        printedAt: Date.now() - 86_400_000,
        settings: { layerHeight: 0.16, filaments: [{ type: "PETG", grams: 5 }], actualMinutes: 30, weightGrams: 5 },
      },
    });
    const { ownId, attempt } = await bridgePrints({ name: "Hook" }).then(async (made) => {
      const moved = await request(`/api/attempts/${made.attemptId}/move`, {
        method: "POST",
        cookie,
        json: { targetId: id },
      });
      return { ownId: made.ownId, attempt: (await moved.json<AttemptResponse>()).attempt };
    });
    expect(ownId).toBeTruthy();
    expect(attempt.settings).toEqual({ layerHeight: 0.16, filaments: [{ type: "PETG" }] });
  });

  it("copies nothing when there is nothing to copy", async () => {
    const id = await build("Empty");
    const { attemptId } = await bridgePrints({ name: "Mystery" }).then(async (made) => {
      await request(`/api/attempts/${made.attemptId}/move`, { method: "POST", cookie, json: { targetId: id } });
      return made;
    });
    expect((await attemptOf(id, attemptId))?.settings).toEqual({});
  });

  it("never replaces what a person or agent set", async () => {
    const id = await build("Gear");
    await keepFile(id, "gear-plate.3mf", SLICED);
    const { attempt } = await bridgePrints(
      { name: "gear-plate" },
      { layerHeight: 0.12, filaments: [{ type: "PETG" }] },
    );
    expect(attempt.settings).toMatchObject({ layerHeight: 0.12, nozzleTemperature: 220 });
    expect(attempt.settings.filaments).toEqual([{ type: "PETG" }]);
  });

  it("puts the pantry's spool of the active tray on the attempt, and works without a tray", async () => {
    const spoolId = uuid();
    await request("/api/spools", {
      method: "POST",
      cookie,
      json: { id: spoolId, material: "PLA", colorName: "Jade white", colorHex: "#f4f4f0", brand: "Bambu Lab" },
    });
    expect((await request("/api/printer/slots/A2", { method: "PUT", cookie, json: { spoolId } })).status).toBe(200);
    const id = await build("Gear");
    await keepFile(id, "gear-plate.3mf", SLICED);
    const { attempt } = await bridgePrints({ name: "gear-plate", trays: ["A2"] });
    expect(attempt.settings.filaments).toHaveLength(1);
    expect(attempt.settings.filaments?.[0]).toMatchObject({ spoolId, amsSlot: "A2", grams: 7 });

    // A printer-made attempt with no file and no tray (an old bridge): nothing is invented.
    const plain = await bridgePrints({ name: "Something else" });
    expect(plain.attempt.settings).toEqual({});
  });

  it("puts the tray's spool on the filament an earlier attempt copied in, at creation", async () => {
    const [oldSpool, newSpool] = [uuid(), uuid()];
    for (const id of [oldSpool, newSpool]) {
      await request("/api/spools", { method: "POST", cookie, json: { id, material: "PLA", colorHex: "#f4f4f0" } });
    }
    // A build the print matches by its file's name (a file with no choices of its own), whose last attempt names a spool.
    const id = await build("Hook");
    await keepFile(id, "hook.3mf", { estimatedMinutes: 40 });
    await request(`/api/items/${id}/attempts`, {
      method: "POST",
      cookie,
      json: {
        id: uuid(),
        outcome: "success",
        printedAt: Date.now() - 86_400_000,
        settings: { layerHeight: 0.16, filaments: [{ type: "PLA", spoolId: oldSpool, amsSlot: "A3" }] },
      },
    });
    await request("/api/printer/slots/A1", { method: "PUT", cookie, json: { spoolId: newSpool } });
    const { attempt } = await bridgePrints({ name: "hook", trays: ["A1"] });
    expect(attempt.itemId).toBe(id);
    expect(attempt.settings.layerHeight).toBe(0.16);
    expect(attempt.settings.filaments).toEqual([
      expect.objectContaining({ type: "PLA", spoolId: newSpool, amsSlot: "A1" }),
    ]);
  });

  it("takes the trays the bridge reports once the print runs, and leaves a filament a person typed", async () => {
    const spoolId = uuid();
    await request("/api/spools", {
      method: "POST",
      cookie,
      json: { id: spoolId, material: "PLA", colorHex: "#f4f4f0" },
    });
    await request("/api/printer/slots/A2", { method: "PUT", cookie, json: { spoolId } });
    const id = await build("Gear");
    await keepFile(id, "gear-plate.3mf", SLICED);
    const { attemptId } = await bridgePrints({ name: "gear-plate", plate: 1 });
    expect((await attemptOf(id, attemptId))?.settings.filaments?.[0]?.spoolId).toBeUndefined();
    const told = await asBridge(`/api/attempts/${attemptId}`, { method: "PATCH", json: { trays: ["A2"] } });
    expect(told.status).toBe(200);
    expect((await told.json<AttemptResponse>()).attempt.settings.filaments?.[0]).toMatchObject({
      spoolId,
      amsSlot: "A2",
    });

    // A print someone unlinked the spool of and typed their own filament for: placed later, theirs stays.
    const own = await bridgePrints({ name: "other" });
    await asBridge(`/api/attempts/${own.attemptId}`, { method: "PATCH", json: { trays: ["A2"] } });
    await request(`/api/attempts/${own.attemptId}`, {
      method: "PATCH",
      cookie,
      json: { settings: { filaments: [{ type: "PETG", colorName: "black" }] } },
    });
    const there = await build("Last time");
    await request(`/api/items/${there}/attempts`, {
      method: "POST",
      cookie,
      json: { id: uuid(), outcome: "success", printedAt: Date.now() - 86_400_000, settings: { layerHeight: 0.2 } },
    });
    expect((await move(own.attemptId, { targetId: there })).status).toBe(200);
    expect((await attemptOf(there, own.attemptId))?.settings).toEqual({
      layerHeight: 0.2,
      filaments: [{ type: "PETG", colorName: "black" }],
    });
  });

  it("copies nothing from a file of several plates when the plate is unknown, nor the last attempt's keys to a file's", async () => {
    const id = await build("Gear");
    await keepFile(id, "gear-plate.3mf", SLICED, 2);
    const { attempt } = await bridgePrints({ name: "gear-plate" });
    // A file kept as plate 2 of 2: an old bridge doesn't say which plate printed.
    expect(attempt.itemId).toBe(id);
    expect(attempt.settings.layerHeight).toBeUndefined();

    const other = await build("Hook");
    await request(`/api/items/${other}/attempts`, {
      method: "POST",
      cookie,
      json: {
        id: uuid(),
        outcome: "success",
        printedAt: Date.now() - 86_400_000,
        settings: { layerHeight: 0.16, supportType: "tree", brim: true },
      },
    });
    await keepFile(other, "hook.3mf", { estimatedMinutes: 5 });
    // The bridge read the print's own file: its settings are complete, so the last attempt adds nothing to them.
    const read = await bridgePrints({ name: "hook", plate: 1 }, { layerHeight: 0.2, supportEnabled: false });
    expect(read.attempt.itemId).toBe(other);
    expect(read.attempt.settings).toEqual({ layerHeight: 0.2, supportEnabled: false });
    // And still not when the bridge then reports its trays.
    const told = await asBridge(`/api/attempts/${read.attemptId}`, { method: "PATCH", json: { trays: ["A1"] } });
    expect(told.status).toBe(200);
    expect((await attemptOf(other, read.attemptId))?.settings).toEqual({ layerHeight: 0.2, supportEnabled: false });
  });
});
