/**
 * The bridge: printer reports in, Spaghetti's API out. Reports are folded into the printer's state; the job machine
 * says when a print starts and ends; those moments (and AMS changes) are queued on disk and sent in order, retried
 * with backoff while the app can't be reached. Progress and "I'm here" are sent once a minute and never queued: a
 * late one is worth nothing.
 */
import type { UpdateBridgeRequest } from "../src/shared/api.ts";
import type { BridgePrinterState } from "../src/shared/bridge.ts";
import { remainingFrom, traysOf } from "./ams.ts";
import { type Api, HttpError } from "./api.ts";
import type { Camera } from "./camera.ts";
import { type EndResult, type Job, type JobEvent, JobMachine, progressOf } from "./job-machine.ts";
import { amsJob, endJob, type JobContext, type JobPayload, photoJob, startJob } from "./jobs.ts";
import type { PrinterFiles } from "./printer-files.ts";
import { emptyState, foldReport, type PrinterState, parseReport } from "./printer-state.ts";
import type { Queue, QueuedJob } from "./queue.ts";
import type { Store } from "./store.ts";

export interface BridgeDeps {
  api: Api;
  store: Store;
  queue: Queue;
  files: PrinterFiles;
  /** Null: no camera frames. */
  camera: Camera | null;
  /** Identifies the printer in the ids the bridge makes (its serial number). */
  printerId: string;
  log?: (message: string) => void;
  now?: () => number;
  /** How often progress and "still here" go to the app. */
  statusEveryMs?: number;
  /** Wait before the AMS is synced, so a flurry of changes is one sync. */
  amsDelayMs?: number;
  /** First wait after a failed send; it doubles up to `maxBackoffMs`. */
  backoffMs?: number;
  maxBackoffMs?: number;
}

const STATE_NAMES: Record<string, BridgePrinterState> = {
  RUNNING: "printing",
  PREPARE: "printing",
  PAUSE: "paused",
  FINISH: "finished",
  FAILED: "failed",
  IDLE: "idle",
};

/** The failure tag the printer suggests, never a verdict: spaghetti seen, or the print didn't finish. */
export function suggestTag(result: EndResult, spaghetti: boolean): string | null {
  if (spaghetti) return "spaghetti";
  return result === "finished" ? null : "other";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Bridge {
  state: PrinterState = emptyState();
  machine: JobMachine;
  connected = false;
  private deps: Required<Omit<BridgeDeps, "camera" | "log">> & Pick<BridgeDeps, "camera" | "log">;
  private chain: Promise<void> = Promise.resolve();
  private draining = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private amsTimer: ReturnType<typeof setTimeout> | undefined;
  private lastStatusFailed = false;

  constructor(deps: BridgeDeps) {
    this.deps = {
      now: Date.now,
      statusEveryMs: 60_000,
      amsDelayMs: 3_000,
      backoffMs: 2_000,
      maxBackoffMs: 5 * 60_000,
      ...deps,
    };
    this.machine = new JobMachine(deps.store.data.current);
  }

  private log(message: string) {
    this.deps.log?.(message);
  }

  private get context(): JobContext {
    return { api: this.deps.api, store: this.deps.store, printerId: this.deps.printerId, log: (m) => this.log(m) };
  }

  /** Starts the once-a-minute status and works through whatever the last run left in the queue. */
  start() {
    this.timer = setInterval(() => void this.sendStatus(), this.deps.statusEveryMs);
    void this.sendStatus();
    this.kick();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.amsTimer);
    await this.chain;
  }

  /** Resolves when the work started so far (files fetched, jobs queued) is done. For tests. */
  idle(): Promise<void> {
    return this.chain;
  }

  /** The link calls this with every message from the printer. */
  onReport(payload: Uint8Array | string) {
    const report = parseReport(payload);
    const next = foldReport(this.state, report);
    if (next === this.state) return;
    this.state = next;
    const events = this.machine.feed(this.state, this.deps.now());
    this.deps.store.data.current = this.machine.current;
    if (events.length) this.deps.store.save();
    for (const event of events) this.later(() => this.handle(event));
    this.scheduleAms();
  }

  onConnection(connected: boolean) {
    this.connected = connected;
    if (connected) this.log("Connected to the printer.");
    else {
      this.log("Lost the printer; it will be tried again.");
      // A fresh full report is needed after a reconnect; deltas alone would leave gaps.
      this.state = { ...this.state, complete: false };
    }
  }

  /** Work that must happen in order (fetching a file, queueing a job) runs one after another. */
  private later(work: () => Promise<void>) {
    this.chain = this.chain.then(work).catch((error) => this.log(`Something went wrong: ${message(error)}`));
  }

  private async handle(event: JobEvent) {
    switch (event.type) {
      case "started":
        return this.onStarted(event.job);
      case "ended":
        return this.onEnded(event.job, event.result, event.endedAt, event.spaghetti);
      case "lost":
        this.log(
          `The printer moved on from "${event.job.name}" before its end was seen; it is left for a person to finish.`,
        );
    }
  }

  private async onStarted(job: Job) {
    this.log(`A print started: "${job.name}".`);
    let bytes: Uint8Array | undefined;
    let fileName: string | null = null;
    if (job.name) {
      try {
        const found = await this.deps.files.find([`${job.name}.gcode.3mf`, `${job.name}.3mf`]);
        if (found) {
          bytes = await this.deps.files.download(found.path);
          fileName = found.path.split("/").pop() ?? null;
        } else this.log("The print's file wasn't on the printer's card; going on without it.");
      } catch (error) {
        this.log(`Couldn't fetch the print's file (${message(error)}); going on without it.`);
      }
    }
    const payload: JobPayload = { type: "start", job, fileName };
    this.deps.queue.add(payload as unknown as QueuedJob, bytes);
    this.kick();
  }

  private async onEnded(job: Job, result: EndResult, endedAt: number, spaghetti: boolean) {
    this.log(`The print ended (${result}): "${job.name}".`);
    const payload: JobPayload = { type: "end", job, endedAt, suggestedTag: suggestTag(result, spaghetti) };
    this.deps.queue.add(payload as unknown as QueuedJob);
    this.kick();
    void this.sendStatus();
    if (!this.deps.camera) return;
    const frame = await this.deps.camera.grab().catch(() => null);
    if (frame) {
      const photo: JobPayload = { type: "photo", job, takenAt: this.deps.now() };
      this.deps.queue.add(photo as unknown as QueuedJob, frame);
      this.kick();
    }
  }

  private scheduleAms() {
    if (!this.state.complete) return;
    // The level is only four buckets in the app, so a tray's 1% steps aren't changes.
    const trays = traysOf(this.state.print).map((tray) => ({
      ...tray,
      remain: tray.remain === null ? null : remainingFrom(tray.remain),
    }));
    const hash = JSON.stringify(trays);
    if (hash === this.deps.store.data.amsHash) return;
    clearTimeout(this.amsTimer);
    this.amsTimer = setTimeout(() => {
      if (this.stopped) return;
      this.deps.store.data.amsHash = hash;
      this.deps.store.save();
      const live = traysOf(this.state.print);
      this.deps.queue.add({ type: "ams", trays: live } as unknown as QueuedJob, undefined, "ams");
      this.kick();
    }, this.deps.amsDelayMs);
  }

  /** Tells the app the bridge is alive and how the print is going. */
  async sendStatus(): Promise<void> {
    const body = this.statusBody();
    try {
      await this.deps.api.tell(body);
      if (this.lastStatusFailed) this.log("Reached the app again.");
      this.lastStatusFailed = false;
    } catch (error) {
      if (!this.lastStatusFailed) this.log(`Can't reach the app (${message(error)}); events are kept and sent later.`);
      this.lastStatusFailed = true;
    }
  }

  statusBody(): UpdateBridgeRequest {
    const print = this.state.print;
    if (!this.connected || !this.state.complete) return { printerState: "offline", progress: null };
    const printerState = STATE_NAMES[print.gcode_state ?? ""] ?? "idle";
    const current = this.machine.current;
    const ref = current ? this.deps.store.attemptFor(current.key) : undefined;
    const progress = progressOf(print);
    if (this.machine.isPrinting(this.state) && ref && !ref.todo && progress) {
      return { printerState, progress: { attemptId: ref.attemptId, ...progress } };
    }
    return { printerState, progress: null };
  }

  private kick() {
    if (this.draining || this.stopped) return;
    this.draining = true;
    void this.drain().finally(() => {
      this.draining = false;
    });
  }

  /** Sends queued jobs in order. A job the app can't take now is retried with backoff; one it refuses for good is set aside. */
  private async drain() {
    let wait = this.deps.backoffMs;
    for (;;) {
      if (this.stopped) return;
      const entry = this.deps.queue.next();
      if (!entry) return;
      try {
        await this.run(entry.job, this.deps.queue.bytes(entry));
        this.deps.queue.done(entry);
        wait = this.deps.backoffMs;
      } catch (error) {
        if (error instanceof HttpError && !error.retryable) {
          this.log(`The app refused ${entry.job.type} for good (${error.message}); set aside in failed/.`);
          this.deps.queue.fail(entry);
          continue;
        }
        this.log(`Couldn't send ${entry.job.type} (${message(error)}); trying again in ${Math.round(wait / 1000)} s.`);
        await sleep(wait);
        wait = Math.min(this.deps.maxBackoffMs, wait * 2);
      }
    }
  }

  private async run(job: QueuedJob, bytes: Uint8Array | undefined) {
    const payload = job as unknown as JobPayload;
    switch (payload.type) {
      case "start":
        return startJob(this.context, payload, bytes);
      case "end":
        return endJob(this.context, payload);
      case "photo":
        return photoJob(this.context, payload, bytes);
      case "ams":
        return amsJob(this.context, payload);
    }
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
