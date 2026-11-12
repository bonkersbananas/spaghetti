import { useRouter } from "@tanstack/react-router";
import { animate, type MotionValue, useMotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { sections, workshop } from "@/components/shell/sections";
import { tick } from "./haptics";
import { duration, spring } from "./motion";
import { previousPlace } from "./previous-path";

/** How far the page has moved (px) when a release goes back. */
export const PULL_THRESHOLD = 72;
/** The page never follows the finger further than this. */
const PULL_MAX = 160;
/** Pointer travel (px) before a touch counts as a pull, and the sideways travel that hands it to something else. */
const SLOP = 8;
/** A flick: px per ms, with at least this much pulled. */
const FLICK_SPEED = 0.7;
const FLICK_MIN = 28;

/** Growing resistance: the page follows closely at first and less and less, never past PULL_MAX. */
export function resist(pulled: number): number {
  return PULL_MAX * (1 - Math.exp(-pulled / PULL_MAX));
}

const PHONE = "(pointer: coarse) and (max-width: 47.999rem)";
/** Where a pull must not start: fields, sheets, anything that has its own use for a drag. */
const KEEP_OUT = "input, textarea, select, [contenteditable], [role=dialog], [role=slider], [data-no-pull], iframe";

/** True when something between the touched element and the page scrolls vertically by itself. */
function inVerticalScroller(start: Element | null): boolean {
  for (let el = start; el && el !== document.body; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return true;
  }
  return false;
}

/** "Today" for /today; "Back" for a page without a name of its own (an idea, a build). */
function placeLabel(path: string): string {
  return [...sections, ...workshop].find((section) => section.to === path)?.label ?? "Back";
}

interface PullState {
  /** What a release goes back to: the page before, else the list. */
  label: string;
  /** The offset the page is at, in px (what to translate by). */
  offset: MotionValue<number>;
  /** Whether a release now would go back (drives the affordance's words). */
  ready: boolean;
  /** Whether a pull is under way. */
  pulling: boolean;
  /** Fades the page out as it leaves. */
  leave: MotionValue<number>;
}

/**
 * Pull down at the top of a page to go back, on phones. Listens on the window; the caller renders `offset`
 * (page translate), `leave` (page opacity) and the affordance. Motion values only: React renders when a pull
 * starts, ends or crosses the threshold, never per frame.
 */
export function usePullToGo(list: { to: string; label: string }, reduced: boolean): PullState {
  const router = useRouter();
  const offset = useMotionValue(0);
  const leave = useMotionValue(1);
  const [ready, setReady] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [label, setLabel] = useState(list.label);
  const target = useRef(list);
  target.current = list;
  // Chosen when a pull starts: where the person came from if the app has that page in its history.
  const place = useRef<string | null>(null);

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let mode: "off" | "armed" | "pulling" | "going" = "off";
    let isReady = false;
    let last = { y: 0, t: 0 };
    let speed = 0;

    const setReadyTo = (value: boolean) => {
      if (value === isReady) return;
      isReady = value;
      setReady(value);
      tick();
    };

    function go() {
      mode = "going";
      const leaving = reduced
        ? animate(leave, 0, { duration: duration.fast })
        : Promise.all([
            animate(offset, window.innerHeight * 0.5, { duration: duration.base, ease: [0.4, 0, 1, 1] }),
            animate(leave, 0, { duration: duration.base }),
          ]);
      void Promise.resolve(leaving).then(() => {
        // Going back keeps the page before as it was (its scroll position, the card you came from); with
        // none in the app's history (a deep link, a fresh open) the page's own list is where it goes.
        if (place.current) router.history.back();
        else void router.navigate({ to: target.current.to });
      });
    }

    function settle() {
      mode = "off";
      isReady = false;
      setReady(false);
      setPulling(false);
      animate(offset, 0, spring.snappy);
    }

    function onStart(event: TouchEvent) {
      if (mode === "going") return;
      mode = "off";
      if (event.touches.length !== 1 || window.scrollY > 0) return;
      if (!window.matchMedia(PHONE).matches) return;
      if (document.querySelector("[role=dialog]")) return;
      const touch = event.touches[0];
      const element = event.target instanceof Element ? event.target : null;
      if (!touch || element?.closest(KEEP_OUT) || inVerticalScroller(element)) return;
      startX = touch.clientX;
      startY = touch.clientY;
      last = { y: startY, t: event.timeStamp };
      speed = 0;
      mode = "armed";
    }

    function onMove(event: TouchEvent) {
      if (mode !== "armed" && mode !== "pulling") return;
      const touch = event.touches[0];
      if (!touch) return;
      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;
      if (mode === "armed") {
        // Sideways stays the carousel's, upward is plain scrolling; either ends the chance for this touch.
        if (Math.abs(dx) > SLOP || dy < -SLOP || window.scrollY > 0) {
          mode = "off";
          return;
        }
        if (dy <= SLOP) return;
        mode = "pulling";
        place.current = previousPlace();
        setLabel(place.current ? placeLabel(place.current) : target.current.label);
        setPulling(true);
      }
      if (event.cancelable) event.preventDefault();
      const dt = event.timeStamp - last.t;
      if (dt > 0) speed = (touch.clientY - last.y) / dt;
      last = { y: touch.clientY, t: event.timeStamp };
      const moved = resist(Math.max(0, dy - SLOP));
      if (!reduced) offset.set(moved);
      setReadyTo(moved >= PULL_THRESHOLD);
    }

    function onEnd() {
      if (mode === "armed") mode = "off";
      if (mode !== "pulling") return;
      const moved = resist(Math.max(0, last.y - startY - SLOP));
      if (moved >= PULL_THRESHOLD || (speed > FLICK_SPEED && moved >= FLICK_MIN)) go();
      else settle();
    }

    function onCancel() {
      if (mode === "pulling") settle();
      else if (mode !== "going") mode = "off";
    }

    // At the very top the browser must not take a downward pan for itself: once it has started scrolling (even
    // when there is nowhere to go) the touch can no longer be cancelled. So while the page is at its top on a
    // phone, a downward pan is excluded from touch-action and stays ours; anywhere lower it is plain scrolling.
    const root = document.documentElement;
    const sync = () => {
      root.style.touchAction = window.scrollY <= 0 && window.matchMedia(PHONE).matches ? "pan-x pan-up" : "";
    };
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onCancel);
    return () => {
      root.style.touchAction = "";
      window.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, [router, offset, leave, reduced]);

  return { offset, ready, pulling, leave, label };
}
