import { useHotkeys } from "./hotkeys";
import { scrollBehavior } from "./motion";

/** Every card or row a list offers, in reading order: the links inside a `data-picks` list on the page. */
function pickables(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("main [data-picks] a[href]")].filter(
    (link) => link.getClientRects().length > 0,
  );
}

/**
 * J and K walk a screen's cards and rows (desktop): each press puts focus, and so the calm focus ring, on the next
 * link, so Enter opens it and Tab carries on from there like it does for a mouse-free person anywhere else. A list
 * takes part by putting `data-picks` on its `<ul>`. Typing and open dialogs are already ignored by `useHotkeys`.
 */
export function useListPicker() {
  const move = (by: 1 | -1) => {
    const links = pickables();
    if (!links.length) return;
    const index = links.findIndex((link) => link === document.activeElement || link.contains(document.activeElement));
    const next =
      links[index === -1 ? (by > 0 ? 0 : links.length - 1) : Math.max(0, Math.min(links.length - 1, index + by))];
    if (!next) return;
    next.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
    next.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  };
  useHotkeys({ listNext: () => move(1), listPrevious: () => move(-1) });
}
