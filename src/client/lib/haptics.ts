/**
 * A tiny tap under the finger when a choice lands (an outcome picked), on
 * phones that can vibrate. Does nothing where there is no vibration API
 * (desktop, iOS Safari) or when the person prefers reduced motion.
 */
export function tap() {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  navigator.vibrate(10);
}
