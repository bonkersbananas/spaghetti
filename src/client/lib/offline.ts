import { toast } from "@/components/ui/Toast";

/** The service worker's cache of photos already seen (src/sw/sw.js). */
const PHOTO_CACHE = "sg-photos";

/** Forgets what was kept for offline use. Signing out calls it: the next person to use this device sees none of it. */
export async function clearOfflineData() {
  try {
    await caches.delete(PHOTO_CACHE);
  } catch {
    // No Cache Storage here (or a private window): nothing was kept.
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
