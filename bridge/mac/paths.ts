/**
 * Where the bridge lives on a Mac. The installer script (public/bridge/install.sh) uses the same names; a unit test
 * keeps the two in step.
 */
import { join } from "node:path";

export const LABEL = "day.spaghetti.bridge";
export const APP_NAME = "Spaghetti Bridge";

export interface MacPaths {
  /** ~/Library/Application Support/Spaghetti Bridge */
  appDir: string;
  /** The program itself, in a place that doesn't change between updates (so a Local Network permission can stick). */
  binary: string;
  /** Settings, with the access code and token: only its owner may read it. */
  config: string;
  /** state.json and queue/: keep them between restarts. */
  dataDir: string;
  /** ~/Library/Logs/Spaghetti Bridge */
  logDir: string;
  log: string;
  /** ~/Library/LaunchAgents/day.spaghetti.bridge.plist */
  plist: string;
}

export function macPaths(home: string): MacPaths {
  const appDir = join(home, "Library", "Application Support", APP_NAME);
  const logDir = join(home, "Library", "Logs", APP_NAME);
  return {
    appDir,
    binary: join(appDir, "bin", "spaghetti-bridge"),
    config: join(appDir, "config.json"),
    dataDir: join(appDir, "data"),
    logDir,
    log: join(logDir, "bridge.log"),
    plist: join(home, "Library", "LaunchAgents", `${LABEL}.plist`),
  };
}
