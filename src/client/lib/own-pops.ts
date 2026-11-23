/**
 * History steps that belong to something on the page, not to the router: a photo opened large adds an entry of its
 * own so that Back closes it (ui/LargePhotos.tsx). Its pop must never reach the router, which would load the page
 * again and put back old scroll positions. Window listeners run in the order they were added, so this one is added
 * before the router makes its history (main.tsx), and stops the pops something has claimed.
 */
type Claim = (event: PopStateEvent) => boolean;
const claims = new Set<Claim>();

export function catchOwnPops() {
  window.addEventListener("popstate", (event) => {
    for (const claim of claims) {
      if (claim(event)) {
        event.stopImmediatePropagation();
        return;
      }
    }
  });
}

/** Claims the pops `claim` says are its own (it returns true for them) until the returned function is called. */
export function claimPops(claim: Claim): () => void {
  claims.add(claim);
  return () => claims.delete(claim);
}
