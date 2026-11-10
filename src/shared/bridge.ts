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

/** What is stored: everything but the last-heard time. */
export interface BridgeStatusData {
  printerState: BridgePrinterState | null;
  progress: BridgeProgress | null;
  unknownTrays: UnknownTray[];
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

export type BridgeLineState = "none" | "connected" | "no-printer" | "quiet";

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
  if (status.printerState === "offline") {
    return { state: "no-printer", text: "Printer bridge is running but can't reach the printer." };
  }
  return { state: "connected", text: "Printer bridge connected." };
}
