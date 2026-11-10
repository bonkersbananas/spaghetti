/**
 * Turns the printer's state into the moments the journal cares about: a print started, how it is going, and how it
 * ended. Pure: feed it states and the clock, it says what happened. It remembers one job (and is given the stored
 * one after a restart, so a print the bridge already knows about is never started twice).
 */
import type { PrinterState, PrintState } from "./printer-state.ts";

export interface Job {
  /** Identifies the print: the printer's job id, else its subtask id, else the file name. */
  key: string;
  /** The project's name as the printer reports it ("bracket v2"). */
  name: string;
  /** "Metadata/plate_2.gcode" and the like. */
  gcodeFile: string | null;
  /** From the gcode file's name; 1 when it doesn't say. */
  plate: number;
  startedAt: number;
}

/** What is kept across restarts for the job in progress. */
export interface TrackedJob extends Job {
  /** The printer reported the end and the bridge has said so. */
  ended: boolean;
  /** The printer's HMS or AI detection reported spaghetti while it printed. */
  spaghetti: boolean;
}

export type EndResult = "finished" | "failed" | "cancelled";

export type JobEvent =
  | { type: "started"; job: Job }
  | { type: "ended"; job: Job; result: EndResult; endedAt: number; spaghetti: boolean }
  /** The printer moved on to another print before this one's end was seen: the bridge can't say how it went. */
  | { type: "lost"; job: Job };

export interface Progress {
  percent: number;
  remainingMinutes: number | null;
  layer: number | null;
  totalLayers: number | null;
}

const ACTIVE = new Set(["RUNNING", "PREPARE", "PAUSE"]);
const ENDED: Record<string, EndResult> = { FINISH: "finished", FAILED: "failed" };

/** `print_error` of a print the person cancelled at the printer (HMS 0300_400C). Community-documented. */
export const CANCELLED_ERROR = 0x0300400c;

/** A print is told apart by the printer's job id; it is "0" or empty when the printer doesn't give one. */
function jobKey(print: PrintState): string | null {
  const real = (value: string | undefined) => (value && !/^0*$/.test(value) ? value : null);
  const job = real(print.job_id);
  if (job) return `job:${job}`;
  const subtask = real(print.subtask_id);
  if (subtask) return `subtask:${subtask}`;
  return print.subtask_name ? `name:${print.subtask_name}` : null;
}

const hex = (value: number, digits: number) => value.toString(16).toUpperCase().padStart(digits, "0");

/**
 * Whether the printer's health report says it saw spaghetti. The AI detection reports it as an HMS entry; the codes
 * are from the community's HMS list and are [uncertain] for the X2D, so both byte orders of the 16 digits count.
 */
export function seesSpaghetti(print: PrintState): boolean {
  return (print.hms ?? []).some((entry) => {
    const attr = hex(entry.attr >>> 0, 8);
    const code = hex(entry.code >>> 0, 8);
    const key = `${attr}${code}`;
    const swapped = `${attr.slice(4)}${attr.slice(0, 4)}${code}`;
    return SPAGHETTI_HMS.has(key) || SPAGHETTI_HMS.has(swapped);
  });
}

/** `attr` and `code` as 16 hex digits: "AI detected spaghetti" (and its halt-the-print twin). */
const SPAGHETTI_HMS = new Set(["0C00030000020001", "0300 0C00 0002 0001".replaceAll(" ", "")]);

export function progressOf(print: PrintState): Progress | null {
  if (print.mc_percent === undefined) return null;
  const number = (value: number | undefined) => (typeof value === "number" && value >= 0 ? Math.round(value) : null);
  return {
    percent: Math.max(0, Math.min(100, print.mc_percent)),
    remainingMinutes: number(print.mc_remaining_time),
    layer: number(print.layer_num),
    totalLayers: number(print.total_layer_num),
  };
}

/** "plate_2" in "Metadata/plate_2.gcode" → 2. */
export const plateOf = (gcodeFile: string | null | undefined): number => {
  const match = /plate_(\d+)/i.exec(gcodeFile ?? "");
  return match?.[1] ? Number(match[1]) : 1;
};

export class JobMachine {
  current: TrackedJob | null;

  constructor(restored: TrackedJob | null = null) {
    this.current = restored;
  }

  /** What the latest state means. Call it with every state, in order. */
  feed(state: PrinterState, now: number): JobEvent[] {
    const print = state.print;
    const gcodeState = print.gcode_state;
    if (!state.complete || !gcodeState) return [];
    const events: JobEvent[] = [];
    const key = jobKey(print);

    if (ACTIVE.has(gcodeState) && key) {
      const current = this.current;
      if (
        current &&
        !current.ended &&
        current.key !== key &&
        current.name === print.subtask_name &&
        now - current.startedAt < 120_000
      ) {
        // The id firmed up between PREPARE and RUNNING: the same print.
        current.key = key;
      } else if (!current || current.ended || current.key !== key) {
        if (current && !current.ended) events.push({ type: "lost", job: toJob(current) });
        this.current = {
          key,
          name: print.subtask_name ?? "",
          gcodeFile: print.gcode_file ?? null,
          plate: plateOf(print.gcode_file),
          startedAt: now,
          ended: false,
          spaghetti: false,
        };
        events.push({ type: "started", job: toJob(this.current) });
      }
    }

    const tracked = this.current;
    if (tracked && !tracked.ended) {
      if (seesSpaghetti(print)) tracked.spaghetti = true;
      const finished = ENDED[gcodeState];
      // A cancelled print goes back to idle on some firmware, without passing through FINISH.
      const cancelledToIdle = gcodeState === "IDLE";
      if (finished || cancelledToIdle) {
        tracked.ended = true;
        const result: EndResult =
          finished === "finished"
            ? "finished"
            : cancelledToIdle || print.print_error === CANCELLED_ERROR
              ? "cancelled"
              : "failed";
        events.push({ type: "ended", job: toJob(tracked), result, endedAt: now, spaghetti: tracked.spaghetti });
      }
    }
    return events;
  }

  /** Whether the printer is working on a print right now. */
  isPrinting(state: PrinterState): boolean {
    return !!this.current && !this.current.ended && ACTIVE.has(state.print.gcode_state ?? "");
  }
}

const toJob = ({ key, name, gcodeFile, plate, startedAt }: TrackedJob): Job => ({
  key,
  name,
  gcodeFile,
  plate,
  startedAt,
});
