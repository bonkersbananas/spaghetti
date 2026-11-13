// The pressed look on a phone. :active starts the moment a finger lands, before the phone knows whether it is a tap or
// the start of a scroll or swipe, so a card would dim under a finger that only meant to scroll. Here the look waits:
// it shows once the finger has stayed put for PRESS_DELAY, or when a quick tap lifts (so a tap still answers), and
// never when the touch turns into a scroll (pointercancel, movement past the slop, or a scroll event).
// The CSS (pressable, press-tomato, press-none and the dim rule in app.css) reads `data-pressed`, and uses :active
// only for a fine pointer. Where the primary pointer is fine, this does nothing.

const PRESS_DELAY = 70;
const SLOP = 8;
const QUICK_TAP_HOLD = 110;

/** What looks pressed while held: the same list as the dim rule in app.css, plus the pressables. */
const TAPPABLE =
  'a[href], button, summary, .pressable, [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], [role="option"], [role="menuitem"]';

export function followTouchPress() {
  if (typeof matchMedia !== "function") return;
  const coarse = matchMedia("(pointer: coarse)");
  let marked: Element[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let release: ReturnType<typeof setTimeout> | undefined;
  let down: { id: number; x: number; y: number; target: Element } | undefined;

  const clear = () => {
    clearTimeout(timer);
    clearTimeout(release);
    for (const element of marked) element.removeAttribute("data-pressed");
    marked = [];
    down = undefined;
  };

  const show = (target: Element) => {
    // Like :active, every tappable from the target up shows held (a group's icon highlight reads its ancestor).
    const still = target.closest("[data-swipe]") !== null;
    for (
      let node: Element | null = target.closest(TAPPABLE);
      node;
      node = node.parentElement?.closest(TAPPABLE) ?? null
    ) {
      if (node.matches(":disabled, [aria-disabled='true']") || node.hasAttribute("data-pressed")) continue;
      node.setAttribute("data-pressed", still ? "still" : "");
      marked.push(node);
    }
  };

  document.addEventListener(
    "pointerdown",
    (event) => {
      clear();
      if (!coarse.matches || !(event.target instanceof Element) || !event.isPrimary) return;
      const target = event.target;
      if (event.pointerType !== "touch") return show(target);
      down = { id: event.pointerId, x: event.clientX, y: event.clientY, target };
      timer = setTimeout(() => down && show(down.target), PRESS_DELAY);
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "pointermove",
    (event) => {
      if (down && event.pointerId === down.id && Math.hypot(event.clientX - down.x, event.clientY - down.y) > SLOP)
        clear();
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "pointerup",
    (event) => {
      if (!down || event.pointerId !== down.id) return clear();
      // A tap quicker than the delay: show the look now, so it still answers, and let go of it a moment later.
      if (marked.length === 0) {
        const target = down.target;
        clear();
        show(target);
        release = setTimeout(clear, QUICK_TAP_HOLD);
        return;
      }
      clear();
    },
    { capture: true, passive: true },
  );
  for (const type of ["pointercancel", "dragstart", "contextmenu"])
    document.addEventListener(type, clear, { capture: true, passive: true });
  // A scroll (of the page or of any scroller, which don't bubble) ends a press that began on it.
  document.addEventListener("scroll", clear, { capture: true, passive: true });
}
