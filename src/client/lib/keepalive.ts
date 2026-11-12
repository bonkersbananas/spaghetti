/**
 * Which writes may ask the browser to finish them after the page is gone.
 *
 * A plain fetch is cancelled when the page unloads (a reload, or a swipe away on an iPhone Home Screen app), while
 * the screen already shows the change (optimistic updates). `keepalive: true` lets the request finish. Browsers
 * allow only 64 KiB of keepalive bodies in flight at once (the Fetch spec's quota; Chrome and Safari enforce it, a
 * request over it rejects with a TypeError), so small bodies get it and a request that wouldn't fit goes out as a
 * normal fetch. Safari has supported keepalive since 13:
 * https://developer.mozilla.org/en-US/docs/Web/API/Request/keepalive#browser_compatibility
 */

/** The spec's quota is 64 KiB; stay well under it, as headers count too. */
export const KEEPALIVE_TOTAL = 48 * 1024;
/** One request's share: a few big bodies must not starve the small taps. */
export const KEEPALIVE_EACH = 16 * 1024;
/** What a request without a body costs (its URL and headers). */
const OVERHEAD = 1024;

let inFlight = 0;

export function keepaliveInFlight() {
  return inFlight;
}

/** The bytes a request would use: its body when it is a string (JSON), or nothing; null for bodies that can't be sized (uploads). */
export function keepaliveCost(body: unknown): number | null {
  if (body === undefined || body === null) return OVERHEAD;
  if (typeof body !== "string") return null;
  if (body.length > KEEPALIVE_EACH) return null;
  return new TextEncoder().encode(body).length + OVERHEAD;
}

/**
 * Takes a share of the budget for a request. Returns a release function to call when the request settles, or null
 * when it shouldn't be keepalive (too big, or the quota is used up).
 */
export function reserveKeepalive(body: unknown): (() => void) | null {
  const cost = keepaliveCost(body);
  if (cost === null || cost > KEEPALIVE_EACH || inFlight + cost > KEEPALIVE_TOTAL) return null;
  inFlight += cost;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight -= cost;
  };
}

/**
 * Calls that carry a sign-in, a passkey ceremony or an authorisation keep a normal fetch: the page waits for their
 * answer (a cookie, a redirect) and there is nothing to finish after it is gone. Uploads (photos, slicer files,
 * profile pictures) are FormData or Blob bodies and never qualify, and big ones wouldn't fit the quota anyway.
 */
const NORMAL_FETCH = /^\/(session|join|oauth)(\/|\?|$)|^\/account\/(password|passkeys\/options|passkeys$)/;

export function wantsKeepalive(method: string | undefined, path: string): boolean {
  const verb = (method ?? "GET").toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return false;
  return !NORMAL_FETCH.test(path.split("?")[0] ?? path);
}
