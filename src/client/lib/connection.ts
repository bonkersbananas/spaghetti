import { useSyncExternalStore } from "react";

/**
 * Whether the server can be reached, as best we can tell. `navigator.onLine`
 * only knows about the network card, not about a dead hotspot, so a failed
 * request counts too, and while "offline" a quiet probe waits for the
 * server to come back. The app shows this in one place (OfflineNotice).
 */
let online = typeof navigator === "undefined" ? true : navigator.onLine;
const listeners = new Set<() => void>();
let probe: ReturnType<typeof setTimeout> | undefined;

function set(next: boolean) {
  if (next === online) return;
  online = next;
  clearTimeout(probe);
  if (!online) scheduleProbe();
  for (const listener of listeners) listener();
}

function scheduleProbe() {
  probe = setTimeout(async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (response.ok) return set(true);
    } catch {
      // Still offline.
    }
    if (!online) scheduleProbe();
  }, 8000);
}

/** A request got an answer from the server (any status). */
export const reportReachable = () => {
  // A response that finished just after the browser lost its network was already on its way.
  if (navigator.onLine) set(true);
};
/** A request failed before it reached the server. */
export const reportUnreachable = () => set(false);

if (typeof window !== "undefined") {
  window.addEventListener("online", () => set(true));
  window.addEventListener("offline", () => set(false));
  if (!online) scheduleProbe();
}

export const isOnline = () => online;

export function subscribeConnection(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOnline() {
  return useSyncExternalStore(subscribeConnection, isOnline, () => true);
}
