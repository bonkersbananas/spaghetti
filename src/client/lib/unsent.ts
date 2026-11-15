/**
 * Text typed into an autosaving field and not yet on the server, kept on this device (localStorage) so that a page
 * killed before the save went through (a phone app switch with no signal, a crash) gets it back on the next visit.
 * lib/use-autosave.ts writes it as the field changes and clears it once saved.
 */
const PREFIX = "spaghetti:unsent:";
/** Older than this, it is left alone: the other person has surely moved on. */
const KEEP_MS = 24 * 60 * 60 * 1000;

export function keepUnsent(name: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + name);
    else localStorage.setItem(PREFIX + name, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // Private mode or storage full: the change still saves as usual.
  }
}

/** What was left unsent under `name`, if it is recent. */
export function unsent<T>(name: string): T | undefined {
  try {
    const stored = localStorage.getItem(PREFIX + name);
    if (!stored) return undefined;
    const { at, value } = JSON.parse(stored) as { at: number; value: T };
    if (Date.now() - at > KEEP_MS) {
      localStorage.removeItem(PREFIX + name);
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}
