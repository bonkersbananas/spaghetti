/** Which files have built themselves up on this device already: the delight is for the first open only. */
const KEY = "sg-viewer-intro";
const MAX = 60;

function read(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function introSeen(fileId: string): boolean {
  return read().includes(fileId);
}

export function markIntroSeen(fileId: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...read().filter((id) => id !== fileId), fileId].slice(-MAX)));
  } catch {
    // Private mode: the print simply builds up again next time.
  }
}
