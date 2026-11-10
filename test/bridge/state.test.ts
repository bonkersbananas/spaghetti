import { describe, expect, it } from "vitest";
import { traysOf } from "../../bridge/ams.ts";
import { type JobEvent, JobMachine, plateOf, progressOf, seesSpaghetti } from "../../bridge/job-machine.ts";
import { emptyState, foldReport, type PrinterState } from "../../bridge/printer-state.ts";
import {
  amsChanges,
  cancelledPrint,
  delta,
  failedPrint,
  fullPrint,
  fullReport,
  JOB,
  NAME,
  type Report,
  restartMidPrint,
  stoppedPrint,
} from "./fixtures.ts";

function play(reports: readonly Report[], machine = new JobMachine(), startAt = 1_000_000) {
  let state: PrinterState = emptyState();
  const events: JobEvent[] = [];
  let now = startAt;
  for (const report of reports) {
    state = foldReport(state, report);
    events.push(...machine.feed(state, now));
    now += 60_000;
  }
  return { state, events, machine };
}

describe("folding reports into a printer state", () => {
  it("merges deltas into the full report", () => {
    const { state } = play(fullPrint.slice(0, 4));
    expect(state.complete).toBe(true);
    expect(state.print).toMatchObject({
      gcode_state: "RUNNING",
      job_id: JOB,
      subtask_name: NAME,
      mc_percent: 25,
      total_layer_num: 240,
    });
  });

  it("is not complete before a full report, and ignores what isn't a status", () => {
    const only = foldReport(emptyState(), delta({ mc_percent: 5 }));
    expect(only.complete).toBe(false);
    expect(foldReport(only, { info: { command: "get_version" } })).toBe(only);
    expect(foldReport(only, { print: { command: "gcode_line", param: "M104" } })).toBe(only);
    expect(foldReport(only, "nonsense")).toBe(only);
  });

  it("merges AMS units and trays by id and replaces the HMS list", () => {
    const { state } = play(amsChanges);
    const trays = traysOf(state.print);
    expect(trays.map((tray) => [tray.slot, tray.material])).toEqual([
      ["A1", "PLA"],
      ["A2", "PETG"],
      ["A3", "PETG"],
      ["A4", "PLA"],
    ]);
    const hms = play(failedPrint).state.print.hms;
    expect(hms).toHaveLength(1);
    expect(foldReport(play(failedPrint).state, delta({ hms: [] })).print.hms).toEqual([]);
  });
});

describe("the job machine", () => {
  it("starts once at the new job id, and ends at FINISH", () => {
    const { events } = play(fullPrint);
    expect(events.map((event) => event.type)).toEqual(["started", "ended"]);
    const [started, ended] = events;
    expect(started).toMatchObject({ job: { key: `job:${JOB}`, name: NAME, plate: 1 } });
    expect(ended).toMatchObject({ result: "finished", spaghetti: false });
  });

  it("does not start again for later reports of the same job", () => {
    const { events } = play([...fullPrint.slice(0, 3), ...fullPrint.slice(2, 5)]);
    expect(events.filter((event) => event.type === "started")).toHaveLength(1);
  });

  it("starts again for a new job id after the last ended", () => {
    const second = [delta({ gcode_state: "RUNNING", job_id: "9002", subtask_name: "second" })];
    const { events } = play([...fullPrint, ...second]);
    expect(events.map((event) => event.type)).toEqual(["started", "ended", "started"]);
  });

  it("reports a failure with the spaghetti the AI saw", () => {
    const { events } = play(failedPrint);
    expect(events.at(-1)).toMatchObject({ type: "ended", result: "failed", spaghetti: true });
  });

  it("tells a cancel from a failure", () => {
    expect(play(cancelledPrint).events.at(-1)).toMatchObject({ type: "ended", result: "cancelled", spaghetti: false });
    expect(play(stoppedPrint).events.at(-1)).toMatchObject({ type: "ended", result: "failed", spaghetti: false });
  });

  it("counts a return to idle after printing as a cancel", () => {
    const { events } = play([...fullPrint.slice(0, 4), delta({ gcode_state: "IDLE" })]);
    expect(events.at(-1)).toMatchObject({ type: "ended", result: "cancelled" });
  });

  it("does not start a print from an idle printer, or end one it never saw", () => {
    expect(play([fullReport({ state: "IDLE" }), delta({ gcode_state: "FINISH" })]).events).toEqual([]);
  });

  it("keeps the same print through PREPARE to RUNNING when the id firms up", () => {
    const { events } = play([
      fullReport({ state: "IDLE" }),
      delta({ gcode_state: "PREPARE", job_id: "0", subtask_name: NAME }),
      delta({ gcode_state: "RUNNING", job_id: JOB }),
    ]);
    expect(events.filter((event) => event.type === "started")).toHaveLength(1);
  });

  it("ends a print whose id firmed up under the key it started with", () => {
    const { events } = play([
      fullReport({ state: "IDLE" }),
      delta({ gcode_state: "PREPARE", job_id: "0", subtask_name: NAME }),
      delta({ gcode_state: "RUNNING", job_id: JOB }),
      delta({ gcode_state: "FINISH" }),
    ]);
    const [started, ended] = events;
    expect(events.map((event) => event.type)).toEqual(["started", "ended"]);
    expect(ended && "job" in ended && ended.job.key).toBe(started && "job" in started && started.job.key);
  });

  it("falls back to the subtask id, then the name, when there is no job id", () => {
    const first = play([
      fullReport({ state: "IDLE" }),
      delta({ gcode_state: "RUNNING", job_id: "0", subtask_id: "77", subtask_name: "x" }),
    ]);
    expect(first.machine.current?.key).toBe("subtask:77");
    const second = play([
      fullReport({ state: "IDLE" }),
      delta({ gcode_state: "RUNNING", job_id: "0", subtask_name: "x" }),
    ]);
    expect(second.machine.current?.key).toBe("name:x");
  });

  it("restarted mid-print with nothing remembered: starts the print it finds", () => {
    expect(play(restartMidPrint).events.map((event) => event.type)).toEqual(["started", "ended"]);
  });

  it("restarted mid-print with the job remembered: no second start, still ends it", () => {
    const first = play(fullPrint.slice(0, 4));
    const remembered = JSON.parse(JSON.stringify(first.machine.current));
    const { events } = play(restartMidPrint, new JobMachine(remembered));
    expect(events.map((event) => event.type)).toEqual(["ended"]);
  });

  it("restarted after the print ended while it was down: ends it once, from the remembered job", () => {
    const remembered = JSON.parse(JSON.stringify(play(fullPrint.slice(0, 4)).machine.current));
    const afterwards = [fullReport({ state: "FINISH", job: JOB, name: NAME })];
    const machine = new JobMachine(remembered);
    expect(play(afterwards, machine).events.map((event) => event.type)).toEqual(["ended"]);
    expect(play(afterwards, machine).events).toEqual([]);
  });

  it("says the print was lost when the printer starts another before the first ended", () => {
    const remembered = JSON.parse(JSON.stringify(play(fullPrint.slice(0, 4)).machine.current));
    const other = [fullReport({ state: "RUNNING", job: "9500", name: "other" })];
    expect(play(other, new JobMachine(remembered)).events.map((event) => event.type)).toEqual(["lost", "started"]);
  });
});

describe("what the machine reads", () => {
  it("reads progress, with unknown values as null", () => {
    expect(progressOf({ mc_percent: 53, mc_remaining_time: 42, layer_num: 128, total_layer_num: 240 })).toEqual({
      percent: 53,
      remainingMinutes: 42,
      layer: 128,
      totalLayers: 240,
    });
    expect(progressOf({ mc_percent: 5, layer_num: -1 })).toMatchObject({ layer: null, remainingMinutes: null });
    expect(progressOf({})).toBeNull();
  });

  it("finds spaghetti in the HMS list, and nothing else", () => {
    expect(seesSpaghetti({ hms: [{ attr: 0x0c000300, code: 0x00020001 }] })).toBe(true);
    expect(seesSpaghetti({ hms: [{ attr: 0x07000100, code: 0x00010001 }] })).toBe(false);
    expect(seesSpaghetti({})).toBe(false);
  });

  it("reads the plate from the gcode file's name", () => {
    expect(plateOf("Metadata/plate_2.gcode")).toBe(2);
    expect(plateOf("/data/Metadata/plate_1.gcode")).toBe(1);
    expect(plateOf(null)).toBe(1);
  });
});
