/**
 * What part of the page people can actually see, as CSS variables on <html>:
 *
 *   --sg-keyboard-inset   how much of the bottom the on-screen keyboard covers
 *   --sg-visible-height   the height that is left above it
 *
 * iOS Safari doesn't shrink the layout (or 100dvh) when the keyboard comes
 * up; it only shrinks the visual viewport. Bottom sheets sit on
 * --sg-keyboard-inset and cap their height at --sg-visible-height, so their
 * main button stays above the keyboard. Android Chrome resizes the layout
 * itself (interactive-widget=resizes-content in index.html), and the inset
 * stays 0 there.
 */
export function trackVisibleViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  const root = document.documentElement;
  let frame = 0;
  const update = () => {
    frame = 0;
    // Pinch zoom also shrinks the visual viewport: only a keyboard-sized gap at scale 1 counts.
    const zoomed = viewport.scale > 1.01;
    const inset = zoomed ? 0 : Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
    root.style.setProperty("--sg-keyboard-inset", `${inset}px`);
    root.style.setProperty("--sg-visible-height", `${Math.round(zoomed ? window.innerHeight : viewport.height)}px`);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  update();
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  return () => {
    cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
  };
}
