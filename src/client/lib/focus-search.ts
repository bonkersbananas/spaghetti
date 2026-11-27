/** The search box's id, so "/" can focus it from anywhere. */
export const SEARCH_BOX_ID = "search-box";

/** Focuses the search box once it is on the page. Its own file: the shell needs it on every screen, the rest of lib/search only on Search. */
export function focusSearch() {
  requestAnimationFrame(() => document.getElementById(SEARCH_BOX_ID)?.focus());
}
