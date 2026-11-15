import { useCallback } from "react";

/**
 * The classic tall sticky column (`sticky-column` in tokens.css reads `--sticky-top`): a column that fits the window
 * sticks 1.5 rem from the top; a taller one gets a negative top, window height minus its own height minus 1.5 rem,
 * so it scrolls with the page until its end is in view and then sticks there, and nothing is out of reach and
 * nothing scrolls inside it. Measured on the column's own size changes and when the window is resized. A ref
 * callback, so a column that appears later (an idea's first photo) is measured when it does.
 */
export function useStickyColumn() {
  return useCallback((column: HTMLElement | null) => {
    if (!column) return;
    // Sticky only from 48 rem (tokens.css): a phone measures nothing, which would force a layout in the middle of the
    // page's first commit (a tap on an idea spent 13 ms on it); turning the phone sideways triggers a resize.
    const wide = window.matchMedia("(min-width: 48rem)");
    const place = () => {
      if (!wide.matches) return;
      column.style.setProperty("--sticky-top", `${Math.min(24, window.innerHeight - column.offsetHeight - 24)}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(column);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, []);
}
