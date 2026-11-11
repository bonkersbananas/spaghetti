/**
 * What the printer bridge (bridge/, a program on a home computer) tells the app about the printer. The bridge
 * sends it with `PUT /api/printer/bridge`; the Printer page and the printing attempts read it back.
 */

/** The printer's own progress for the print it is on. */
export interface BridgeProgress {
  /** The attempt it belongs to. */
  attemptId: string;
  /** 0–100. */
  percent: number;
  remainingMinutes: number | null;
  layer: number | null;
  totalLayers: number | null;
  /** When the bridge sent it (set by the server), epoch ms. */
  at: number;
}

/** An AMS tray the bridge found a spool in but couldn't match to one of the pantry's. */
export interface UnknownTray {
  /** "A3" */
  slot: string;
  material: string | null;
  colorHex: string | null;
  brand: string | null;
}

/** "offline": the bridge is up but can't reach the printer. */
export type BridgePrinterState = "idle" | "printing" | "paused" | "finished" | "failed" | "offline";

/**
 * What is wrong, as the bridge found it, so the Printer page can say it in plain words. `message` is the bridge's own
 * sentence ("Can't reach the printer…"); `code` lets the app pick a how-to.
 */
export const BRIDGE_PROBLEM_CODES = [
  "local-network",
  "unreachable",
  "refused",
  "wrong-access-code",
  "silent",
  "certificate",
  "app",
] as const;
export type BridgeProblemCode = (typeof BRIDGE_PROBLEM_CODES)[number];
export interface BridgeProblem {
  code: BridgeProblemCode;
  message: string;
}

/** What is stored: everything but the last-heard time. */
export interface BridgeStatusData {
  printerState: BridgePrinterState | null;
  progress: BridgeProgress | null;
  unknownTrays: UnknownTray[];
  /** The bridge's version ("1.0.0", or "dev" when run from source) and system ("darwin-arm64"). */
  version?: string | null;
  platform?: string | null;
  /** What is wrong right now, if anything. Empty when all is well. */
  problems?: BridgeProblem[];
}

export interface BridgeStatus extends BridgeStatusData {
  /** When the bridge last got in touch, epoch ms. */
  lastSeenAt: number;
}

/** How long a progress report counts as live: the bridge sends one at least every minute. */
export const PROGRESS_FRESH_MS = 3 * 60_000;
/** Within this the bridge counts as connected. */
export const BRIDGE_CONNECTED_MS = 3 * 60_000;

export const isFresh = (at: number, now: number, within = PROGRESS_FRESH_MS) => now - at <= within;

export type BridgeLineState = "none" | "connected" | "no-printer" | "quiet" | "problem";

/**
 * The Printer page's one quiet line about the bridge. `since` is a phrase for the last time it was heard
 * ("5 min ago"), made by the caller from `lastSeenAt` so this stays free of the clock's wording.
 */
export function bridgeLine(
  status: BridgeStatus | null | undefined,
  now: number,
  since: (time: number) => string,
): { state: BridgeLineState; text: string } {
  if (!status) return { state: "none", text: "No printer bridge set up." };
  if (!isFresh(status.lastSeenAt, now, BRIDGE_CONNECTED_MS)) {
    return { state: "quiet", text: `Printer bridge last heard ${since(status.lastSeenAt).toLowerCase()}.` };
  }
  const problem = status.problems?.[0];
  if (problem) return { state: "problem", text: problem.message };
  if (status.printerState === "offline") {
    return { state: "no-printer", text: "Printer bridge is running but can't reach the printer." };
  }
  return { state: "connected", text: "Printer bridge connected." };
}

/** Where the pairing code is made and exchanged: see worker/routes/bridge.ts. */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PAIRING_CODE_LENGTH = 8;
/** How long a pairing code works. */
export const PAIRING_MINUTES = 10;
/** The scopes the bridge's token gets: it listens, starts and ends attempts, and keeps the AMS. */
export const BRIDGE_SCOPES = ["read", "attempts", "printer"] as const;

/** "ABCD-EFGH" for people, "ABCDEFGH" for the machine: the way a typed or pasted code is read. */
export const normalizePairingCode = (input: string) => input.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const showPairingCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** POST /api/bridge/pairing */
export interface PairingResponse {
  /** Shown once, "ABCD-EFGH". */
  code: string;
  expiresAt: number;
}

/** POST /api/bridge/pair: what the installer gets for a code. */
export interface PairResponse {
  token: string;
  agentId: string;
  /** Where the bridge sends its messages (this app's address). */
  appUrl: string;
  scopes: Array<(typeof BRIDGE_SCOPES)[number]>;
}
