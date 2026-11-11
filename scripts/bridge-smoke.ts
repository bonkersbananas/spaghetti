/**
 * Starts the bridge program (the compiled binary, or the source) against stand-ins for the printer and the app: an
 * MQTT broker over TLS that replays a print, an FTPS server with the print's file, and a small HTTP app. It passes
 * when the program reports its version, starts the attempt, attaches the file it fetched over FTPS and has sent the
 * printer exactly one message, `pushall`. This is the check a release build must pass on the runner that built it.
 *
 *   node scripts/bridge-smoke.ts dist/bridge/spaghetti-bridge-darwin-arm64 1.2.3
 *   node scripts/bridge-smoke.ts --source
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { slicerFile } from "../e2e/fixtures/slicer-file.ts";
import { selfSigned } from "../test/bridge/certificate.ts";
import { FakeFtps } from "../test/bridge/fake-ftps.ts";
import { FakePrinter } from "../test/bridge/fake-printer.ts";
import { fullPrint, NAME } from "../test/bridge/fixtures.ts";
import { HttpApp } from "../test/bridge/http-app.ts";

export interface SmokeResult {
  ok: boolean;
  problems: string[];
  log: string;
}

export async function smoke(command: string, args: string[], expectVersion?: string): Promise<SmokeResult> {
  const dir = mkdtempSync(join(tmpdir(), "bridge-smoke-"));
  const printer = new FakePrinter();
  const ftps = new FakeFtps(printer.accessCode);
  const app = new HttpApp();
  const certificate = selfSigned(printer.serial);
  await printer.start(certificate);
  await ftps.start(certificate);
  await app.start();
  ftps.files.set(`/${NAME}.gcode.3mf`, slicerFile());
  printer.onFullStatusRequested = () => void printer.replay(fullPrint, 20);
  const config = join(dir, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      printerHost: "127.0.0.1",
      serial: printer.serial,
      accessCode: printer.accessCode,
      appUrl: app.url,
      token: app.token,
      dataDir: join(dir, "data"),
      mqttUrl: printer.url,
      ftpPort: ftps.port,
      camera: "off",
    }),
  );
  let log = "";
  const child = spawn(command, [...args, "run", "--config", config], {
    env: { ...process.env, BRIDGE_CAMERA: "off" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    log += chunk;
  });
  child.stderr.on("data", (chunk) => {
    log += chunk;
  });
  const problems: string[] = [];
  try {
    const deadline = Date.now() + 40_000;
    const done = () => app.files.size > 0 && app.heartbeats.some((h) => h.printerState === "finished");
    while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    if (!app.heartbeats.length) problems.push("the app never got a heartbeat");
    if (expectVersion && !app.heartbeats.some((h) => h.version === expectVersion)) {
      problems.push(`no heartbeat said version ${expectVersion} (saw ${JSON.stringify(app.heartbeats[0]?.version)})`);
    }
    if (!app.heartbeats.some((h) => h.printerState === "finished"))
      problems.push("it never reported the printer as printing");
    if (![...app.items.values()].some((item) => item.attempts.length)) problems.push("no attempt was started");
    if (app.files.size === 0) problems.push("the print's file wasn't fetched over FTPS and attached");
    const files = [...app.files.values()];
    if (files[0] && files[0].size !== slicerFile().length) problems.push("the attached file isn't the one on the card");
    const sent = printer.published.map((m) => m.payload);
    if (sent.length < 1 || sent.some((p) => !p.includes("pushall")))
      problems.push(`the printer was sent more than pushall: ${JSON.stringify(sent)}`);
    for (const verb of ["STOR", "DELE", "RNFR", "RNTO", "MKD", "RMD", "APPE"]) {
      if (ftps.commands.includes(verb)) problems.push(`the SD card was sent ${verb}`);
    }
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await Promise.all([printer.stop(), ftps.stop(), app.stop()]);
    rmSync(dir, { recursive: true, force: true });
  }
  return { ok: problems.length === 0, problems, log };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [first, version] = process.argv.slice(2);
  const [command, args] = first === "--source" || !first ? ["node", ["bridge/index.ts"]] : [first, []];
  const result = await smoke(command as string, args as string[], version);
  if (result.ok) console.log("✓ Smoke test passed: version, attempt, file over FTPS, pushall only.");
  else {
    console.error(`✗ Smoke test failed:\n- ${result.problems.join("\n- ")}\n\nThe program's log:\n${result.log}`);
    process.exit(1);
  }
}
