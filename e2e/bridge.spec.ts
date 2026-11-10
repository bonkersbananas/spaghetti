import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { Api } from "../bridge/api.ts";
import { Bridge } from "../bridge/bridge.ts";
import type { PrinterFiles } from "../bridge/printer-files.ts";
import { connectToPrinter } from "../bridge/printer-link.ts";
import { Queue } from "../bridge/queue.ts";
import { Store } from "../bridge/store.ts";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";
import { FakePrinter } from "../test/bridge/fake-printer.ts";
import { fullPrint, NAME } from "../test/bridge/fixtures.ts";
import { slicerFile } from "./fixtures/slicer-file.ts";

// The bridge never touches the screen: one run is enough, whatever the viewport.
test.skip(({ isMobile }) => isMobile, "no screen involved");

const JPEG = Uint8Array.from([
  0xff,
  0xd8,
  0xff,
  0xc0,
  0,
  17,
  8,
  0x03,
  0x84,
  0x05,
  0x00,
  3,
  1,
  0x22,
  0,
  2,
  0x11,
  1,
  3,
  0x11,
  1,
  ...new Array(2000).fill(7),
  0xff,
  0xd9,
]);

test("a print from the printer to the journal: attached file, progress, end, photo, no outcome until a person says", async ({
  request,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const origin = { Origin: baseURL as string };
  const signIn = await request.post("/api/session", {
    headers: origin,
    data: { username: SEED_USERS[0].username, password: SEED_PASSWORD },
  });
  expect(signIn.ok()).toBe(true);
  const made = await request.post("/api/agents", {
    headers: origin,
    data: { name: `Printer bridge ${Date.now() % 100_000}`, scopes: ["read", "attempts", "printer"] },
  });
  const { token, agent } = await made.json();

  const dir = mkdtempSync(join(tmpdir(), "bridge-e2e-"));
  const printer = await new FakePrinter().start();
  const files: PrinterFiles = {
    find: async (names) => ({ path: `/${names[0]}`, size: 1 }),
    download: async () => slicerFile(),
  };
  const bridge = new Bridge({
    api: new Api(baseURL as string, token),
    store: new Store(join(dir, "state.json")),
    queue: new Queue(join(dir, "queue")),
    files,
    camera: { grab: async () => JPEG },
    printerId: printer.serial,
    backoffMs: 20,
    amsDelayMs: 20,
  });
  const link = connectToPrinter({
    url: printer.url,
    serial: printer.serial,
    accessCode: printer.accessCode,
    onReport: (payload) => bridge.onReport(payload),
    onConnection: (connected) => bridge.onConnection(connected),
  });
  bridge.start();

  try {
    await expect.poll(() => printer.published.length).toBe(1);
    // The printer's AMS: two Bambu spools become spools in slots A1 and A2; the third-party one in A3 is reported.
    await printer.replay(fullPrint.slice(0, 5));
    await expect.poll(async () => (await (await request.get("/api/printer")).json()).slots.A1).toBeTruthy();

    const builds = async () => (await (await request.get("/api/items?stage=building")).json()).items;
    await expect
      .poll(
        async () =>
          (await builds()).find((item: { title: string }) => item.title === "bracket v2")?.attempts[0]?.file?.name,
      )
      .toBe(`${NAME}.gcode.3mf`);
    const item = (await builds()).find((candidate: { title: string }) => candidate.title === "bracket v2");
    const attempt = item.attempts[0];
    expect(attempt.createdVia).toBe(agent.id);
    expect(attempt.outcome).toBeNull();
    expect(attempt.file.plate).toBe(1);
    expect(attempt.file.hasThumb).toBe(true);

    // Progress, as the printer reports it.
    await expect.poll(() => bridge.state.print.mc_percent).toBe(53);
    await bridge.sendStatus();
    const printing = await (await request.get("/api/printer")).json();
    expect(printing.bridge.progress).toMatchObject({
      attemptId: attempt.id,
      percent: 53,
      layer: 128,
      totalLayers: 240,
      remainingMinutes: 42,
    });
    expect(printing.bridge.unknownTrays).toEqual([expect.objectContaining({ slot: "A3", material: "PLA" })]);

    // The end: when and how long, a photo, and no outcome.
    await printer.replay(fullPrint.slice(5));
    const ended = async () =>
      (await (await request.get(`/api/items/${item.id}`)).json()).item as {
        attempts: Array<{
          endedAt: number | null;
          outcome: string | null;
          settings: { actualMinutes?: number };
          suggestedFailureTag: string | null;
        }>;
        photos: Array<{ attemptId: string | null; needsResize: boolean }>;
      };
    await expect.poll(async () => (await ended()).attempts[0]?.endedAt).not.toBeNull();
    await expect.poll(async () => (await ended()).photos.length).toBe(1);
    const after = await ended();
    expect(after.attempts[0]).toMatchObject({ outcome: null, suggestedFailureTag: null });
    expect(after.attempts[0]?.settings.actualMinutes).toBeGreaterThanOrEqual(1);
    expect(after.photos[0]).toMatchObject({ attemptId: attempt.id, needsResize: true });

    // A person decides how it went: the outcome is theirs, and the attempt still says it came via the bridge.
    const finished = await request.post(`/api/attempts/${attempt.id}/finish`, {
      headers: origin,
      data: { outcome: "success" },
    });
    expect((await finished.json()).attempt).toMatchObject({
      outcome: "success",
      finishedVia: null,
      createdVia: agent.id,
    });
    const named = await (await request.get("/api/agents")).json();
    expect(named.agents.find((candidate: { id: string }) => candidate.id === agent.id).name).toContain(
      "Printer bridge",
    );
  } finally {
    await link.close();
    await bridge.stop();
    await printer.stop();
    rmSync(dir, { recursive: true, force: true });
    // Leave no working token or build behind.
    const { agents } = await (await request.get("/api/agents")).json();
    for (const candidate of agents)
      for (const t of candidate.tokens)
        await request.delete(`/api/agents/${candidate.id}/tokens/${t.id}`, { headers: origin });
    const { items } = await (await request.get("/api/items?stage=idea,building,done,shelved")).json();
    for (const leftover of items) await request.delete(`/api/items/${leftover.id}`, { headers: origin });
  }
});

test("the bridge gets in touch before anything is printing", async ({ request, baseURL }) => {
  const origin = { Origin: baseURL as string };
  await request.post("/api/session", {
    headers: origin,
    data: { username: SEED_USERS[0].username, password: SEED_PASSWORD },
  });
  const made = await request.post("/api/agents", {
    headers: origin,
    data: { name: `Quiet bridge ${Date.now() % 100_000}`, scopes: ["read", "printer"] },
  });
  const { token } = await made.json();
  const response = await new Api(baseURL as string, token).tell({ printerState: "idle", progress: null });
  expect(response.bridge?.printerState).toBe("idle");
  const { agents } = await (await request.get("/api/agents")).json();
  for (const candidate of agents)
    for (const t of candidate.tokens)
      await request.delete(`/api/agents/${candidate.id}/tokens/${t.id}`, { headers: origin });
});
