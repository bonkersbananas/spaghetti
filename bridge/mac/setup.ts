/**
 * `spaghetti-bridge setup`: what the installer script runs once the program is in place. Trades the pairing code for
 * a token, learns the printer's address, serial number and access code (asking only for what it can't find),
 * checks that the printer can be reached, writes the settings, installs the LaunchAgent and starts it. Running it
 * again updates: what is already saved is kept unless a new value is given. Everything the outside world does is
 * passed in, so the unit tests run it without a Mac.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BridgeProblem, PairResponse } from "../../src/shared/bridge.ts";
import type { FoundPrinter } from "../discover.ts";
import type { CheckResult } from "./check.ts";
import { PairingError } from "./pair.ts";
import { LABEL, type MacPaths, macPaths } from "./paths.ts";
import { launchAgentPlist } from "./plist.ts";
import { problemWithSettings, readSettings, type SavedSettings, writeSettings } from "./settings.ts";

export const DEFAULT_APP_URL = "https://spaghetti.day";

export interface SetupArgs {
  appUrl?: string;
  code?: string;
  printerHost?: string;
  serial?: string;
  accessCode?: string;
  camera?: "on" | "off";
  /** Skip the "can the printer be reached" check. */
  noCheck: boolean;
  /** Install but don't start. */
  noStart: boolean;
}

/** `setup [CODE] --app URL --ip … --serial … --access-code … --camera off --no-check --no-start` */
export function parseSetupArgs(argv: readonly string[], env: NodeJS.ProcessEnv = {}): SetupArgs {
  const args: SetupArgs = { noCheck: false, noStart: false };
  const value = (i: number) => argv[i + 1];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--app") args.appUrl = value(i++);
    else if (arg === "--code") args.code = value(i++);
    else if (arg === "--ip") args.printerHost = value(i++);
    else if (arg === "--serial") args.serial = value(i++);
    else if (arg === "--access-code") args.accessCode = value(i++);
    else if (arg === "--camera") args.camera = value(i++) === "off" ? "off" : "on";
    else if (arg === "--no-check") args.noCheck = true;
    else if (arg === "--no-start") args.noStart = true;
    else if (!arg.startsWith("-") && !args.code) args.code = arg;
  }
  args.appUrl ??= env.BRIDGE_APP_URL;
  args.printerHost ??= env.BRIDGE_PRINTER_HOST;
  args.serial ??= env.BRIDGE_PRINTER_SERIAL;
  args.accessCode ??= env.BRIDGE_PRINTER_ACCESS_CODE;
  return args;
}

export interface SetupEnv {
  home: string;
  uid: number;
  fetch: typeof fetch;
  /** Runs a program (launchctl) and says whether it succeeded. */
  run: (command: string, args: string[]) => { ok: boolean; output: string };
  /** Asks a question and returns the answer (the default when it is just Enter). Null when nobody can answer. */
  ask: ((question: string, fallback?: string) => Promise<string>) | null;
  say: (line: string) => void;
  discover: () => Promise<FoundPrinter[]>;
  serialOf: (host: string) => Promise<string | null>;
  check: (settings: { host: string; serial: string; accessCode: string; dataDir: string }) => Promise<CheckResult>;
  pair: (appUrl: string, code: string) => Promise<PairResponse>;
  /** Asks the app whether the bridge has checked in since `since` (epoch ms). */
  heardFromBridge: (appUrl: string, token: string, since: number) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export class SetupStop extends Error {}

const plain = (text: string) => text.replace(/\s+/g, " ").trim();

export async function runSetup(args: SetupArgs, env: SetupEnv): Promise<void> {
  const paths = macPaths(env.home);
  const say = env.say;
  const saved = readSettings(paths.config);
  const started = env.now();

  if (!existsSync(paths.binary)) {
    throw new SetupStop(
      `The bridge program isn't at ${paths.binary}. Run the installer command from the Printer page again.`,
    );
  }

  // 1. Is there a way to reach Spaghetti? The code is only spent at the end (step 4): a printer that can't be reached
  // must not use up a single-use code, or revoke the token a working bridge has.
  let appUrl = (args.appUrl ?? saved.appUrl ?? DEFAULT_APP_URL).replace(/\/+$/, "");
  let token = saved.token;
  if (!args.code && !token) {
    throw new SetupStop(
      "This needs a pairing code: open Spaghetti, go to Printer → Connect the bridge, and paste the command it shows.",
    );
  }

  // 2. The printer.
  let printerHost = args.printerHost ?? saved.printerHost;
  let serial = args.serial ?? saved.serial;
  const accessCodeGiven = args.accessCode ?? saved.accessCode;
  let accessCode = accessCodeGiven;
  if (!printerHost || !serial) {
    say("Looking for your printer on the network (a few seconds)…");
    const found = await env.discover().catch(() => []);
    const one = found[0];
    if (one) {
      say(`  Found ${one.name ?? "a Bambu printer"} at ${one.host} (${one.serial}).`);
      printerHost ??= one.host;
      serial ??= one.serial;
    } else say("  Didn't hear it announce itself. That's fine, you can type its address.");
  }
  const ask = async (question: string, fallback?: string) => {
    if (!env.ask) return fallback ?? "";
    return (await env.ask(question, fallback)).trim() || fallback || "";
  };
  if (!printerHost) {
    printerHost = await ask("The printer's IP address (on its screen, with the Wi-Fi settings, e.g. 192.168.1.50)");
  }
  if (!serial && printerHost) {
    const fromCertificate = await env.serialOf(printerHost).catch(() => null);
    serial = await ask("The printer's serial number (on its screen and sticker)", fromCertificate ?? undefined);
  }
  if (!accessCode) accessCode = await ask("The printer's access code (on its screen, with LAN Only mode)");
  const wrong = problemWithSettings({ printerHost, serial, accessCode });
  if (wrong) {
    throw new SetupStop(
      env.ask
        ? wrong
        : `${wrong} Give them with --ip, --serial and --access-code, or run this in Terminal to be asked.`,
    );
  }
  // 3. Can it be reached from here? Asked now, in Terminal, so that a problem is found while someone is looking.
  if (!args.noCheck) {
    say(`Checking that the printer answers at ${printerHost}…`);
    mkdirSync(paths.dataDir, { recursive: true });
    const result = await env.check({
      host: printerHost as string,
      serial: serial as string,
      accessCode: accessCode as string,
      dataDir: paths.dataDir,
    });
    if (result.ok) say("  ✓ The printer answered.");
    else {
      say(`  ✗ ${plain(result.problem.message)}`);
      const goOn = env.ask
        ? (await env.ask("Install it anyway? It will keep trying. (y/N)", "n")).trim().toLowerCase()
        : "n";
      if (!goOn.startsWith("y")) {
        throw new SetupStop(
          "Nothing was changed, and your code is still good. Fix that, then run the same command again.",
        );
      }
    }
  }

  // 4. Pair now that everything else is known: this spends the code and replaces the old token.
  if (args.code) {
    say("Pairing with Spaghetti…");
    try {
      const paired = await env.pair(appUrl, args.code);
      token = paired.token;
      appUrl = paired.appUrl.replace(/\/+$/, "");
      say("  ✓ Paired. (The code is spent; it can't be used again.)");
    } catch (error) {
      if (error instanceof PairingError) throw new SetupStop(error.message);
      throw error;
    }
  } else say("Keeping the bridge's saved connection to Spaghetti.");
  const settings: SavedSettings = {
    printerHost: printerHost as string,
    serial: serial as string,
    accessCode: accessCode as string,
    appUrl,
    token: token as string,
    dataDir: paths.dataDir,
    ...(args.camera ? { camera: args.camera } : saved.camera ? { camera: saved.camera } : {}),
  };

  // 5. Write it down.
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.logDir, { recursive: true });
  writeSettings(paths.config, settings);
  mkdirSync(dirname(paths.plist), { recursive: true });
  writeFileSync(paths.plist, launchAgentPlist(paths));
  say(`Saved the settings (only you can read them) in ${paths.config}.`);

  // 6. Start it.
  if (args.noStart) {
    say("Not started (--no-start).");
    return;
  }
  const domain = `gui/${env.uid}`;
  env.run("launchctl", ["bootout", `${domain}/${LABEL}`]);
  let loaded = env.run("launchctl", ["bootstrap", domain, paths.plist]);
  for (let attempt = 0; !loaded.ok && attempt < 4; attempt++) {
    // bootout finishes a moment after it returns; the second try nearly always works.
    await env.sleep(1_000);
    loaded = env.run("launchctl", ["bootstrap", domain, paths.plist]);
  }
  if (!loaded.ok) {
    throw new SetupStop(
      `macOS wouldn't start it (${plain(loaded.output)}). Log out and in again, or restart, and it will start by itself.`,
    );
  }
  env.run("launchctl", ["kickstart", "-k", `${domain}/${LABEL}`]);
  say("Started. It starts again whenever you log in, and if it stops.");

  // 7. Did Spaghetti hear it?
  say("Waiting for it to check in with Spaghetti…");
  for (let i = 0; i < 12; i++) {
    await env.sleep(2_000);
    if (await env.heardFromBridge(appUrl, settings.token, started).catch(() => false)) {
      say("  ✓ Spaghetti heard from the bridge. The Printer page says so too.");
      say(`Its log is ${paths.log}.`);
      return;
    }
  }
  say(
    "  Not yet. It may still be starting. Look at the Printer page in a minute; if it stays quiet, run `spaghetti-bridge status`.",
  );
  say(`Its log is ${paths.log}.`);
}

export function runUninstall(env: Pick<SetupEnv, "home" | "uid" | "run" | "say">): void {
  const paths: MacPaths = macPaths(env.home);
  env.run("launchctl", ["bootout", `gui/${env.uid}/${LABEL}`]);
  rmSync(paths.plist, { force: true });
  rmSync(paths.appDir, { recursive: true, force: true });
  rmSync(paths.logDir, { recursive: true, force: true });
  env.say("The Spaghetti bridge is stopped and removed (its program, settings, log and the login item).");
  env.say("In Spaghetti, open the Printer page and press Disconnect, so its token is ended too.");
}

export type { BridgeProblem };
