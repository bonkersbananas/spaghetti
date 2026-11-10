/**
 * Recorded-style report sequences from a Bambu printer, for the fake printer to replay.
 *
 * Where they come from: written by hand to the report format the community documents (the OpenBambuAPI project's
 * MQTT notes, the Home Assistant Bambu Lab integration's field names, and bambulabs_api): `print` objects with
 * `command: "push_status"`, `gcode_state`, `mc_percent`, `mc_remaining_time` (minutes), `layer_num`,
 * `total_layer_num`, `job_id`, `subtask_name`, `gcode_file`, `hms`, and an `ams` block of units and trays. They are
 * NOT captured from an X2D (there isn't one here), so the field values are plausible rather than real. When a real
 * capture is available, replace these with it and see what differs. See test/bridge/README.md.
 */

export type Report = Record<string, unknown>;

export interface TrayInput {
  id: number;
  type: string;
  color: string;
  sub?: string;
  uuid?: string;
  remain?: number;
}

export const BAMBU_TRAYS: TrayInput[] = [
  { id: 0, type: "PLA", color: "00AE42FF", sub: "PLA Basic", uuid: "AAAA0000AAAA0000AAAA0000AAAA0001", remain: 82 },
  { id: 1, type: "PETG", color: "FFFFFFFF", sub: "PETG HF", uuid: "AAAA0000AAAA0000AAAA0000AAAA0002", remain: 40 },
  // A third-party spool in the AMS: no RFID tag (an all-zero UUID) and no known level.
  { id: 2, type: "PLA", color: "C12E1FFF", sub: "", uuid: "00000000000000000000000000000000", remain: -1 },
  { id: 3, type: "", color: "00000000", sub: "", uuid: "00000000000000000000000000000000", remain: 0 },
];

export function trayReport(input: TrayInput) {
  return {
    id: String(input.id),
    tray_type: input.type,
    tray_color: input.color,
    tray_sub_brands: input.sub ?? "",
    tray_uuid: input.uuid ?? "00000000000000000000000000000000",
    tag_uid: input.uuid ? "0123456789ABCDEF" : "0000000000000000",
    remain: input.remain ?? -1,
  };
}

const print = (fields: Record<string, unknown>): Report => ({
  print: { command: "push_status", msg: 1, sequence_id: "1", ...fields },
});

/** The answer to `pushall`: everything. */
export function fullReport(fields: {
  state: string;
  job?: string;
  name?: string;
  file?: string;
  percent?: number;
  layer?: number;
  total?: number;
  remaining?: number;
  trays?: TrayInput[];
  error?: number;
  hms?: Array<{ attr: number; code: number }>;
}): Report {
  return print({
    gcode_state: fields.state,
    job_id: fields.job ?? "0",
    subtask_id: "0",
    subtask_name: fields.name ?? "",
    gcode_file: fields.file ?? "",
    mc_percent: fields.percent ?? 0,
    mc_remaining_time: fields.remaining ?? 0,
    layer_num: fields.layer ?? 0,
    total_layer_num: fields.total ?? 0,
    print_error: fields.error ?? 0,
    hms: fields.hms ?? [],
    ams: { ams: [{ id: "0", tray: (fields.trays ?? BAMBU_TRAYS).map(trayReport) }], tray_now: "255" },
    vt_tray: {
      id: "254",
      tray_type: "",
      tray_color: "00000000",
      tray_uuid: "00000000000000000000000000000000",
      remain: 0,
    },
  });
}

/** A delta: only what changed. */
export const delta = (fields: Record<string, unknown>): Report => print(fields);

export const NAME = "bracket_v2";
export const JOB = "9001";

const start = [
  fullReport({ state: "IDLE" }),
  delta({
    gcode_state: "PREPARE",
    job_id: JOB,
    subtask_name: NAME,
    gcode_file: "Metadata/plate_1.gcode",
    mc_percent: 0,
  }),
  delta({ gcode_state: "RUNNING", total_layer_num: 240, layer_num: 1, mc_remaining_time: 90 }),
];

/** An unremarkable print from the start to FINISH. */
export const fullPrint: Report[] = [
  ...start,
  delta({ mc_percent: 25, layer_num: 60, mc_remaining_time: 68 }),
  delta({ mc_percent: 53, layer_num: 128, mc_remaining_time: 42 }),
  delta({ mc_percent: 100, layer_num: 240, mc_remaining_time: 0 }),
  delta({ gcode_state: "FINISH" }),
];

/** The AI detection sees spaghetti, then the print fails. */
export const failedPrint: Report[] = [
  ...start,
  delta({ mc_percent: 40, layer_num: 96 }),
  delta({ hms: [{ attr: 0x0c000300, code: 0x00020001 }] }),
  delta({ gcode_state: "FAILED", print_error: 0x0500c011 }),
];

/** A person cancels at the printer. */
export const cancelledPrint: Report[] = [
  ...start,
  delta({ mc_percent: 12, layer_num: 30 }),
  delta({ gcode_state: "FAILED", print_error: 50348044 }),
];

/** The printer's own health report fails the print, with nothing about spaghetti. */
export const stoppedPrint: Report[] = [
  ...start,
  delta({ mc_percent: 70 }),
  delta({ gcode_state: "FAILED", print_error: 0x07008011, hms: [{ attr: 0x07000100, code: 0x00010001 }] }),
];

/** Spools changed in the AMS: A3's third-party spool is swapped for a blue one, A4 gets a Bambu spool. */
export const amsChanges: Report[] = [
  fullReport({ state: "IDLE" }),
  delta({
    ams: {
      ams: [
        {
          id: "0",
          tray: [
            trayReport({ id: 2, type: "PETG", color: "0A2989FF", sub: "" }),
            trayReport({
              id: 3,
              type: "PLA",
              color: "F4EE2AFF",
              sub: "PLA Basic",
              uuid: "AAAA0000AAAA0000AAAA0000AAAA0004",
              remain: 100,
            }),
          ],
        },
      ],
    },
  }),
];

/** What the printer says to a bridge that starts, or restarts, while the print is half done (the same job). */
export const midPrintFull: Report = fullReport({
  state: "RUNNING",
  job: JOB,
  name: NAME,
  file: "Metadata/plate_1.gcode",
  percent: 55,
  layer: 132,
  total: 240,
  remaining: 40,
});

export const restartMidPrint: Report[] = [
  midPrintFull,
  delta({ mc_percent: 80, layer_num: 190 }),
  delta({ gcode_state: "FINISH" }),
];
