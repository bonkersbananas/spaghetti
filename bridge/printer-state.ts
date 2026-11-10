/**
 * Folds the printer's MQTT reports into one full state. The printer sends a full report when asked (`pushall`) and
 * afterwards only what changed, so every report is merged into what we hold: objects merge key by key, the AMS's
 * units and trays merge by their `id`, and any other array (the HMS list) is replaced.
 *
 * The report format is the community-documented one (see test/bridge/fixtures/README.md); nothing here is
 * confirmed against an X2D.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type PrinterReport = { [key: string]: Json };

/** The fields of the report the bridge reads, all optional: a delta carries only some of them. */
export interface PrintState {
  gcode_state?: string;
  job_id?: string;
  task_id?: string;
  subtask_id?: string;
  subtask_name?: string;
  gcode_file?: string;
  mc_percent?: number;
  /** Minutes. */
  mc_remaining_time?: number;
  layer_num?: number;
  total_layer_num?: number;
  print_error?: number;
  hms?: Array<{ attr: number; code: number }>;
  ams?: { ams?: AmsUnit[]; tray_now?: string };
  vt_tray?: RawTray;
}

export interface AmsUnit {
  id: string;
  tray?: RawTray[];
}

export interface RawTray {
  id?: string;
  tray_type?: string;
  tray_color?: string;
  tray_sub_brands?: string;
  tray_uuid?: string;
  tag_uid?: string;
  remain?: number;
}

const isObject = (value: unknown): value is { [key: string]: Json } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const MERGE_BY_ID = new Set(["ams", "tray"]);

function mergeById(current: Json[], delta: Json[]): Json[] {
  const merged = [...current];
  for (const item of delta) {
    const id = isObject(item) ? item.id : undefined;
    const at = id === undefined ? -1 : merged.findIndex((existing) => isObject(existing) && existing.id === id);
    if (at < 0) merged.push(item);
    else merged[at] = merge(merged[at] as Json, item);
  }
  return merged;
}

function merge(current: Json, delta: Json, key?: string): Json {
  if (isObject(current) && isObject(delta)) {
    const out: { [key: string]: Json } = { ...current };
    for (const [name, value] of Object.entries(delta))
      out[name] = name in out ? merge(out[name] as Json, value, name) : value;
    return out;
  }
  if (Array.isArray(current) && Array.isArray(delta) && key && MERGE_BY_ID.has(key)) return mergeById(current, delta);
  return delta;
}

/** The printer as we know it: nothing until the first full report. */
export interface PrinterState {
  /** `print` of the reports so far, merged. */
  print: PrintState;
  /** Whether a full report (not only a delta) has been seen since connecting. */
  complete: boolean;
}

export const emptyState = (): PrinterState => ({ print: {}, complete: false });

/**
 * Adds one report. Reports that aren't a status (`info`, `system`…) change nothing. A full report is recognised by
 * carrying `gcode_state` and `ams` together, which is what `pushall` answers with.
 */
export function foldReport(state: PrinterState, report: unknown): PrinterState {
  if (!isObject(report) || !isObject(report.print)) return state;
  const print = report.print;
  if (print.command !== undefined && print.command !== "push_status") return state;
  const { command: _command, sequence_id: _sequence, msg: _msg, ...fields } = print;
  const next = merge(state.print as unknown as Json, fields) as unknown as PrintState;
  const full = "gcode_state" in fields && "ams" in fields;
  return { print: next, complete: state.complete || full };
}

/** MQTT payload bytes → a report, or null when it isn't JSON. */
export function parseReport(payload: Uint8Array | string): unknown {
  try {
    return JSON.parse(typeof payload === "string" ? payload : new TextDecoder().decode(payload));
  } catch {
    return null;
  }
}
