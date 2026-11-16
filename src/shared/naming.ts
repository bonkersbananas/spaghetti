/**
 * When the screens show that Claude is naming an idea (decision 0071): the Worker (which reports a job as done past
 * the timeout) and the lazy `NamingSign` (cards, the idea page) read it here; the Journal's rows keep a written-out
 * copy of the timeout, which test/unit/naming.test.ts holds equal. Without imports, so it adds only itself.
 */

/** How long the screens show "Naming…" at most: past it, the idea reads as untitled again. */
export const NAMING_TIMEOUT_MS = 15_000;

/**
 * Until when an idea shows that Claude is naming it (epoch ms), or null when it doesn't: the server says so
 * (`Item.titleJob`, from the moment the capture is saved) while the idea has no title, and the sign stops a while after.
 */
export function namingUntil(item: {
  title: string | null;
  titleJob?: { status: "naming" | "done"; since: number } | null;
}): number | null {
  if (item.title?.trim() || item.titleJob?.status !== "naming") return null;
  return item.titleJob.since + NAMING_TIMEOUT_MS;
}
