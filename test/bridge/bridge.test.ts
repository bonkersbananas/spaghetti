import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bridge } from "../../bridge/bridge.ts";
import type { Camera } from "../../bridge/camera.ts";
import type { PrinterFiles } from "../../bridge/printer-files.ts";
import { connectToPrinter, type PrinterLink, PUSHALL } from "../../bridge/printer-link.ts";
import { Queue } from "../../bridge/queue.ts";
import { Store } from "../../bridge/store.ts";
import { slicerFile } from "../../e2e/fixtures/slicer-file.ts";
import { FakeApp } from "./fake-app.ts";
import { FakePrinter } from "./fake-printer.ts";
import { amsChanges, cancelledPrint, failedPrint, fullPrint, fullReport, NAME, restartMidPrint } from "./fixtures.ts";

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

let dir: string;
let printer: FakePrinter;
let app: FakeApp;
let links: PrinterLink[] = [];
let bridges: Bridge[] = [];
let ftpCalls: string[];
let fileOnCard: boolean;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "bridge-"));
  printer = await new FakePrinter().start();
  app = new FakeApp();
  ftpCalls = [];
  fileOnCard = true;
});

afterEach(async () => {
  for (const link of links) await link.close();
  for (const bridge of bridges) await bridge.stop();
  links = [];
  bridges = [];
  await printer.stop();
  rmSync(dir, { recursive: true, force: true });
});

const files: PrinterFiles = {
  async find(names) {
    ftpCalls.push(`find ${names.join("|")}`);
    return fileOnCard ? { path: `/${names[0]}`, size: 1 } : null;
  },
  async download(path) {
    ftpCalls.push(`download ${path}`);
    return slicerFile();
  },
};
const camera: Camera = { grab: async () => JPEG };

/** A bridge listening to the fake printer, as `pnpm bridge` wires it. */
function runBridge(options: { camera?: Camera | null } = {}) {
  const bridge = new Bridge({
    api: app.api,
    store: new Store(join(dir, "state.json")),
    queue: new Queue(join(dir, "queue")),
    files,
    camera: options.camera === undefined ? camera : options.camera,
    printerId: printer.serial,
    backoffMs: 5,
    maxBackoffMs: 20,
    amsDelayMs: 10,
    statusEveryMs: 60_000,
  });
  bridges.push(bridge);
  const link = connectToPrinter({
    url: printer.url,
    serial: printer.serial,
    accessCode: printer.accessCode,
    onReport: (payload) => bridge.onReport(payload),
    onConnection: (connected) => bridge.onConnection(connected),
  });
  links.push(link);
  bridge.start();
  return bridge;
}

async function until(check: () => boolean, what: string, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const settle = async (bridge: Bridge) => {
  await bridge.idle();
  await new Promise((resolve) => setTimeout(resolve, 80));
  await bridge.idle();
};

describe("read-only", () => {
  it("publishes exactly one thing in a whole print: the status request pushall", async () => {
    const bridge = runBridge();
    await until(() => printer.published.length > 0, "the status request");
    printer.onFullStatusRequested = () => void printer.replay([fullReport({ state: "IDLE" })]);
    await printer.replay(fullPrint);
    await settle(bridge);
    expect(printer.published).toEqual([{ topic: `device/${printer.serial}/request`, payload: PUSHALL }]);
    expect(JSON.parse(PUSHALL)).toEqual({ pushing: { sequence_id: "0", command: "pushall" } });
    expect(printer.subscribed).toEqual([`device/${printer.serial}/report`]);
    // And the card is only ever listed and read.
    expect(ftpCalls.every((call) => /^(find|download) /.test(call))).toBe(true);
  });

  it("asks again after the printer's link drops and comes back", async () => {
    runBridge();
    await until(() => printer.published.length === 1, "the first request");
    printer.dropClients();
    await until(() => printer.published.length === 2, "a request after reconnecting", 15_000);
    expect(new Set(printer.published.map((message) => message.payload))).toEqual(new Set([PUSHALL]));
  }, 20_000);
});

describe("a print, start to end", () => {
  it("starts a build with the file, follows it, and ends it with a photo and no outcome", async () => {
    const bridge = runBridge();
    await until(() => printer.published.length > 0, "the status request");
    await printer.replay(fullPrint.slice(0, 5));
    await until(
      () => app.items.size === 1 && [...app.items.values()][0]?.attempts[0]?.file != null,
      "the file attached",
    );
    const item = [...app.items.values()][0] as NonNullable<ReturnType<typeof app.items.get>>;
    expect(item.title).toBe("bracket v2");
    const attempt = item.attempts[0]!;
    expect(String(app.files.get(attempt.id)?.get("name"))).toBe(`${NAME}.gcode.3mf`);
    expect(JSON.parse(String(app.files.get(attempt.id)?.get("prefill")))).toMatchObject({
      estimatedMinutes: expect.any(Number),
    });

    // Progress goes to the app at most once a minute, with the layer and the minutes left.
    await until(() => bridge.state.print.mc_percent === 53, "the report at 53%");
    await bridge.sendStatus();
    expect(app.statuses.at(-1)).toMatchObject({
      printerState: "printing",
      progress: { attemptId: attempt.id, percent: 53, remainingMinutes: 42, layer: 128, totalLayers: 240 },
    });

    await printer.replay(fullPrint.slice(5));
    await until(() => attempt.endedAt !== null && app.photos.length === 1, "the end and the photo");
    expect(attempt.outcome).toBeNull();
    expect(attempt.suggestedFailureTag).toBeNull();
    expect(attempt.settings.actualMinutes).toBeGreaterThanOrEqual(1);
    const photo = app.photos[0]!;
    expect(photo.form.get("needsResize")).toBe("1");
    expect(photo.form.get("attemptId")).toBe(attempt.id);
    expect(photo.form.get("width")).toBe("1280");
    expect(app.statuses.at(-1)).toMatchObject({ progress: null });
  });

  it("sends the calls in order: build, attempt, file, then end, then photo", async () => {
    const bridge = runBridge();
    await until(() => printer.published.length > 0, "the status request");
    await printer.replay(fullPrint);
    await until(() => app.photos.length === 1, "the photo");
    await settle(bridge);
    const order = app.calls
      .map((call) => call.call)
      .filter((call) => ["createItem", "createAttempt", "putFile", "updateAttempt", "putPhoto"].includes(call));
    expect(order).toEqual(["createItem", "createAttempt", "putFile", "updateAttempt", "putPhoto"]);
  });

  it("suggests spaghetti for a print the AI saw failing, without setting an outcome", async () => {
    runBridge();
    await until(() => printer.published.length > 0, "the status request");
    await printer.replay(failedPrint);
    await until(() => [...app.items.values()][0]?.attempts[0]?.endedAt != null, "the end");
    expect([...app.items.values()][0]?.attempts[0]).toMatchObject({ outcome: null, suggestedFailureTag: "spaghetti" });
  });

  it("goes on without the file or the photo when the card or camera has none", async () => {
    fileOnCard = false;
    runBridge({ camera: { grab: async () => null } });
    await until(() => printer.published.length > 0, "the status request");
    await printer.replay(fullPrint);
    await until(() => [...app.items.values()][0]?.attempts[0]?.endedAt != null, "the end");
    expect(app.photos).toHaveLength(0);
    expect(app.files.size).toBe(0);
  });
});

describe("choosing the attempt", () => {
  it("attaches to an attempt a person started by hand that is still printing and has no file", async () => {
    const build = app.addBuild("Bracket", [{ printedAt: Date.now() - 5 * 60_000 }]);
    const mine = build.attempts[0]!;
    runBridge();
    await until(() => printer.published.length > 0, "the status request");
    await printer.replay(fullPrint.slice(0, 4));
    await until(() => mine.file != null, "the file on their attempt");
    expect(app.items.size).toBe(1);
    expect(build.attempts).toHaveLength(1);
  });

  it("starts the next attempt on an open build whose latest attempt used a file with the same name", async () => {
    const build = app.addBuild("Bracket", [
      {
        printedAt: Date.now() - 86_400_000,
        outcome: "failed",
        file: { id: "f", name: `${NAME}.gcode.3mf` } as never,
        settings: { layerHeight: 0.16 },
      },
    ]);
    runBridge();
    await until(() => printer.published.length > 0, "the status request");
    await printer.replay(fullPrint.slice(0, 4));
    await until(
      () => build.attempts.length === 2 && build.attempts[1]?.file != null,
      "the second attempt with its file",
    );
    expect(app.items.size).toBe(1);
    expect(build.attempts[1]?.settings).toMatchObject({ layerHeight: 0.16 });
  });

  it("makes a new build when nothing fits", async () => {
    app.addBuild("Other", [
      {
        printedAt: Date.now() - 86_400_000,
        outcome: "success",
        file: { id: "f", name: "something-else.gcode.3mf" } as never,
      },
    ]);
    runBridge();
    await until(() => printer.published.length > 0, "the status request");
    await printer.replay(fullPrint.slice(0, 4));
    await until(() => app.items.size === 2, "a second build");
  });
});

describe("restarts and an unreachable app", () => {
  it("queues while the app is down, then sends in order once it is back", async () => {
    app.down = true;
    const bridge = runBridge();
    await until(() => printer.published.length > 0, "the status request");
    await printer.replay(fullPrint);
    await settle(bridge);
    expect(app.items.size).toBe(0);
    expect(new Queue(join(dir, "queue")).size).toBeGreaterThanOrEqual(3);
    app.down = false;
    await until(() => app.photos.length === 1, "everything sent");
    const attempt = [...app.items.values()][0]!.attempts[0]!;
    expect(attempt.endedAt).not.toBeNull();
    const order = app.calls
      .map((call) => call.call)
      .filter((call) => ["createItem", "putFile", "updateAttempt", "putPhoto"].includes(call));
    expect(order.slice(-4)).toEqual(["createItem", "putFile", "updateAttempt", "putPhoto"]);
    await until(() => new Queue(join(dir, "queue")).size === 0, "an empty queue");
  });

  it("sets a job aside when the app refuses it for good, and goes on with the next", async () => {
    app.refuse = { call: "putFile", status: 400 };
    const bridge = runBridge();
    await until(() => printer.published.length > 0, "the status request");
    await printer.replay(fullPrint);
    await until(() => app.photos.length === 1, "the photo behind the refused job");
    await settle(bridge);
    expect([...app.items.values()][0]?.attempts[0]?.endedAt).not.toBeNull();
  });

  it("doesn't start the print again after a restart in the middle of it", async () => {
    const first = runBridge();
    await until(() => printer.published.length > 0, "the status request");
    await printer.replay(fullPrint.slice(0, 4));
    await until(() => [...app.items.values()][0]?.attempts[0]?.file != null, "the file");
    await settle(first);
    await first.stop();
    for (const link of links) await link.close();
    links = [];

    const second = runBridge();
    await until(() => printer.published.length >= 2, "the second status request");
    await printer.replay(restartMidPrint);
    await until(() => [...app.items.values()][0]?.attempts[0]?.endedAt != null, "the end");
    await settle(second);
    expect(app.items.size).toBe(1);
    expect([...app.items.values()][0]?.attempts).toHaveLength(1);
    expect(app.calls.filter((call) => call.call === "createAttempt")).toHaveLength(1);
  });

  it("falls quiet about progress when the printer can't be reached", async () => {
    const bridge = runBridge();
    await until(() => printer.published.length > 0, "the status request");
    await printer.replay(fullPrint.slice(0, 4));
    await settle(bridge);
    bridge.onConnection(false);
    expect(bridge.statusBody()).toEqual({ printerState: "offline", progress: null });
  });
});

describe("the AMS", () => {
  it("syncs the trays once the printer's full report arrives, and again when they change", async () => {
    const bridge = runBridge();
    await until(() => printer.published.length > 0, "the status request");
    await printer.replay(amsChanges.slice(0, 1));
    await until(() => app.spools.length === 2, "two Bambu spools made");
    await settle(bridge);
    expect(app.slots).toMatchObject({ A1: expect.any(String), A2: expect.any(String) });
    expect(app.statuses.at(-1)).toMatchObject({
      unknownTrays: [{ slot: "A3", material: "PLA", colorHex: "#c12e1f", brand: null }],
    });
    // A level is set from `remain` where it is known: A2's 40% is half.
    expect(app.spools.find((spool) => spool.trayUuid === "AAAA0000AAAA0000AAAA0000AAAA0002")).toMatchObject({
      remaining: "half",
    });

    await printer.replay(amsChanges.slice(1));
    await until(() => app.spools.length === 3, "the new Bambu spool in A4");
    await settle(bridge);
    expect(app.statuses.at(-1)).toMatchObject({ unknownTrays: [{ slot: "A3", material: "PETG" }] });
  });
});

describe("a cancelled print", () => {
  it("suggests 'other' as a failure tag, not a verdict", async () => {
    runBridge();
    await until(() => printer.published.length > 0, "the status request");
    await printer.replay(cancelledPrint);
    await until(() => [...app.items.values()][0]?.attempts[0]?.endedAt != null, "the end");
    expect([...app.items.values()][0]?.attempts[0]).toMatchObject({ outcome: null, suggestedFailureTag: "other" });
  });
});
