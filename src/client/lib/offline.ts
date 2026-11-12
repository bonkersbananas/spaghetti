import { toast } from "@/components/ui/Toast";
import { clearPersistedQueries } from "./persist";

/** The service worker's caches of what came from the server or a share (src/sw/sw.js, lib/share.ts). */
const DEVICE_CACHES = ["sg-photos", "sg-share"];
/** What the device remembers of the workspace: the palette's recent items (lib/recent.ts) and searches (lib/search.ts). */
const REMEMBERED_KEYS = ["sg-recent-items", "sg-recent-searches"];

/**
 * Forgets what was kept of the workspace on this device: the offline copy, the photos, a share on its way and the
 * recent lists. Signing out calls it, and so does a session the server ended: the next person to use this device
 * sees none of it. Work not yet sent (the outbox, drafts being typed) stays, to be sent by whoever signs in.
 */
export async function clearOfflineData() {
  await clearPersistedQueries();
  for (const key of REMEMBERED_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Private mode: nothing was remembered.
    }
  }
  for (const name of DEVICE_CACHES) {
    try {
      await caches.delete(name);
    } catch {
      // No Cache Storage here (or a private window): nothing was kept.
    }
  }
}

/**
 * Registers the service worker (built apps only; `vite dev` has none) and
 * watches for a new version: it installs in the background, then a quiet
 * toast offers "Refresh". Without a tap, it takes over once the app has been
 * closed and opened again.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  let refreshing = false;
  // The first worker claiming the page is not an update; only reload after a tap.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) location.reload();
  });
  const offerRefresh = (worker: ServiceWorker) =>
    toast.update(() => {
      refreshing = true;
      worker.postMessage("SKIP_WAITING");
    });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) offerRefresh(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) offerRefresh(worker);
          });
        });
        // Look for a new version when the app comes back to the front.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void registration.update().catch(() => undefined);
        });
      })
      .catch((error) => console.error("The service worker didn't register", error));
  });
}
