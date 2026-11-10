import { useEffect, useRef, useState } from "react";
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
