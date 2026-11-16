import { type MouseEvent, type PointerEvent, useEffect, useRef } from "react";
import { tick } from "./haptics";

/** How long a finger stays put before a press is a long press. */
export const LONG_PRESS_MS = 500;
/** A finger that moves this far is scrolling or dragging, not holding. */
const SLOP_PX = 8;

/**
 * A long press with a finger, or a right click (and the context-menu key): both mean "what else can I do with this?".
 * Spread `handlers` on the element. The click that follows a long press as the finger lifts is swallowed, so it doesn't
 * also act as a tap. Android's own long press (a `contextmenu` event) is the same press, not a second one.
 * `cancel` stops one under way (a drag that began).
 */
export function useLongPress(onLongPress: (target: HTMLElement) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const touch = useRef(false);
  // When a long press last fired: the click and the contextmenu event right after it belong to it.
  const fired = useRef(0);
  const callback = useRef(onLongPress);
  callback.current = onLongPress;

  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const justFired = () => performance.now() - fired.current < 1000;

  return {
    cancel,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        touch.current = event.pointerType !== "mouse";
        cancel();
        if (!touch.current || !event.isPrimary) return;
        const target = event.currentTarget;
        start.current = { x: event.clientX, y: event.clientY };
        timer.current = setTimeout(() => {
          start.current = null;
          fired.current = performance.now();
          tick();
          callback.current(target);
        }, LONG_PRESS_MS);
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const from = start.current;
        if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > SLOP_PX) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onContextMenu(event: MouseEvent<HTMLElement>) {
        event.preventDefault();
        if (justFired()) return;
        cancel();
        if (touch.current) fired.current = performance.now();
        callback.current(event.currentTarget);
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
