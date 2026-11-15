/**
 * Runs `work` once the frame that follows has painted, and gives back what cancels it. For reads of the page's
 * layout (`scrollY`, `clientWidth`) that a screen's first paint doesn't need: inside the frame each one forces a
 * layout of its own, which holds the paint of a tap back.
 */
export function afterPaint(work: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(work, 0);
  });
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}
