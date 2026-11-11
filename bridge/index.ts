/**
 * pnpm bridge — the optional, read-only printer bridge. Listens to the X2D on the home network and tells Spaghetti
 * when a print starts, how it is going and how it ended, and keeps the AMS slots in step. See docs/bridge.md.
 *
 * The same program is built into one file for macOS (scripts/build-bridge.ts). Commands:
 *   run (default)   listen to the printer until stopped
 *   setup [CODE]    what the installer runs: pair, write settings, install the login item (macOS)
 *   uninstall       stop and remove it (macOS)
 *   status          is it running, and its log's last lines (macOS)
 *   check           can this computer reach the printer?
 *   discover        listen for printers announcing themselves
 *   version
 */
import { VERSION } from "./version.ts";

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "version":
  case "--version":
    console.log(VERSION);
    break;
  case "setup":
  case "check": {
    const cli = await import("./mac/cli.ts");
    process.exit(await (command === "setup" ? cli.setupCommand(rest) : cli.checkCommand(rest)));
    break;
  }
  case "uninstall":
    process.exit((await import("./mac/cli.ts")).uninstallCommand());
    break;
  case "status":
    process.exit((await import("./mac/cli.ts")).statusCommand());
    break;
  case "discover":
    process.exit(await (await import("./mac/cli.ts")).discoverCommand());
    break;
  case "run":
    (await import("./run.ts")).run(rest);
    break;
  default:
    // `pnpm bridge --config bridge.json` and the environment, as before.
    (await import("./run.ts")).run(process.argv.slice(2));
}
