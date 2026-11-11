/** `spaghetti-bridge run` (the default, and what `pnpm bridge` does): listens to the printer until stopped. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Api } from "./api.ts";
import { Bridge } from "./bridge.ts";
import { ffmpegCamera, firstFrame, jpegStreamCamera } from "./camera.ts";
import { type Config, loadConfig } from "./config.ts";
import { discoverPrinters } from "./discover.ts";
import { readSettings } from "./mac/settings.ts";
import { CertPin } from "./pin.ts";
import { ftpFiles } from "./printer-files.ts";
import { connectToPrinter } from "./printer-link.ts";
import { explainLinkError, Health, silentProblem } from "./problems.ts";
import { Queue } from "./queue.ts";
import { Store } from "./store.ts";
import { PLATFORM, VERSION } from "./version.ts";
import { watchForWake } from "./wake.ts";

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

/** After this many failed connections in a row, look for the printer at a new address. */
const FAILURES_BEFORE_LOOKING = 6;
const LOOK_AGAIN_EVERY_MS = 2 * 60_000;
/** Connected but this long without a single report from the printer. */
const SILENT_AFTER_MS = 60_000;

export function run(argv: readonly string[] = process.argv.slice(2)): void {
  let config: Config;
  try {
    config = loadConfig(process.env, argv);
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const printer = { host: config.printerHost };
  const health = new Health();
  const store = new Store(join(config.dataDir, "state.json"));
  const pin = new CertPin(
    { certs: store.certs, save: () => store.save() },
    { trustNew: config.trustNewCertificate, log },
  );
  // The camera: ffmpeg's stream if ffmpeg is installed, else the printer's own picture stream, else no photo.
  const cameraOptions = {
    accessCode: config.accessCode,
    log,
    pin,
    get host() {
      return printer.host;
    },
  };
  const bridge = new Bridge({
    api: new Api(config.appUrl, config.token),
    store,
    queue: new Queue(join(config.dataDir, "queue")),
    files: ftpFiles({
      get host() {
        return printer.host;
      },
      accessCode: config.accessCode,
      port: config.ftpPort,
      pin,
    }),
    camera: config.camera
      ? firstFrame(ffmpegCamera({ ...cameraOptions, ffmpeg: config.ffmpeg }), jpegStreamCamera(cameraOptions))
      : null,
    printerId: config.serial,
    version: VERSION,
    platform: PLATFORM,
    problems: () => health.list(),
    log,
  });
  log(`Spaghetti printer bridge ${VERSION} (${PLATFORM}): listening to ${printer.host}, telling ${config.appUrl}.`);

  let failures = 0;
  let lastLooked = 0;
  let connectedAt = 0;
  const link = connectToPrinter({
    url: () => (config.mqttUrlGiven ? config.mqttUrl : `mqtts://${printer.host}:8883`),
    serial: config.serial,
    accessCode: config.accessCode,
    onReport: (payload) => {
      bridge.onReport(payload);
      health.set("silent", null);
    },
    onConnection: (connected) => {
      bridge.onConnection(connected);
      if (connected) {
        failures = 0;
        connectedAt = Date.now();
        health.set("link", null);
      } else connectedAt = 0;
    },
    onError: (error) => {
      failures++;
      health.set("link", explainLinkError(error, { host: printer.host, platform: process.platform }));
      void lookForNewAddress();
    },
    log,
    pin,
  });

  /** The printer's address may have changed (the router gave it another one): listen for its announcement. */
  async function lookForNewAddress() {
    if (failures < FAILURES_BEFORE_LOOKING || config.mqttUrlGiven) return;
    if (Date.now() - lastLooked < LOOK_AGAIN_EVERY_MS) return;
    lastLooked = Date.now();
    const found = (await discoverPrinters(8_000, config.serial).catch(() => [])).find(
      (p) => p.serial === config.serial,
    );
    if (!found || found.host === printer.host) return;
    log(`The printer is now at ${found.host} (it was ${printer.host}). Following it.`);
    printer.host = found.host;
    failures = 0;
    try {
      const saved = readSettings(config.file ?? "");
      if (config.file && saved.printerHost) {
        writeFileSync(config.file, `${JSON.stringify({ ...saved, printerHost: found.host }, null, 2)}\n`, {
          mode: 0o600,
        });
      }
    } catch {
      // The new address is used for this run; the file is left as it was.
    }
    link.restart();
  }

  // Connected but the printer says nothing: LAN Only mode or Developer mode is likely off.
  const quietTimer = setInterval(() => {
    if (connectedAt && !bridge.state.complete && Date.now() - connectedAt > SILENT_AFTER_MS) {
      health.set("silent", silentProblem());
    }
  }, 15_000);
  quietTimer.unref?.();

  // After the computer slept the connection is probably dead: connect again and ask for the whole state (pushall).
  const stopWatching = watchForWake((sleptMs) => {
    log(`Woke up after ${Math.round(sleptMs / 60_000)} min. Reconnecting to the printer.`);
    failures = 0;
    link.restart();
    void bridge.sendStatus();
  });

  bridge.start();
  const shutdown = async () => {
    log("Stopping.");
    stopWatching();
    clearInterval(quietTimer);
    await bridge.stop();
    await link.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
