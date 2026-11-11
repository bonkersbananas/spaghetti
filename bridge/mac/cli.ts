/** The commands around `run`: setup, uninstall, status, check, discover. The real world, wired into mac/setup.ts. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { discoverPrinters, serialFromCertificate } from "../discover.ts";
import { PLATFORM, VERSION } from "../version.ts";
import { checkPrinter } from "./check.ts";
import { pairWithApp } from "./pair.ts";
import { LABEL, macPaths } from "./paths.ts";
import { readSettings } from "./settings.ts";
import { parseSetupArgs, runSetup, runUninstall, type SetupEnv, SetupStop } from "./setup.ts";

const say = (line: string) => console.log(line);

function realEnv(interactive: boolean): SetupEnv {
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  return {
    home: homedir(),
    uid: process.getuid?.() ?? 501,
    fetch,
    run: (command, args) => {
      const result = spawnSync(command, args, { encoding: "utf8" });
      return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
    },
    ask: rl ? async (question, fallback) => rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `) : null,
    say,
    discover: () => discoverPrinters(6_000),
    serialOf: (host) => serialFromCertificate(host),
    check: (settings) => checkPrinter(settings),
    pair: (appUrl, code) => pairWithApp(appUrl, code),
    heardFromBridge: async (appUrl, token, since) => {
      const response = await fetch(`${appUrl}/api/printer`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return false;
      const body = (await response.json()) as { bridge: { lastSeenAt: number } | null };
      return Boolean(body.bridge && body.bridge.lastSeenAt >= since);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
  };
}

/** Whether anyone can answer a question: the installer gives the program the terminal as its input. */
const interactive = () => Boolean(process.stdin.isTTY);

export async function setupCommand(argv: readonly string[]): Promise<number> {
  const env = realEnv(interactive());
  try {
    await runSetup(parseSetupArgs(argv, process.env), env);
    return 0;
  } catch (error) {
    console.error(`✗ ${error instanceof SetupStop || error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    // The readline interface keeps the process alive.
    process.stdin.pause();
  }
}

export function uninstallCommand(): number {
  runUninstall(realEnv(false));
  return 0;
}

export async function checkCommand(argv: readonly string[]): Promise<number> {
  const saved = readSettings(macPaths(homedir()).config);
  const args = parseSetupArgs(argv, process.env);
  const host = args.printerHost ?? saved.printerHost;
  const serial = args.serial ?? saved.serial;
  const accessCode = args.accessCode ?? saved.accessCode;
  if (!host || !serial || !accessCode) {
    console.error("✗ Nothing to check yet: run the installer first, or give --ip, --serial and --access-code.");
    return 1;
  }
  say(`Asking the printer at ${host}…`);
  const result = await checkPrinter({
    host,
    serial,
    accessCode,
    dataDir: saved.dataDir ?? macPaths(homedir()).dataDir,
  });
  if (result.ok) {
    say("✓ The printer answered. If macOS asked about the local network, this is where it was allowed.");
    return 0;
  }
  console.error(`✗ ${result.problem.message}`);
  return 1;
}

export async function discoverCommand(): Promise<number> {
  say("Listening for Bambu printers for a few seconds…");
  const found = await discoverPrinters(8_000);
  if (!found.length) {
    say("None announced themselves. You can still type the printer's address, serial number and access code.");
    return 1;
  }
  for (const printer of found) say(`${printer.host}  ${printer.serial}  ${printer.name ?? printer.model ?? ""}`.trim());
  return 0;
}

export function statusCommand(): number {
  const paths = macPaths(homedir());
  const saved = readSettings(paths.config);
  say(`Spaghetti bridge ${VERSION} (${PLATFORM})`);
  if (!existsSync(paths.config)) {
    say("Not set up on this Mac. Use the command on the Printer page in Spaghetti.");
    return 1;
  }
  say(`Printer: ${saved.printerHost} (${saved.serial}); Spaghetti: ${saved.appUrl}`);
  const listed = spawnSync("launchctl", ["print", `gui/${process.getuid?.() ?? 501}/${LABEL}`], { encoding: "utf8" });
  say(
    listed.status === 0
      ? `Login item: loaded (${/state = (\w+)/.exec(listed.stdout)?.[1] ?? "unknown"})`
      : "Login item: not loaded",
  );
  try {
    const lines = readFileSync(paths.log, "utf8").trimEnd().split("\n").slice(-15);
    say(`\nThe last lines of ${paths.log}:\n${lines.join("\n")}`);
  } catch {
    say(`No log yet at ${paths.log}.`);
  }
  return 0;
}
