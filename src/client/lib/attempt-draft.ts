import type { AttemptDraft } from "./builds";
import type { DraftPhoto } from "./capture";
import { openStore } from "./idb";

/**
 * A new attempt's draft, kept on the device while its sheet is open. iOS may end a Home Screen app's process while the
 * camera is up (more often with a 3D view's WebGL on the page), and the page then loads again from nothing: what was
 * typed, the outcome and the settings come back from here, the photos from IndexedDB (useDraftPhotos with a scope).
 */
type StoredDraft = Omit<AttemptDraft, "photos">;
type KeptDraft = { draft: StoredDraft; when: number | null; savedAt: number; attempts: number };

/** The attempt sheet's photos, apart from the capture sheet's and each marked with the build they are for. */
export const keptAttemptPhotos = openStore<DraftPhoto & { scope: string }>("spaghetti-attempt", "photos", "id");
/** A draft is for the next hours, not the next days: older than this it is dropped, not restored. */
const DRAFT_FRESH_MS = 6 * 60 * 60 * 1000;

const draftKey = (itemId: string) => `spaghetti:attempt-draft:${itemId}`;
const cameraKey = (itemId: string) => `spaghetti:attempt-camera:${itemId}`;
/** A camera that was up this long ago is not why the page loaded again. */
const CAMERA_FRESH_MS = 5 * 60 * 1000;

/** Keeps the draft with when it was saved and how many attempts the build had: logging one makes it stale. */
export function keepAttemptDraft(itemId: string, draft: StoredDraft, when: number | null, attempts: number) {
  try {
    const kept: KeptDraft = { draft, when, savedAt: Date.now(), attempts };
    localStorage.setItem(draftKey(itemId), JSON.stringify(kept));
  } catch {}
}

/** The kept draft, if it is recent and no attempt was logged since; a stale one is dropped (and its photos). */
export function keptAttemptDraft(itemId: string, attempts: number): { draft: StoredDraft; when: number | null } | null {
  let kept: KeptDraft | null = null;
  try {
    const raw = localStorage.getItem(draftKey(itemId));
    kept = raw ? (JSON.parse(raw) as KeptDraft) : null;
  } catch {}
  if (kept?.draft && kept.attempts === attempts && Date.now() - kept.savedAt < DRAFT_FRESH_MS) return kept;
  dropAttemptDraft(itemId);
  return null;
}

/** Wherever an attempt is logged: the draft, its photos and the camera mark go. */
export function dropAttemptDraft(itemId: string) {
  try {
    localStorage.removeItem(draftKey(itemId));
    localStorage.removeItem(cameraKey(itemId));
  } catch {}
  void keptAttemptPhotos
    .all()
    .then((found) =>
      Promise.all(found.filter((photo) => photo.scope === itemId).map((photo) => keptAttemptPhotos.delete(photo.id))),
    )
    .catch(() => undefined);
}

/** The camera is about to open over this build's attempt sheet. */
export function cameraOpening(itemId: string) {
  try {
    localStorage.setItem(cameraKey(itemId), String(Date.now()));
  } catch {
    return;
  }
  // A tap or key press in this very page means nothing was killed (the camera was cancelled, or the photo is here):
  // the mark is no longer true. A page that was killed has no listener left, and its mark stays for the next load.
  const back = () => {
    window.removeEventListener("pointerdown", back);
    window.removeEventListener("keydown", back);
    cameraArrived(itemId);
  };
  window.addEventListener("pointerdown", back);
  window.addEventListener("keydown", back);
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
