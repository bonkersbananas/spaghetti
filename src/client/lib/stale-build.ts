/**
 * A page still running an old build (the Home Screen app stays suspended in memory for days) imports a route chunk
 * the new deploy no longer has. The Worker answers that with a 404 (src/worker/spa.ts); here the app takes the
 * new version once instead of showing an error. At most one reload a minute (sessionStorage), so a chunk that is
 * really broken can't loop. Nothing is lost: drafts and the outbox live on the server and in IndexedDB.
 */
const KEY = "sg-stale-reload";
const GAP_MS = 60_000;

/**
 * Whether the server's app is a different build from this page's: its index.html names another entry script. A chunk
 * that failed with no new build out (no connection, a blocked request) is not for a reload: the screen that asked for it
 * says what went wrong itself ("needs a connection", Try again).
 */
async function isNewBuildOut() {
  try {
    const entry = document.querySelector<HTMLScriptElement>("script[type=module][src]")?.getAttribute("src");
    const html = await (await fetch("/?shell", { cache: "no-store" })).text();
    return !!entry && !html.includes(entry);
  } catch {
    return false;
  }
}

/**
 * Reloads into the new version unless it just did or there is no new build; returns whether it is reloading. The old service worker would serve the old shell again, so a new
 * one takes over first: update() resolves when it starts installing, so wait (up to 5 s) until it is installed, tell
 * it to take over, and wait (up to 3 s) for it to become the controller.
 */
export async function reloadIntoNewBuild(): Promise<boolean> {
  if (Date.now() - Number(sessionStorage.getItem(KEY)) < GAP_MS) return false;
  if (!(await isNewBuildOut())) return false;
  sessionStorage.setItem(KEY, String(Date.now()));
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.update();
    const installing = registration?.installing;
    if (installing) {
      await new Promise<void>((done) => {
        setTimeout(done, 5000);
        installing.addEventListener("statechange", () => installing.state !== "installing" && done());
      });
    }
    const waiting = registration?.waiting;
    if (waiting) {
      await new Promise<void>((done) => {
        setTimeout(done, 3000);
        navigator.serviceWorker.addEventListener("controllerchange", () => done(), { once: true });
        waiting.postMessage("SKIP_WAITING");
      });
    }
  } catch {
    // No service worker, or no network: reload anyway.
  }
  location.reload();
  return true;
}
