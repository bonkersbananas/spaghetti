import { animate } from "motion/react";
import { spring } from "./motion";

/** The most a photo zooms (times its fitted size), and how far past the limits a finger may stretch it. */
export const MAX_ZOOM = 5;
/** What a double tap zooms to. */
const TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 30;
/** Travel (px) after which a touch is no longer a tap. */
const TAP_SLOP = 10;

export interface PhotoZoom {
  /** Back to the fitted photo, at once or with a spring. */
  reset: (instant?: boolean) => void;
  destroy: () => void;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

/** How far a stretched value may go past its limit: it follows the finger at a third, never more than 80 px. */
function stretch(value: number, min: number, max: number): number {
  if (value < min) return min - Math.min(80, (min - value) / 3);
  if (value > max) return max + Math.min(80, (value - max) / 3);
  return value;
}

/**
 * Pinch, pan and double tap on one photo, without touching the page: `layer` is moved with a transform inside
 * `frame` (which clips it), and a touch's gesture is ours only while two fingers are down or the photo is zoomed.
 * At rest one finger stays the browser's (scrolling the page, swiping between photos). Also double click and
 * ctrl+wheel (a trackpad pinch) on a desktop. Reduced motion: the photo jumps to where it is going.
 */
export function attachPhotoZoom(frame: HTMLElement, layer: HTMLElement): PhotoZoom {
  const view: View = { scale: 1, x: 0, y: 0 };
  let running: { stop: () => void } | null = null;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function paint() {
    layer.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`;
    const zoomed = view.scale > 1.001;
    // A zoomed photo takes every drag on it (touch-action applies from the next touch on); a pull down at the top of
    // the page, which would otherwise start from it, keeps out.
    frame.style.touchAction = zoomed ? "none" : "";
    if (zoomed) frame.setAttribute("data-no-pull", "");
    else frame.removeAttribute("data-no-pull");
    frame.dataset.zoom = zoomed ? "in" : "out";
  }

  /** The farthest the photo may be moved at a scale: its edges stop at the frame's. */
  function limits(scale: number) {
    return { x: ((scale - 1) * frame.clientWidth) / 2, y: ((scale - 1) * frame.clientHeight) / 2 };
  }

  function settleTo(target: View, instant = false) {
    running?.stop();
    const from = { ...view };
    if (instant || reduced()) {
      Object.assign(view, target);
      paint();
      return;
    }
    const controls = animate(0, 1, {
      ...spring.snappy,
      onUpdate: (t) => {
        view.scale = from.scale + (target.scale - from.scale) * t;
        view.x = from.x + (target.x - from.x) * t;
        view.y = from.y + (target.y - from.y) * t;
        paint();
      },
      onComplete: () => {
        Object.assign(view, target);
        paint();
      },
    });
    running = controls;
  }

  /** The view a stretched one rests at. */
  function rested(): View {
    const scale = Math.min(MAX_ZOOM, Math.max(1, view.scale));
    const max = limits(scale);
    return {
      scale,
      x: scale === 1 ? 0 : Math.min(max.x, Math.max(-max.x, view.x)),
      y: scale === 1 ? 0 : Math.min(max.y, Math.max(-max.y, view.y)),
    };
  }

  /** Zoom to `scale` keeping the point (px from the frame's center) under the finger. */
  function zoomAt(scale: number, fx: number, fy: number, from: View = view): View {
    const ratio = scale / from.scale;
    return { scale, x: fx - (fx - from.x) * ratio, y: fy - (fy - from.y) * ratio };
  }

  function center(event: { clientX: number; clientY: number }) {
    const box = frame.getBoundingClientRect();
    return { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 };
  }

  function toggleAt(point: { x: number; y: number }) {
    if (view.scale > 1.05) settleTo({ scale: 1, x: 0, y: 0 });
    else {
      const target = zoomAt(TAP_ZOOM, point.x, point.y, { scale: 1, x: 0, y: 0 });
      const max = limits(TAP_ZOOM);
      settleTo({
        scale: TAP_ZOOM,
        x: Math.min(max.x, Math.max(-max.x, target.x)),
        y: Math.min(max.y, Math.max(-max.y, target.y)),
      });
    }
  }

  // Touch ---------------------------------------------------------------
  type Mode = "idle" | "pinch" | "pan";
  let mode: Mode = "idle";
  let start = { scale: 1, x: 0, y: 0 };
  let startDistance = 1;
  let startMid = { x: 0, y: 0 };
  let panFrom = { x: 0, y: 0 };
  let lastTap = { t: 0, x: 0, y: 0 };
  let tapDown: { x: number; y: number; moved: boolean } | null = null;

  const distance = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const middle = (a: Touch, b: Touch) =>
    center({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 });

  function beginPinch(a: Touch, b: Touch) {
    running?.stop();
    mode = "pinch";
    tapDown = null;
    start = { ...view };
    startDistance = Math.max(1, distance(a, b));
    startMid = middle(a, b);
  }

  function onTouchStart(event: TouchEvent) {
    const [a, b] = [event.touches[0], event.touches[1]];
    if (a && b) {
      beginPinch(a, b);
    } else if (a) {
      running?.stop();
      tapDown = { x: a.clientX, y: a.clientY, moved: false };
      if (view.scale > 1.001) {
        mode = "pan";
        panFrom = { x: a.clientX - view.x, y: a.clientY - view.y };
      }
    }
  }

  function onTouchMove(event: TouchEvent) {
    const [a, b] = [event.touches[0], event.touches[1]];
    if (a && b) {
      if (mode !== "pinch") beginPinch(a, b);
      // Two fingers are never the page's or the carousel's.
      if (event.cancelable) event.preventDefault();
      const scale = stretch((start.scale * distance(a, b)) / startDistance, 0.85, MAX_ZOOM * 1.15);
      const mid = middle(a, b);
      // Keep the point that was between the fingers under them, and follow them as they travel.
      const zoomed = zoomAt(scale, startMid.x, startMid.y, start);
      view.scale = scale;
      view.x = zoomed.x + (mid.x - startMid.x);
      view.y = zoomed.y + (mid.y - startMid.y);
      paint();
      return;
    }
    if (!a) return;
    if (tapDown && Math.hypot(a.clientX - tapDown.x, a.clientY - tapDown.y) > TAP_SLOP) tapDown.moved = true;
    if (mode === "pan" && view.scale > 1.001) {
      if (event.cancelable) event.preventDefault();
      const max = limits(view.scale);
      view.x = stretch(a.clientX - panFrom.x, -max.x, max.x);
      view.y = stretch(a.clientY - panFrom.y, -max.y, max.y);
      paint();
    }
  }

  function onTouchEnd(event: TouchEvent) {
    if (event.touches.length >= 2) return;
    const remaining = event.touches[0];
    const wasPinch = mode === "pinch";
    if (remaining) {
      // One finger of a pinch lifted: carry on panning with the other, from where it is now.
      if (wasPinch) {
        mode = view.scale > 1.001 ? "pan" : "idle";
        panFrom = { x: remaining.clientX - view.x, y: remaining.clientY - view.y };
        tapDown = null;
      }
      return;
    }
    const tap = tapDown && !tapDown.moved && !wasPinch ? tapDown : null;
    tapDown = null;
    mode = "idle";
    const target = rested();
    if (
      Math.abs(target.scale - view.scale) > 0.001 ||
      Math.abs(target.x - view.x) > 0.5 ||
      Math.abs(target.y - view.y) > 0.5
    ) {
      settleTo(target);
    }
    if (tap) {
      const now = event.timeStamp;
      if (now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < DOUBLE_TAP_PX) {
        lastTap = { t: 0, x: 0, y: 0 };
        toggleAt(center({ clientX: tap.x, clientY: tap.y }));
      } else lastTap = { t: now, x: tap.x, y: tap.y };
    }
  }

  function onTouchCancel() {
    mode = "idle";
    tapDown = null;
    settleTo(rested());
  }

  // Safari's own pinch of the page also reports a gesture: keep it from the page, the photo handles the touches.
  function onGesture(event: Event) {
    event.preventDefault();
  }

  // Desktop: double click, and ctrl+wheel (a trackpad's pinch) ----------------
  function onDoubleClick(event: MouseEvent) {
    // A double tap on a phone ends in a dblclick too; the touch code already did it.
    if (window.matchMedia("(pointer: coarse)").matches) return;
    toggleAt(center(event));
  }

  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    running?.stop();
    const point = center(event);
    const scale = Math.min(MAX_ZOOM, Math.max(1, view.scale * Math.exp(-event.deltaY / 100)));
    const next = zoomAt(scale, point.x, point.y);
    const max = limits(scale);
    view.scale = scale;
    view.x = scale === 1 ? 0 : Math.min(max.x, Math.max(-max.x, next.x));
    view.y = scale === 1 ? 0 : Math.min(max.y, Math.max(-max.y, next.y));
    paint();
  }

  frame.addEventListener("touchstart", onTouchStart, { passive: true });
  frame.addEventListener("touchmove", onTouchMove, { passive: false });
  frame.addEventListener("touchend", onTouchEnd);
  frame.addEventListener("touchcancel", onTouchCancel);
  frame.addEventListener("gesturestart", onGesture);
  frame.addEventListener("gesturechange", onGesture);
  frame.addEventListener("dblclick", onDoubleClick);
  frame.addEventListener("wheel", onWheel, { passive: false });
  frame.dataset.zoom = "out";

  return {
    reset(instant = false) {
      if (view.scale === 1 && view.x === 0 && view.y === 0) return;
      settleTo({ scale: 1, x: 0, y: 0 }, instant);
    },
    destroy() {
      running?.stop();
      frame.removeEventListener("touchstart", onTouchStart);
      frame.removeEventListener("touchmove", onTouchMove);
      frame.removeEventListener("touchend", onTouchEnd);
      frame.removeEventListener("touchcancel", onTouchCancel);
      frame.removeEventListener("gesturestart", onGesture);
      frame.removeEventListener("gesturechange", onGesture);
      frame.removeEventListener("dblclick", onDoubleClick);
      frame.removeEventListener("wheel", onWheel);
      layer.style.transform = "";
      frame.style.touchAction = "";
      frame.removeAttribute("data-no-pull");
      delete frame.dataset.zoom;
    },
  };
}
