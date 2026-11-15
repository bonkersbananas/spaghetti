import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveState } from "@/components/ui/SaveStatus";
import { ApiError } from "./api";
import { keepUnsent, unsent } from "./unsent";

const RETRY_MS = [2000, 5000, 10_000, 30_000];

/**
 * Saves `value` a moment after it stops changing, with no save button.
 * Returns the state for <SaveStatus>. Failed saves retry on their own; a
 * change still waiting is sent when the component unmounts or the page hides.
 */
export function useAutosave<T>(
  value: T,
  save: (value: T) => Promise<void>,
  {
    delay = 600,
    from,
    keepAs,
  }: {
    delay?: number;
    /** What the server has when the field opens, if that isn't `value` (text kept from an earlier visit is unsent). */
    from?: T;
    /** A name to keep an unsent change under on this device, until it is saved (see lib/unsent.ts). */
    keepAs?: string;
  } = {},
): SaveState {
  const [state, setState] = useState<SaveState>("idle");
  const saved = useRef(from ?? value);
  const latest = useRef(value);
  const saveRef = useRef(save);
  saveRef.current = save;
  latest.current = value;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attempt = useRef(0);
  const mounted = useRef(true);

  const dirty = () => JSON.stringify(latest.current) !== JSON.stringify(saved.current);
  // A change not yet saved is also on the device: a page killed in the background (a phone, no signal) loses nothing.
  const keepRef = useRef(keepAs);
  keepRef.current = keepAs;
  const remember = () => {
    if (keepRef.current) keepUnsent(keepRef.current, dirty() ? latest.current : undefined);
  };

  // One save at a time: a second request sent while the first is still on its way can reach the server first,
  // and the older text would then win. The next one starts when the one in flight has settled.
  const running = useRef<Promise<void> | null>(null);

  const flush = useRef((): Promise<void> => {
    clearTimeout(timer.current);
    if (running.current) return running.current;
    if (!dirty()) return Promise.resolve();
    // Typed during a save that went through, with the screen gone: sent once the save has settled.
    let again = false;
    const run = (async () => {
      const sending = latest.current;
      if (mounted.current) setState("saving");
      try {
        await saveRef.current(sending);
        saved.current = sending;
        attempt.current = 0;
        remember();
        if (dirty()) {
          // Typed since: a mounted field waits for a pause in the typing, one that is gone sends at once.
          if (mounted.current) timer.current = setTimeout(() => void flush.current(), delay);
          else again = true;
        } else if (mounted.current) setState("saved");
      } catch (error) {
        // A request the server answered with a refusal won't succeed by repeating it, and nobody is left to see it.
        if (!mounted.current && error instanceof ApiError && error.status < 500 && error.status !== 429) return;
        if (mounted.current) setState("error");
        const wait = RETRY_MS[Math.min(attempt.current, RETRY_MS.length - 1)];
        attempt.current += 1;
        // Also after the screen is gone: what was typed there is only in this closure, so it keeps trying.
        timer.current = setTimeout(() => void flush.current(), wait);
      }
    })().finally(() => {
      running.current = null;
      if (again) void flush.current();
    });
    running.current = run;
    return run;
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: value is the trigger; the rest lives in refs.
  useEffect(() => {
    remember();
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
  {
    delay,
    hold = false,
    keepAs,
  }: {
    /** How long after the last change a save goes (`useAutosave`'s default otherwise). */
    delay?: number;
    /** Keep what is typed here without saving it (a print being finished with no connection waits for its button). */
    hold?: boolean;
    /** A name to keep the fields typed here and not yet saved under, on this device (lib/unsent.ts). */
    keepAs?: string;
  } = {},
) {
  // What an earlier visit left unsent (the page died before the save went through): back in the fields, to be saved.
  const [left] = useState(() => (keepAs ? unsent<Partial<T>>(keepAs) : undefined));
  const [value, setValue] = useState<T>(left ? { ...server, ...left } : server);
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

  // Only the fields changed here are kept, never the ones beside them (the other person may have edited those).
  const remember = () => {
    // Held text goes out another way (a finish waiting for its button), and would come back as an old edit.
    if (!keepAs || hold) return;
    const changed: Partial<T> = {};
    for (const key of Object.keys(latest.current) as Array<keyof T>) {
      if (!same(latest.current[key], known.current[key])) changed[key] = latest.current[key];
    }
    keepUnsent(keepAs, Object.keys(changed).length ? changed : undefined);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: value is the trigger; the rest lives in refs.
  useEffect(remember, [value]);

  const saveRef = useRef(save);
  saveRef.current = save;
  // While held, autosave keeps seeing what it saw last, so nothing is sent until the hold ends.
  // Text kept from an earlier visit isn't "seen" yet: the hold ends with it still to send.
  const held = useRef(left ? server : value);
  if (!hold) held.current = value;
  const saveState = useAutosave(
    hold ? held.current : value,
    async (sending) => {
      const changes: Partial<T> = {};
      for (const key of Object.keys(sending) as Array<keyof T>) {
        if (!same(sending[key], known.current[key])) changes[key] = sending[key];
      }
      if (!Object.keys(changes).length) return;
      await saveRef.current(changes);
      known.current = { ...known.current, ...changes };
      remember();
    },
    { ...(delay === undefined ? {} : { delay }), from: server },
  );
  return { value, change, saveState };
}
