/** The bridge's small state file: which print it is following and which attempt each print became. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AttemptSettings } from "../src/shared/attempts.ts";
import type { TrackedJob } from "./job-machine.ts";

export interface AttemptRef {
  itemId: string;
  attemptId: string;
  /** Decided but not yet done: written down first, so a retry does the same thing instead of deciding again. */
  todo?: { createItem: { title: string | null } | null; settings?: AttemptSettings; printedAt: number };
}

export interface StoredState {
  version: 1;
  /** The print being followed (or the last one, once ended). */
  current: TrackedJob | null;
  /** What each print became, newest last, so a later message about it finds its attempt. */
  attempts: Record<string, AttemptRef>;
  /** The AMS as last synced, to send it again only when it changes. */
  amsHash: string | null;
  /** The printer's certificates by service (SHA-256 fingerprints), pinned on first use; see pin.ts. */
  certs: Partial<Record<"mqtt" | "ftps" | "camera", string>>;
}

const KEEP_ATTEMPTS = 30;

export class Store {
  data: StoredState;
  private path: string;

  constructor(path: string) {
    this.path = path;
    this.data = { version: 1, current: null, attempts: {}, amsHash: null, certs: {} };
    try {
      const saved = JSON.parse(readFileSync(path, "utf8")) as Partial<StoredState>;
      if (saved.version === 1) this.data = { ...this.data, ...saved };
    } catch {
      // No file yet, or one we can't read: start empty. A restart then costs at most a repeated start,
      // which the deterministic ids turn into the same attempt.
    }
  }

  /** The pinned certificates, for `CertPin`. */
  get certs() {
    return this.data.certs;
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(temporary, this.path);
  }

  attemptFor(jobKey: string): AttemptRef | undefined {
    return this.data.attempts[jobKey];
  }

  rememberAttempt(jobKey: string, ref: AttemptRef) {
    const entries = Object.entries({ ...this.data.attempts, [jobKey]: ref });
    this.data.attempts = Object.fromEntries(entries.slice(-KEEP_ATTEMPTS));
    this.save();
  }
}
