import { type MouseEvent, type PointerEvent, useEffect, useRef } from "react";
import { tick } from "./haptics";

/** How long a finger stays put before a press is a long press. */
export const LONG_PRESS_MS = 500;
/** A finger that moves this far is scrolling or dragging, not holding. */
const SLOP_PX = 8;

/**
 * A long press with a finger, or a right click (and the context-menu key): both mean "what else can I do with this?".
 * Spread `handlers` on the element.
 *
 * A finger's hold works as on the iPhone's Home Screen: when the finger has stayed put for LONG_PRESS_MS the thing
 * lifts (a haptic tick, and `onLift(target)` for the look), and only letting go where it is calls `onLongPress`. A
 * finger that moves past the slop is taking the thing somewhere (the caller's drag); that, or `cancel()`,
 * puts it down again with `onLift(null)` and no menu. The click that follows as the finger lets go is
 * swallowed, so it doesn't also act as a tap. Android's own long press (a `contextmenu` event while the finger is
 * down) is the same hold, not a second one.
 */
export function useLongPress(
  onLongPress: (target: HTMLElement) => void,
  onLift?: (target: HTMLElement | null) => void,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  // The element lifted by a hold, until the finger lets go or moves.
  const held = useRef<HTMLElement | null>(null);
  const touch = useRef(false);
  // When a long press last fired: the click and the contextmenu event right after it belong to it.
  const fired = useRef(0);
  const callbacks = useRef({ onLongPress, onLift });
  callbacks.current = { onLongPress, onLift };

  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
    if (!held.current) return;
    held.current = null;
    callbacks.current.onLift?.(null);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const justFired = () => performance.now() - fired.current < 1000;
  // The finger lets go of a lifted thing where it was: that is the long press.
  const release = () => {
    const target = held.current;
    cancel();
    if (!target) return;
    fired.current = performance.now();
    callbacks.current.onLongPress(target);
  };

  return {
    cancel,
    /** Whether a finger holds something lifted (the caller keeps the page from scrolling under it). */
    holding: () => held.current !== null,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        touch.current = event.pointerType !== "mouse";
        cancel();
        if (!touch.current || !event.isPrimary) return;
        const target = event.currentTarget;
        start.current = { x: event.clientX, y: event.clientY };
        timer.current = setTimeout(() => {
          held.current = target;
          tick();
          callbacks.current.onLift?.(target);
        }, LONG_PRESS_MS);
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const from = start.current;
        if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > SLOP_PX) cancel();
      },
      onPointerUp: release,
      // The browser took the touch from a finger that hadn't moved (a system gesture): the hold still counts.
      onPointerCancel: release,
      onContextMenu(event: MouseEvent<HTMLElement>) {
        event.preventDefault();
        // A finger is down: the hold is under way, and letting go opens the menu.
        if (touch.current && start.current) return;
        if (justFired()) return;
        cancel();
        if (touch.current) fired.current = performance.now();
        callbacks.current.onLongPress(event.currentTarget);
      },
      onClickCapture(event: MouseEvent<HTMLElement>) {
        if (!touch.current || !justFired()) return;
        fired.current = 0;
        event.preventDefault();
        event.stopPropagation();
      },
    },
  };
}
