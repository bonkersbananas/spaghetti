/**
 * Raising the keyboard on a phone for a field that isn't on the page yet.
 *
 * iOS Safari (and a Home Screen app) only raises the keyboard for a focus made inside the tap's own gesture: a
 * field focused later (once a lazy sheet has loaded and slid up, once a route's code has arrived) gets the caret but
 * no keyboard. So the tap focuses a stand-in field at once, which raises the keyboard, and the real field takes the
 * focus from it when it is ready: iOS keeps the keyboard up when focus moves from one text field to another.
 *
 * The stand-in (styled in app.css) is invisible, hidden from screen readers, 16 px (iOS zooms the page into smaller
 * text) and fixed at the top of the screen (nothing scrolls to it). It goes as soon as it loses the focus, and on its own after a while
 * if nothing takes the focus from it, so the keyboard never stays up over a page with nothing to type into. (The capture
 * sheet carries what was typed into it meanwhile into its note.)
 *
 * Only where the pointer is coarse (phones, tablets): a laptop's focus never raises a keyboard. Every screen loads
 * this (the tab bar), so it stays small.
 */

/** Longest the stand-in holds the keyboard for a field that never comes. */
const HOLD_MS = 2500;

let proxy: HTMLInputElement | null = null;
/** What had the focus before the tap, for a sheet to give it back when it closes. */
let before: Element | null = null;

/**
 * Call inside a tap's click handler, before the state change that brings the field: focuses the stand-in so the
 * keyboard comes up now. Does nothing where the pointer is fine.
 */
export function holdKeyboard() {
  if (!matchMedia("(pointer: coarse)").matches) return;
  releaseKeyboard();
  before = document.activeElement;
  const input = document.createElement("input");
  proxy = input;
  input.setAttribute("data-keyboard-proxy", "");
  input.setAttribute("aria-hidden", "true");
  input.tabIndex = -1;
  // Drawn by app.css: invisible, fixed at the top, 16 px.
  input.onblur = () => {
    input.remove();
    if (proxy === input) proxy = null;
  };
  document.body.append(input);
  input.focus({ preventScroll: true });
  setTimeout(() => proxy === input && releaseKeyboard(), HOLD_MS);
}

/** The stand-in, while it has the focus (the keyboard is up for a field still to come). */
export const keyboardProxy = () => (proxy && document.activeElement === proxy ? proxy : null);

/** What had the focus before the tap that raised the stand-in. */
export const heldFrom = () => (before instanceof HTMLElement && before !== document.body ? before : null);

/** Lets the keyboard go down: the stand-in loses the focus and leaves the page. */
export function releaseKeyboard() {
  const input = proxy;
  proxy = null;
  input?.blur();
  input?.remove();
}
