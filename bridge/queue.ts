/**
 * Events that must not be lost wait here, on disk, until the app has them: one JSON file per job, in order, with
 * the bytes of a file or a photo beside it. A job that the app can't take now is retried with backoff; a job it
 * refuses for good is moved aside to `failed/` so it can't block the ones behind it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface QueuedJob {
  /** Which job this is; the executor switches on it. */
  type: string;
  [key: string]: unknown;
}

interface Entry {
  name: string;
  job: QueuedJob;
}

export class Queue {
  private dir: string;
  private counter = 0;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(join(dir, "failed"), { recursive: true });
    const last = readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => Number.parseInt(file, 10))
      .reduce((max, n) => Math.max(max, n), 0);
    this.counter = last;
  }

  /**
   * Adds a job, with bytes if it has them (the file or photo they belong to). `replaces` drops waiting jobs of that
   * type first: the latest AMS state makes older ones pointless.
   */
  add(job: QueuedJob, blob?: Uint8Array, replaces?: string): void {
    if (replaces) for (const entry of this.entries()) if (entry.job.type === replaces) this.remove(entry);
    const name = `${String(++this.counter).padStart(8, "0")}-${job.type}`;
    if (blob) {
      writeFileSync(join(this.dir, `${name}.bin`), blob);
      job = { ...job, blob: `${name}.bin` };
    }
    // The job file appears whole or not at all, so a crash never leaves half a job.
    writeFileSync(join(this.dir, `${name}.json.tmp`), JSON.stringify(job));
    renameSync(join(this.dir, `${name}.json.tmp`), join(this.dir, `${name}.json`));
  }

  /** The oldest waiting job. */
  next(): Entry | undefined {
    return this.entries()[0];
  }

  get size(): number {
    return this.entries().length;
  }

  bytes(entry: Entry): Uint8Array | undefined {
    const blob = entry.job.blob;
    return typeof blob === "string" && existsSync(join(this.dir, blob))
      ? readFileSync(join(this.dir, blob))
      : undefined;
  }

  done(entry: Entry): void {
    this.remove(entry);
  }

  /** Puts a refused job aside, with its bytes, for a person to look at. */
  fail(entry: Entry): void {
    renameSync(join(this.dir, `${entry.name}.json`), join(this.dir, "failed", `${entry.name}.json`));
    const blob = entry.job.blob;
    if (typeof blob === "string" && existsSync(join(this.dir, blob))) {
      renameSync(join(this.dir, blob), join(this.dir, "failed", blob));
    }
  }

  private remove(entry: Entry) {
    rmSync(join(this.dir, `${entry.name}.json`), { force: true });
    if (typeof entry.job.blob === "string") rmSync(join(this.dir, entry.job.blob), { force: true });
  }

  private entries(): Entry[] {
    return readdirSync(this.dir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .flatMap((file) => {
        try {
          return [
            {
              name: file.slice(0, -".json".length),
              job: JSON.parse(readFileSync(join(this.dir, file), "utf8")) as QueuedJob,
            },
          ];
        } catch {
          return [];
        }
      });
  }
}
