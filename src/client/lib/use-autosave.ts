import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveState } from "@/components/ui/SaveStatus";

const RETRY_MS = [2000, 5000, 10_000, 30_000];

/**
 * Saves `value` a moment after it stops changing, with no save button.
 * Returns the state for <SaveStatus>. Failed saves retry on their own; a
 * change still waiting is sent when the component unmounts or the page hides.
 */
export function useAutosave<T>(value: T, save: (value: T) => Promise<void>, { delay = 600 } = {}): SaveState {
  const [state, setState] = useState<SaveState>("idle");
  const saved = useRef(value);
  const latest = useRef(value);
  const saveRef = useRef(save);
  saveRef.current = save;
  latest.current = value;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attempt = useRef(0);
  const mounted = useRef(true);

  const dirty = () => JSON.stringify(latest.current) !== JSON.stringify(saved.current);

  const flush = useRef(async () => {
    clearTimeout(timer.current);
    if (!dirty()) return;
    const sending = latest.current;
    if (mounted.current) setState("saving");
    try {
      await saveRef.current(sending);
      saved.current = sending;
      attempt.current = 0;
      if (!mounted.current) return;
      if (dirty()) timer.current = setTimeout(() => void flush.current(), delay);
      else setState("saved");
    } catch {
      if (!mounted.current) return;
      setState("error");
      const wait = RETRY_MS[Math.min(attempt.current, RETRY_MS.length - 1)];
      attempt.current += 1;
      timer.current = setTimeout(() => void flush.current(), wait);
    }
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: value is the trigger; the rest lives in refs.
  useEffect(() => {
    if (!dirty()) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush.current(), delay);
  }, [value, delay]);

  useEffect(() => {
    mounted.current = true;
    const onHide = () => void flush.current();
    window.addEventListener("pagehide", onHide);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", onHide);
      void flush.current();
    };
  }, []);

  return state;
}

/**
 * Keeps a field that autosaves in step with the server's copy of it: when
 * the server's value changes (the other person edited it, or what was kept on
 * the device has just been replaced by a fresh answer), the field follows,
 * unless the person has typed something of their own since.
 */
export function useFollowServer(
  server: string,
  local: string,
  setLocal: (value: string) => void,
  onFollow?: (value: string) => void,
) {
  const seen = useRef(server);
  useEffect(() => {
    if (server === seen.current) return;
    if (local === seen.current) {
      setLocal(server);
      onFollow?.(server);
    }
    seen.current = server;
  }, [server, local, setLocal, onFollow]);
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * A form of fields that autosave and follow the server, for a screen with
 * several (a spool, the printer's setup). Each field is its own:
 *
 * - a field the person has typed in keeps their text when the server's copy
 *   changes under it (the other person's edit);
 * - every other field takes the server's new value;
 * - a save sends only the fields changed here, never the ones beside them,
 *   which the other person may have edited meanwhile and would be undone.
 *
 * `server` is the current server copy (from the query); `save` gets just the
 * changed fields. Returns the form's value, a function to change some fields
 * (or compute the change from the current value), and the save state.
 */
export function useLiveFields<T extends Record<string, unknown>>(
  server: T,
  save: (changes: Partial<T>) => Promise<void>,
) {
  const [value, setValue] = useState<T>(server);
  const latest = useRef(value);
  latest.current = value;
  // What the server is known to have (as far as this screen has seen or sent), and what it showed last time.
  const known = useRef<T>(server);
  const seen = useRef<T>(server);

  useEffect(() => {
    const followed: Partial<T> = {};
    for (const key of Object.keys(server) as Array<keyof T>) {
      if (same(server[key], seen.current[key])) continue;
      // Untouched here since it last matched the server: follow. Otherwise it is the person's own text.
      if (same(latest.current[key], seen.current[key])) followed[key] = server[key];
    }
    seen.current = server;
    if (!Object.keys(followed).length) return;
    known.current = { ...known.current, ...followed };
    setValue((current) => ({ ...current, ...followed }));
  }, [server]);

  const change = useCallback((next: Partial<T> | ((current: T) => Partial<T>)) => {
    setValue((current) => ({ ...current, ...(typeof next === "function" ? next(current) : next) }));
  }, []);

  const saveRef = useRef(save);
  saveRef.current = save;
  const saveState = useAutosave(value, async (sending) => {
    const changes: Partial<T> = {};
    for (const key of Object.keys(sending) as Array<keyof T>) {
      if (!same(sending[key], known.current[key])) changes[key] = sending[key];
    }
    if (!Object.keys(changes).length) return;
    await saveRef.current(changes);
    known.current = { ...known.current, ...changes };
  });
  return { value, change, saveState };
}
