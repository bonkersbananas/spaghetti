import type { AttemptDraft } from "./builds";

/**
 * A new attempt's draft, kept on the device while its sheet is open. iOS may end a Home Screen app's process while the
 * camera is up (more often with a 3D view's WebGL on the page), and the page then loads again from nothing: what was
 * typed, the outcome and the settings come back from here, the photos from IndexedDB (useDraftPhotos with a scope).
 */
type StoredDraft = Omit<AttemptDraft, "photos">;

const draftKey = (itemId: string) => `spaghetti:attempt-draft:${itemId}`;
const cameraKey = (itemId: string) => `spaghetti:attempt-camera:${itemId}`;
/** A camera that was up this long ago is not why the page loaded again. */
const CAMERA_FRESH_MS = 15 * 60 * 1000;

export function keepAttemptDraft(itemId: string, draft: StoredDraft) {
  try {
    localStorage.setItem(draftKey(itemId), JSON.stringify(draft));
  } catch {}
}

export function keptAttemptDraft(itemId: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(itemId));
    return raw ? (JSON.parse(raw) as StoredDraft) : null;
  } catch {
    return null;
  }
}

export function dropAttemptDraft(itemId: string) {
  try {
    localStorage.removeItem(draftKey(itemId));
    localStorage.removeItem(cameraKey(itemId));
  } catch {}
}

/** The camera is about to open over this build's attempt sheet. */
export function cameraOpening(itemId: string) {
  try {
    localStorage.setItem(cameraKey(itemId), String(Date.now()));
  } catch {
    return;
  }
  // Back from the camera in the same page (nothing was killed): the mark is no longer true, once the photo has had a
  // moment to arrive. A page that was killed has no listener left, and its mark stays for the next load.
  const back = () => {
    if (document.visibilityState === "hidden") return;
    document.removeEventListener("visibilitychange", back);
    window.removeEventListener("focus", back);
    setTimeout(() => cameraArrived(itemId), 4000);
  };
  document.addEventListener("visibilitychange", back);
  window.addEventListener("focus", back);
}

/** The photo (or its cancelling) came back to this page. */
export function cameraArrived(itemId: string) {
  try {
    localStorage.removeItem(cameraKey(itemId));
  } catch {}
}

/** Whether the page loaded again while that camera was up: the sheet should open again where it was. */
export function cameraWasUp(itemId: string): boolean {
  try {
    const at = Number(localStorage.getItem(cameraKey(itemId)));
    cameraArrived(itemId);
    return at > 0 && Date.now() - at < CAMERA_FRESH_MS;
  } catch {
    return false;
  }
}
