/** How long the quick scroll to the top takes. */
const DURATION_MS = 250;

let frame = 0;

/** Stop a scroll to the top that is still running (a finger or wheel took over, or the page changed). */
function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
  for (const type of ["touchstart", "wheel", "keydown"]) window.removeEventListener(type, stop);
}

/**
 * Scrolls the page to the top, quickly, the way a tapped status bar does: about 250 ms, easing out (instant with
 * reduced motion). The browser's own smooth scroll takes as long as it likes, so this one is timed by hand.
 * Touching the page while it runs hands control back at once.
 */
export function scrollToTop() {
  stop();
  const from = window.scrollY;
  if (from <= 0) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.scrollTo(0, 0);
    return;
  }
  for (const type of ["touchstart", "wheel", "keydown"]) window.addEventListener(type, stop, { passive: true });
  const start = performance.now();
  const path = location.pathname;
  const step = (now: number) => {
    // Another tab was tapped meanwhile: that page is not ours to scroll.
    if (location.pathname !== path) return stop();
    const t = Math.min(1, (now - start) / DURATION_MS);
    window.scrollTo(0, Math.round(from * (1 - (1 - (1 - t) ** 3))));
    if (t < 1) frame = requestAnimationFrame(step);
    else stop();
  };
  frame = requestAnimationFrame(step);
}
