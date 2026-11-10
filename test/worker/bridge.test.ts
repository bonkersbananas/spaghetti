import { beforeEach, describe, expect, it } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type {
  AttemptResponse,
  ItemResponse,
  PrinterResponse,
  SpoolResponse,
  SpoolsResponse,
} from "../../src/shared/api.ts";
import type { ChangesResponse } from "../../src/shared/changes.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;
let token: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
  const made = await request("/api/agents", {
    method: "POST",
    json: { name: "Printer bridge", scopes: ["read", "attempts", "printer"] },
    cookie,
  });
  token = (await made.json<NewTokenResponse>()).token;
});

const uuid = () => crypto.randomUUID();
const asBridge = (path: string, init: RequestInit & { json?: unknown } = {}) =>
  request(path, { ...init, headers: { Authorization: `Bearer ${token}`, Origin: "http://printer.test" } });

/** A build with one attempt the bridge started, the way it does it: scopes read, attempts, printer only. */
async function startPrint() {
  const itemId = uuid();
  const attemptId = uuid();
  expect((await asBridge("/api/items", { method: "POST", json: { id: itemId, stage: "building" } })).status).toBe(201);
  const response = await asBridge(`/api/items/${itemId}/attempts`, {
    method: "POST",
    json: { id: attemptId, settings: { estimatedMinutes: 90 } },
  });
  expect(response.status).toBe(201);
  return { itemId, attemptId, attempt: (await response.json<AttemptResponse>()).attempt };
}

describe("the printer bridge's attempts", () => {
  it("starts a build and an attempt with only read, attempts and printer, made via the agent", async () => {
    const { itemId, attempt } = await startPrint();
    expect(attempt).toMatchObject({
      outcome: null,
      endedAt: null,
      suggestedFailureTag: null,
      createdVia: expect.any(String),
    });
    const item = (await (await request(`/api/items/${itemId}`, { cookie })).json<ItemResponse>()).item;
    expect(item.stage).toBe("building");
  });

  it("records when the print ended and a suggested tag without setting an outcome", async () => {
    const { attemptId } = await startPrint();
    const endedAt = Date.now() - 1000;
    const response = await asBridge(`/api/attempts/${attemptId}`, {
      method: "PATCH",
      json: { endedAt, suggestedFailureTag: "spaghetti", settings: { estimatedMinutes: 90, actualMinutes: 84 } },
    });
    expect(response.status).toBe(200);
    const { attempt } = await response.json<AttemptResponse>();
    expect(attempt).toMatchObject({
      outcome: null,
      finishedAt: null,
      endedAt,
      suggestedFailureTag: "spaghetti",
      failureTags: [],
    });
    expect(attempt.settings.actualMinutes).toBe(84);

    // A person then says how it went.
    const finished = await request(`/api/attempts/${attemptId}/finish`, {
      method: "POST",
      json: { outcome: "failed", failureTags: ["spaghetti"] },
      cookie,
    });
    expect((await finished.json<AttemptResponse & { finished: boolean }>()).attempt).toMatchObject({
      outcome: "failed",
      endedAt,
      suggestedFailureTag: "spaghetti",
      finishedVia: null,
    });
  });

  it("never lets the end be in the future, and clears with null", async () => {
    const { attemptId } = await startPrint();
    const soon = Date.now() + 3_600_000;
    const { attempt } = await (
      await asBridge(`/api/attempts/${attemptId}`, { method: "PATCH", json: { endedAt: soon } })
    ).json<AttemptResponse>();
    expect(attempt.endedAt).toBeLessThanOrEqual(Date.now());
    const cleared = await (
      await asBridge(`/api/attempts/${attemptId}`, {
        method: "PATCH",
        json: { endedAt: null, suggestedFailureTag: null },
      })
    ).json<AttemptResponse>();
    expect(cleared.attempt).toMatchObject({ endedAt: null, suggestedFailureTag: null });
  });

  it("refuses a suggested tag that isn't a slug", async () => {
    const { attemptId } = await startPrint();
    const response = await asBridge(`/api/attempts/${attemptId}`, {
      method: "PATCH",
      json: { suggestedFailureTag: "Not A Slug" },
    });
    expect(response.status).toBe(400);
  });
});

describe("PUT /api/printer/bridge", () => {
  it("has no bridge until one speaks", async () => {
    expect((await (await request("/api/printer", { cookie })).json<PrinterResponse>()).bridge).toBeNull();
  });

  it("keeps progress for an attempt, stamped by the server, and shows it on the printer", async () => {
    const { attemptId } = await startPrint();
    const before = Date.now();
    const response = await asBridge("/api/printer/bridge", {
      method: "PUT",
      json: {
        printerState: "printing",
        progress: { attemptId, percent: 46.6, remainingMinutes: 38, layer: 112, totalLayers: 240 },
      },
    });
    expect(response.status).toBe(200);
    const printer = await response.json<PrinterResponse>();
    expect(printer.bridge?.printerState).toBe("printing");
    expect(printer.bridge?.progress).toMatchObject({
      attemptId,
      percent: 47,
      remainingMinutes: 38,
      layer: 112,
      totalLayers: 240,
    });
    expect(printer.bridge?.progress?.at).toBeGreaterThanOrEqual(before);
    expect(printer.bridge?.lastSeenAt).toBeGreaterThanOrEqual(before);
  });

  it("leaves out what isn't sent, and null progress says nothing is printing", async () => {
    const { attemptId } = await startPrint();
    await asBridge("/api/printer/bridge", {
      method: "PUT",
      json: {
        progress: { attemptId, percent: 10 },
        unknownTrays: [{ slot: "A3", material: "PLA", colorHex: "#FF0000", brand: null }],
      },
    });
    const heartbeat = await (
      await asBridge("/api/printer/bridge", { method: "PUT", json: {} })
    ).json<PrinterResponse>();
    expect(heartbeat.bridge?.progress?.percent).toBe(10);
    expect(heartbeat.bridge?.unknownTrays).toEqual([{ slot: "A3", material: "PLA", colorHex: "#ff0000", brand: null }]);
    const done = await (
      await asBridge("/api/printer/bridge", { method: "PUT", json: { progress: null, unknownTrays: [] } })
    ).json<PrinterResponse>();
    expect(done.bridge).toMatchObject({ progress: null, unknownTrays: [] });
  });

  it("drops progress for an attempt that isn't there, and rejects bad slots and percentages", async () => {
    const response = await asBridge("/api/printer/bridge", {
      method: "PUT",
      json: { progress: { attemptId: uuid(), percent: 50 } },
    });
    expect((await response.json<PrinterResponse>()).bridge?.progress).toBeNull();
    for (const json of [
      { progress: { attemptId: uuid(), percent: 101 } },
      { unknownTrays: [{ slot: "Z9", material: null, colorHex: null, brand: null }] },
      { printerState: "melting" },
    ]) {
      expect((await asBridge("/api/printer/bridge", { method: "PUT", json })).status).toBe(400);
    }
  });

  it("records a change only when what it says changes, never for a heartbeat", async () => {
    const { attemptId } = await startPrint();
    const feedEnd = async () => (await (await request("/api/changes", { cookie })).json<ChangesResponse>()).cursor;
    const progress = { attemptId, percent: 20 };
    await asBridge("/api/printer/bridge", { method: "PUT", json: { progress } });
    const first = await feedEnd();
    await asBridge("/api/printer/bridge", { method: "PUT", json: {} });
    await asBridge("/api/printer/bridge", { method: "PUT", json: { progress } });
    expect(await feedEnd()).toBe(first);
    await asBridge("/api/printer/bridge", { method: "PUT", json: { progress: { attemptId, percent: 21 } } });
    expect(await feedEnd()).toBe(first + 1);
    const changes = await (await request(`/api/changes?after=${first}`, { cookie })).json<ChangesResponse>();
    expect(changes.changes[0]).toMatchObject({
      entity: "printer",
      id: "bridge",
      actor: { kind: "agent" },
    });
  });

  it("is closed to tokens without the printer scope", async () => {
    const made = await request("/api/agents", {
      method: "POST",
      json: { name: "Reader", scopes: ["read", "attempts"] },
      cookie,
    });
    const reader = (await made.json<NewTokenResponse>()).token;
    const response = await request("/api/printer/bridge", {
      method: "PUT",
      json: {},
      headers: { Authorization: `Bearer ${reader}` },
    });
    expect(response.status).toBe(403);
  });
});

describe("spools and the AMS tray UUID", () => {
  it("stores a tray UUID on a spool made by the bridge and finds it in the list", async () => {
    const id = uuid();
    const trayUuid = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
    const created = await asBridge("/api/spools", {
      method: "POST",
      json: { id, material: "PLA", brand: "Bambu Lab", colorHex: "#0086d6", remaining: "half", trayUuid },
    });
    expect(created.status).toBe(201);
    expect((await created.json<SpoolResponse>()).spool.trayUuid).toBe(trayUuid);
    const list = await (await asBridge("/api/spools")).json<SpoolsResponse>();
    expect(list.spools.find((spool) => spool.id === id)?.trayUuid).toBe(trayUuid);
  });

  it("sets a spool's level and a tray UUID with a PATCH, and loads it into a slot", async () => {
    const id = uuid();
    await asBridge("/api/spools", { method: "POST", json: { id, material: "PETG" } });
    const patched = await asBridge(`/api/spools/${id}`, {
      method: "PATCH",
      json: { remaining: "low", trayUuid: "00000000000000000000000000000001" },
    });
    expect((await patched.json<SpoolResponse>()).spool).toMatchObject({ remaining: "low" });
    const slot = await asBridge("/api/printer/slots/A3", { method: "PUT", json: { spoolId: id } });
    expect((await slot.json<PrinterResponse>()).slots.A3).toBe(id);
  });
});
