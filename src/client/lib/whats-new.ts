import { parseNotes, sentenceFor } from "@shared/whats-new";

/** The page's own version: the entry script it was loaded from. */
const ownEntry = () => document.querySelector("script[type=module][src]")?.getAttribute("src");

/**
 * What changed for the person, in a sentence, from /whats-new.json (never cached: the ship rewrites it). Undefined
 * when the file isn't there (local builds, Docker, a failed fetch) or says nothing newer.
 */
export async function fetchSentence(timeoutMs = 1000): Promise<string | undefined> {
  try {
    const response = await fetch("/whats-new.json", { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return undefined;
    return sentenceFor(parseNotes(await response.json()), ownEntry());
  } catch {
    return undefined;
  }
}
