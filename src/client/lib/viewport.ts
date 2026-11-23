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
  let stopRotation = () => {};
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
  stopRotation = settleAfterRotation(update);
  return () => {
    stopNudging();
    stopRotation();
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

/**
 * Turning the phone makes iOS fire resize events before window.innerHeight and the fixed layout have
 * settled: the fixed tab bar can stay at the old height (mid-screen after turning back upright) and the
 * keyboard inset can be worked out from a stale innerHeight. So whenever the window's orientation
 * changes (an orientationchange event, or a resize that flips wide/tall), scroll 1 px and back to make
 * WebKit recompute the fixed layout, and read the viewport again once the rotation has settled.
 */
function settleAfterRotation(update: () => void) {
  let frame = 0;
  const timers = new Set<number>();
  let landscape = window.innerWidth > window.innerHeight;
  // Where to put the page back: set by the first nudge of a frame, kept by any that follow in it.
  let restoreTo: number | null = null;
  const nudge = () => {
    cancelAnimationFrame(frame);
    restoreTo ??= window.scrollY;
    const y = restoreTo;
    window.scrollTo(0, y + 1);
    frame = requestAnimationFrame(() => {
      restoreTo = null;
      window.scrollTo(0, y);
      update();
    });
  };
  const onTurn = () => {
    nudge();
    for (const delay of [100, 400, 1000]) {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        nudge();
      }, delay);
      timers.add(timer);
    }
  };
  const onResize = () => {
    const now = window.innerWidth > window.innerHeight;
    if (now === landscape) return;
    landscape = now;
    onTurn();
  };
  window.addEventListener("orientationchange", onTurn);
  window.addEventListener("resize", onResize);
  return () => {
    cancelAnimationFrame(frame);
    for (const timer of timers) clearTimeout(timer);
    window.removeEventListener("orientationchange", onTurn);
    window.removeEventListener("resize", onResize);
  };
}
