import { useHotkeys } from "./hotkeys";

/**
 * J and K walk a screen's cards and rows (desktop): each press focuses the next link inside a `data-picks` list, so
 * the focus ring shows, Enter opens it and Tab carries on from there. Typing and open dialogs are ignored by
 * `useHotkeys`.
 */
export function useListPicker() {
  const move = (by: number) => {
    const links = [...document.querySelectorAll<HTMLElement>("main [data-picks] a[href]")].filter(
      (a) => a.offsetParent,
    );
    const at = links.findIndex((a) => a.contains(document.activeElement));
    const next = links[at < 0 ? (by > 0 ? 0 : links.length - 1) : Math.min(links.length - 1, Math.max(0, at + by))];
    // Focusing scrolls the card into view.
    next?.focus();
  };
  useHotkeys({ listNext: () => move(1), listPrevious: () => move(-1) });
}
