/**
 * pnpm bridge — the optional, read-only printer bridge. Listens to the X2D on the home network and tells Spaghetti
 * when a print starts, how it is going and how it ended, and keeps the AMS slots in step. See docs/bridge.md.
 */
import { join } from "node:path";
import { Api } from "./api.ts";
import { Bridge } from "./bridge.ts";
import { ffmpegCamera } from "./camera.ts";
import { loadConfig } from "./config.ts";
import { CertPin } from "./pin.ts";
import { ftpFiles } from "./printer-files.ts";
import { connectToPrinter } from "./printer-link.ts";
import { Queue } from "./queue.ts";
import { Store } from "./store.ts";

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

try {
  const config = loadConfig();
  const store = new Store(join(config.dataDir, "state.json"));
  const pin = new CertPin(
    { certs: store.certs, save: () => store.save() },
    { trustNew: config.trustNewCertificate, log },
  );
  const bridge = new Bridge({
    api: new Api(config.appUrl, config.token),
    store,
    queue: new Queue(join(config.dataDir, "queue")),
    files: ftpFiles({ host: config.printerHost, accessCode: config.accessCode, pin }),
    camera: config.camera
      ? ffmpegCamera({ host: config.printerHost, accessCode: config.accessCode, ffmpeg: config.ffmpeg, log, pin })
      : null,
    printerId: config.serial,
    log,
  });
  log(`Spaghetti printer bridge: listening to ${config.printerHost}, telling ${config.appUrl}.`);
  const link = connectToPrinter({
    url: config.mqttUrl,
    serial: config.serial,
    accessCode: config.accessCode,
    onReport: (payload) => bridge.onReport(payload),
    onConnection: (connected) => bridge.onConnection(connected),
    log,
    pin,
  });
  bridge.start();
  const shutdown = async () => {
    log("Stopping.");
    await bridge.stop();
    await link.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
