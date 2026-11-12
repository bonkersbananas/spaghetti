/**
 * A phone app doesn't zoom its page (decision 0039). The viewport meta and `touch-action` in app.css do it where
 * the browser listens; Safari on iOS ignores `user-scalable=no` in a tab (an accessibility choice, WebKit's "New
 * Interaction Behaviors in iOS 10"), so its pinch is also stopped here, where it reports a gesture. A photo
 * zooms itself from its touches (lib/photo-zoom.ts), never through the browser's page zoom.
 */
export function stopPageZoom() {
  const coarse = window.matchMedia("(pointer: coarse)");
  const stop = (event: Event) => {
    if (coarse.matches) event.preventDefault();
  };
  // Non-standard WebKit events (iOS Safari, including the Home Screen app); other engines never fire them.
  document.addEventListener("gesturestart", stop, { passive: false });
  document.addEventListener("gesturechange", stop, { passive: false });
}

/** iOS's text size (Dynamic Type) as a multiple of the 17 px "body" it starts at. */
const DYNAMIC_BODY = 17;
/** Never smaller than the design, and large settings stop here: the fixed bars and sheets are laid out for ~1.25. */
const MAX_TEXT_SCALE = 1.25;

/**
 * Where page zoom is gone, text size is the person's own setting. On iOS, `-apple-system-body` is the size the
 * person chose in Settings; the root font-size follows it, and everything in rem with it. Elsewhere (Android's
 * font size already scales `rem`) nothing happens.
 */
export function followTextSize() {
  if (!CSS.supports("font", "-apple-system-body")) return;
  const probe = document.createElement("span");
  probe.style.cssText = "font:-apple-system-body;position:absolute;visibility:hidden;pointer-events:none";
  probe.textContent = "A";
  const apply = () => {
    if (!probe.isConnected) document.body.append(probe);
    const px = Number.parseFloat(getComputedStyle(probe).fontSize);
    const scale = Math.min(MAX_TEXT_SCALE, Math.max(1, px / DYNAMIC_BODY));
    document.documentElement.style.fontSize = scale === 1 ? "" : `${(scale * 100).toFixed(1)}%`;
  };
  apply();
  // A change in Settings shows when the app is opened again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") apply();
  });
}
