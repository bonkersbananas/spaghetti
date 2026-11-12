import { useEffect, useRef } from "react";

/**
 * The classic tall sticky column (`sticky-column` in tokens.css reads `--sticky-top`): a column that fits the window
 * sticks 1.5 rem from the top; a taller one gets a negative top, window height minus its own height minus 1.5 rem,
 * so it scrolls with the page until its end is in view and then sticks there, and nothing is out of reach and
 * nothing scrolls inside it. Measured on the column's own size changes and when the window is resized.
 */
export function useStickyColumn<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const column = ref.current;
    if (!column) return;
    const place = () =>
      column.style.setProperty("--sticky-top", `${Math.min(24, window.innerHeight - column.offsetHeight - 24)}px`);
    place();
    const observer = new ResizeObserver(place);
    observer.observe(column);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, []);
  return ref;
}
