import { AnimatePresence, type MotionProps, useReducedMotion } from "motion/react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { duration, spring } from "@/lib/motion";

/**
 * The parent of a list or grid whose rows come and go (a deleted idea, an Undo, a build that starts): rows that
 * leave fade out of the way, rows that arrive fade in, and the rest slide to their new places instead of jumping.
 * The list's own element needs `relative` (a leaving row is lifted out of the flow, where it was). Nothing
 * animates when the list first draws.
 */
export function Reflow({ children }: { children: ReactNode }) {
  // Rows only get `layout` once the list has been on screen a moment: with it on at mount, motion measures every
  // row (forced layouts) inside the tap that opened the screen, for a slide nobody can ask for yet.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setArmed(true), 700);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <Armed.Provider value={armed}>
      <AnimatePresence initial={false} mode="popLayout">
        {children}
      </AnimatePresence>
    </Armed.Provider>
  );
}

/** True once the list the row is in lets its rows slide (a row outside any `Reflow` always does). */
const Armed = createContext(true);

/** What a row (an `m.li`) in a `Reflow` spreads on itself: where it moves, how it arrives (`landing`: a just-captured one drops in) and leaves. */
export function useReflow(landing?: boolean): MotionProps {
  const reduced = useReducedMotion();
  const armed = useContext(Armed);
  return {
    layout: reduced || !armed ? false : "position",
    initial: landing ? { opacity: 0, scale: 0.9, y: -12 } : { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.96, transition: { duration: reduced ? 0 : duration.fast } },
    transition: spring.gentle,
  };
}
