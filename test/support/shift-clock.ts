/**
 * Audit tool for tests that depend on the time of day or the date: `FAKE_NOW=2026-12-31T23:30:00Z pnpm test`
 * runs the suite with the clock moved to that moment (it keeps running; only its start is shifted), so a test that
 * passes at noon and fails at night, or on a Monday, or across New Year, shows up in one run instead of in CI.
 * Without FAKE_NOW nothing changes.
 */
export function shiftClock(start: string | undefined) {
  if (!start) return;
  const target = Date.parse(start);
  if (Number.isNaN(target)) throw new Error(`FAKE_NOW isn't a date: ${start}`);
  const RealDate = Date;
  const offset = target - RealDate.now();
  globalThis.Date = class extends RealDate {
    constructor(...args: unknown[]) {
      // @ts-expect-error: spreads the arguments of the original constructor
      super(...(args.length ? args : [RealDate.now() + offset]));
    }
    static override now() {
      return RealDate.now() + offset;
    }
  } as DateConstructor;
}
