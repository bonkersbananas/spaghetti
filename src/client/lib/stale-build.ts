/**
 * A page still running an old build (the Home Screen app stays suspended in memory for days) imports a route chunk
 * the new deploy no longer has. The Worker answers that with a 404 (src/worker/spa.ts); here the app takes the
 * new version once instead of showing an error. At most one reload a minute (sessionStorage), so a chunk that is
 * really broken can't loop. Nothing is lost: drafts and the outbox live on the server and in IndexedDB.
 */
const KEY = "sg-stale-reload";
const GAP_MS = 60_000;

/** Reloads into the new version unless it just did. The old service worker would serve the old shell again, so a new one waiting takes over first. */
export async function reloadIntoNewBuild() {
  if (Date.now() - Number(sessionStorage.getItem(KEY)) < GAP_MS) return;
  sessionStorage.setItem(KEY, String(Date.now()));
  const registration = await navigator.serviceWorker?.getRegistration();
  await registration?.update().catch(() => undefined);
  registration?.waiting?.postMessage("SKIP_WAITING");
  setTimeout(() => location.reload(), registration?.waiting ? 800 : 0);
}
