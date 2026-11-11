/**
 * Notices that the computer slept. A timer that should fire every few seconds fires late by about as long as the
 * sleep; then the printer connection is probably dead (the network went away) and a fresh status is wanted. Plain
 * timers, so it works the same on every system and in a test with fake clocks.
 */
export interface WakeOptions {
  /** How often to look. */
  everyMs?: number;
  /** A gap longer than this between two looks means the computer slept. */
  gapMs?: number;
  now?: () => number;
}

export function watchForWake(onWake: (sleptMs: number) => void, options: WakeOptions = {}): () => void {
  const every = options.everyMs ?? 5_000;
  const gap = options.gapMs ?? 20_000;
  const now = options.now ?? Date.now;
  let last = now();
  const timer = setInterval(() => {
    const t = now();
    const slept = t - last;
    last = t;
    if (slept > gap) onWake(slept);
  }, every);
  timer.unref?.();
  return () => clearInterval(timer);
}
