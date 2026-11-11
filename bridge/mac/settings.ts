/** config.json: the five settings and a few options, written by the installer and read by `run`. */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface SavedSettings {
  printerHost: string;
  serial: string;
  accessCode: string;
  appUrl: string;
  token: string;
  dataDir: string;
  /** "off" turns camera frames off. */
  camera?: "on" | "off";
}

export function readSettings(path: string): Partial<SavedSettings> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Partial<SavedSettings>;
  } catch {
    return {};
  }
}

/** Writes the file so that only its owner can read it, at no moment readable by others (written aside, then moved). */
export function writeSettings(path: string, settings: SavedSettings): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

/** A plain-words check of what was typed, before anything is written: null when it is fine. */
export function problemWithSettings(input: {
  printerHost?: string;
  serial?: string;
  accessCode?: string;
}): string | null {
  if (!input.printerHost || !/^(\d{1,3}\.){3}\d{1,3}$|^[A-Za-z0-9.-]+\.local$/.test(input.printerHost)) {
    return "The printer's address looks like 192.168.1.50 (it is on the printer's screen, with the Wi-Fi settings).";
  }
  if (!input.serial || !/^[0-9A-Za-z]{8,20}$/.test(input.serial)) {
    return "The serial number is 15 letters and digits (on the printer's screen and its sticker).";
  }
  if (!input.accessCode || !/^[0-9A-Za-z]{6,16}$/.test(input.accessCode)) {
    return "The access code is 8 letters and digits (on the printer's screen, with LAN Only mode).";
  }
  return null;
}
