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
  const stopNudging = nudgeLayoutOnResume();
  const viewport = window.visualViewport;
  if (!viewport) return stopNudging;
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
    stopNudging();
    cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
  };
}

/**
 * The Home Screen app, resumed from the background, can come back with a stale viewport: the fixed tab
 * bar sits below the screen's edge until something scrolls and WebKit recomputes the fixed layout. So
 * when the app becomes visible again (or is restored from the back/forward cache), in standalone mode
 * only, scroll by 1 px and back on the next frame, which is what that scroll did by hand. It never
 * moves a page that is scrolled, and it is invisible: the two scrolls happen between paints.
 */
function nudgeLayoutOnResume() {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  if (!standalone) return () => {};
  let frame = 0;
  const nudge = () => {
    cancelAnimationFrame(frame);
    const y = window.scrollY;
    window.scrollTo(0, y + 1);
    frame = requestAnimationFrame(() => window.scrollTo(0, y));
  };
  const onVisible = () => document.visibilityState === "visible" && nudge();
  const onShow = (event: PageTransitionEvent) => event.persisted && nudge();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onShow);
  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pageshow", onShow);
  };
}
