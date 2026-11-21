/**
 * `spaghetti-bridge check` against the stand-in printer: one line per channel, so that one run on a real printer
 * (in cloud mode or LAN Only) says what works there.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CheckLine,
  type CheckOptions,
  checkPrinter,
  describeCheck,
  WITHOUT_FILES,
} from "../../bridge/mac/check.ts";
import { CertPin } from "../../bridge/pin.ts";
import { ftpFiles, type PrinterFiles } from "../../bridge/printer-files.ts";
import { selfSigned } from "./certificate.ts";
import { FakeFtps } from "./fake-ftps.ts";
import { FakePrinter } from "./fake-printer.ts";
import { delta, fullReport } from "./fixtures.ts";

const JPEG = Uint8Array.from([0xff, 0xd8, ...new Array(2000).fill(7), 0xff, 0xd9]);

let dir: string;
let printer: FakePrinter;
let ftps: FakeFtps;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "bridge-check-"));
  printer = await new FakePrinter().start();
  ftps = await new FakeFtps(printer.accessCode).start(selfSigned(printer.serial));
});
afterEach(async () => {
  await printer.stop();
  await ftps.stop();
  rmSync(dir, { recursive: true, force: true });
});

const card = (): PrinterFiles =>
  ftpFiles({
    host: "127.0.0.1",
    port: ftps.port,
    accessCode: printer.accessCode,
    pin: new CertPin({ certs: {}, save() {} }),
  });

const check = (options: Partial<CheckOptions> = {}) =>
  checkPrinter({
    host: "127.0.0.1",
    serial: printer.serial,
    accessCode: printer.accessCode,
    dataDir: dir,
    mqttUrl: printer.url,
    timeoutMs: 3_000,
    files: card(),
    cameras: [{ name: "the camera stream (RTSPS, port 322, through ffmpeg)", camera: { grab: async () => JPEG } }],
    ...options,
  });

const line = (lines: CheckLine[], channel: CheckLine["channel"]) => lines.find((one) => one.channel === channel);

describe("spaghetti-bridge check", () => {
  it("says each channel works, when it does", async () => {
    printer.onFullStatusRequested = () => void printer.replay([fullReport({ state: "IDLE" })]);
    ftps.files.set("/bracket.gcode.3mf", Uint8Array.from([1]));
    const result = await check();
    expect(result.ok).toBe(true);
    expect(result.lines.map((one) => [one.channel, one.status])).toEqual([
      ["login", "ok"],
      ["reports", "ok"],
      ["pushall", "ok"],
      ["files", "ok"],
      ["camera", "ok"],
    ]);
    expect(describeCheck(result)[3]).toBe(
      "✓ Files (FTPS, port 990): can list and read the printer's USB drive (1 in /). A print's file is kept there only with Store Sent Files on External Storage on.",
    );
    // Read-only here too: one pushall, and the card only listed.
    expect(printer.published).toHaveLength(1);
    for (const verb of ["STOR", "DELE", "RNFR", "RNTO", "MKD", "RMD", "APPE", "RETR"])
      expect(ftps.commands).not.toContain(verb);
  });

  it("says when the printer answers pushall with an error, and that the bridge still works from the reports", async () => {
    printer.refusePushall = "error";
    setTimeout(() => void printer.replay([fullReport({ state: "IDLE" })]), 200);
    const result = await check();
    expect(result.ok).toBe(true);
    expect(line(result.lines, "pushall")).toMatchObject({ status: "partly" });
    expect(line(result.lines, "pushall")?.text).toMatch(/refused it \(it answered with an error\)/);
    expect(line(result.lines, "reports")?.status).toBe("ok");
  });

  it("says when the printer drops the connection after pushall, and stops asking", async () => {
    printer.refusePushall = "drop";
    const reportsAfterReconnect = setInterval(() => {
      if (printer.subscribed.length >= 3) void printer.replay([fullReport({ state: "IDLE" })]);
    }, 200);
    const result = await check({ timeoutMs: 20_000 });
    clearInterval(reportsAfterReconnect);
    expect(result.ok).toBe(true);
    expect(line(result.lines, "pushall")?.text).toMatch(/dropped the connection right after it/);
    expect(printer.published).toHaveLength(2);
  }, 30_000);

  it("says when only parts of the state come, without failing", async () => {
    printer.onFullStatusRequested = () => void printer.replay([delta({ mc_percent: 3 })]);
    const result = await check({ timeoutMs: 1_500 });
    expect(result.ok).toBe(true);
    expect(line(result.lines, "pushall")).toMatchObject({ status: "partly" });
    expect(line(result.lines, "pushall")?.text).toMatch(/no whole state in 2 s, only parts/);
  });

  it("fails on a wrong access code, and says so on the link's line", async () => {
    const result = await check({
      accessCode: "wrong123",
      files: { find: async () => null, download: async () => new Uint8Array() },
    });
    expect(result.ok).toBe(false);
    expect(line(result.lines, "login")).toMatchObject({ status: "no" });
    expect(line(result.lines, "login")?.text).toMatch(/refused the access code/);
    expect(line(result.lines, "reports")?.status).toBe("skipped");
  });

  it("says plainly what no card costs, and how to have it, without failing", async () => {
    printer.onFullStatusRequested = () => void printer.replay([fullReport({ state: "IDLE" })]);
    const result = await check();
    expect(result.ok).toBe(true);
    expect(line(result.lines, "files")).toMatchObject({ status: "partly" });
    expect(line(result.lines, "files")?.text).toContain("is empty or not in the printer");
    expect(line(result.lines, "files")?.text).toContain(WITHOUT_FILES);
    expect(WITHOUT_FILES).toMatch(/no plate picture, filament and grams, settings or 3D view/);
    expect(WITHOUT_FILES).toMatch(/Store Sent Files on External Storage/);
  });

  it("says when the file service doesn't answer at all", async () => {
    printer.onFullStatusRequested = () => void printer.replay([fullReport({ state: "IDLE" })]);
    const closed = ftpFiles({ host: "127.0.0.1", port: 1, accessCode: printer.accessCode });
    const result = await check({ files: closed });
    expect(result.ok).toBe(true);
    expect(line(result.lines, "files")).toMatchObject({ status: "no" });
    expect(line(result.lines, "files")?.text).toContain("didn't answer");
  });

  it("points to LAN Only Liveview when no camera gives a frame, and skips the camera when it's off", async () => {
    printer.onFullStatusRequested = () => void printer.replay([fullReport({ state: "IDLE" })]);
    const none = await check({ cameras: [{ name: "x", camera: { grab: async () => null } }] });
    expect(line(none.lines, "camera")).toMatchObject({ status: "partly" });
    expect(line(none.lines, "camera")?.text).toMatch(/LAN Only Liveview/);
    const off = await check({ camera: "off" });
    expect(line(off.lines, "camera")).toMatchObject({ status: "skipped" });
  });
});
